/**
 * Cadastro de parcerias (DEV-02.1) — AMBIENTE CONFIÁVEL (servidor), PREPARADO E BLOQUEADO.
 *
 * Enquanto a permissão `partnerships.edit` estiver "pendente de especificação" no
 * catálogo, a política de produção (`decidePartnershipRegistration`) NEGA todo cadastro
 * com o motivo `pending-specification` — depois de verificar token, OSC, vínculo e
 * situação comercial. Não existe variável de ambiente, parâmetro ou cabeçalho que
 * habilite a gravação: a única forma de habilitá-la é uma nova evolução que especifique
 * a permissão no catálogo.
 *
 * Fluxo (quando habilitado no futuro):
 *  1. Token de ID verificado (assinatura, expiração, revogação).
 *  2. Corpo validado em formato ESTRITO (campos extras, como situação ou autoria, são recusados).
 *  3. Em TRANSAÇÃO: OSC e vínculo relidos AGORA → decisão → validação do rascunho com a
 *     data do servidor → idempotência (`requestId`) → unicidade por OSC → gravação com
 *     autoria, datas de servidor e evento de auditoria (sem conteúdo do cadastro).
 * O Admin SDK ignora as Security Rules: toda autorização é explícita aqui.
 */
import { FieldValue } from 'firebase-admin/firestore'
import type { AuthorizationContext } from '../../src/domain/authorization.ts'
import {
  INITIAL_ADMINISTRATIVE_STATUS,
  WORK_PLAN_DOCUMENT_STATUS,
  decidePartnershipRegistration,
  uniquenessKey,
  validatePartnershipDraft,
  type DraftErrors,
  type RegistrationDecision,
  type RegistrationDenial,
} from '../../src/domain/partnerships.ts'
import { MAX_BODY_BYTES } from './limits.ts'
import { membershipFacts, organizationFacts, type ApiRequest, type ApiResponse, type ServerDeps } from './permissionsService.ts'

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
const DRAFT_KEYS = [
  'instrument',
  'instrumentNumber',
  'publicPartner',
  'object',
  'administrativeProcess',
  'formalizationDate',
  'termStart',
  'termEnd',
  'globalValueCents',
  'workPlanApprovalDeclared',
] as const

export type RegistrationPolicy = (context: AuthorizationContext) => RegistrationDecision

export interface PartnershipsOptions {
  /** Política de autorização. Produção: SEMPRE `decidePartnershipRegistration`. */
  readonly policy?: RegistrationPolicy
  /** Data de referência (AAAA-MM-DD). Produção: data do servidor no fuso de Brasília. */
  readonly today?: string
}

interface CreateRequest {
  oscId: string
  requestId: string
  draft: Record<string, unknown>
}

const json = (status: number, body: Record<string, unknown>): ApiResponse => ({ status, body })

export function serverToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function parseCreate(rawBody: string): CreateRequest | null {
  if (rawBody.length === 0 || Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return null
  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const record = body as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 3 || !['oscId', 'requestId', 'draft'].every((k) => keys.includes(k))) return null
  const { oscId, requestId, draft } = record
  if (typeof oscId !== 'string' || !ID_PATTERN.test(oscId)) return null
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) return null
  if (typeof draft !== 'object' || draft === null || Array.isArray(draft)) return null
  // Esquema estrito: situação, autoria, OSC ou identificadores NÃO podem ser enviados pelo cliente.
  if (!Object.keys(draft).every((k) => (DRAFT_KEYS as readonly string[]).includes(k))) return null
  return { oscId, requestId, draft: draft as Record<string, unknown> }
}

function bearerToken(header: string | undefined): string | null {
  return /^Bearer ([A-Za-z0-9._-]+)$/.exec(header ?? '')?.[1] ?? null
}

function authErrorCode(error: unknown): 'session-expired' | 'invalid-token' {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  return /id-token-(expired|revoked)|user-disabled|user-not-found/.test(code) ? 'session-expired' : 'invalid-token'
}

class Outcome extends Error {
  readonly response: ApiResponse
  constructor(response: ApiResponse) {
    super('outcome')
    this.response = response
  }
}

const denial = (reason: RegistrationDenial) => new Outcome(json(403, { error: 'forbidden', reason }))

async function create(deps: ServerDeps, uid: string, request: CreateRequest, policy: RegistrationPolicy, today: string): Promise<ApiResponse> {
  const { oscId, requestId } = request
  const oscRef = deps.db.doc(`oscs/${oscId}`)
  const actorRef = deps.db.doc(`oscs/${oscId}/members/${uid}`)
  const collection = deps.db.collection(`oscs/${oscId}/partnerships`)

  try {
    return await deps.db.runTransaction(async (tx) => {
      const [oscSnap, actorSnap] = await tx.getAll(oscRef, actorRef)
      const organization = organizationFacts(oscSnap, oscId)
      const membership = membershipFacts(actorSnap, oscId, uid)
      const decision = policy({ uid, oscId, organization, membership })
      if (!decision.allowed) throw denial(decision.reason)

      const validation = validatePartnershipDraft(request.draft, today)
      if (!validation.ok) throw new Outcome(json(422, { error: 'invalid-draft', fields: validation.errors satisfies DraftErrors }))
      const { draft } = validation

      // Idempotência: reenvio do MESMO pedido (ex.: falha de rede após a gravação) não duplica.
      const previous = await tx.get(collection.where('creationRequestId', '==', requestId).limit(1))
      const existing = previous.docs[0]
      if (existing) {
        if (existing.get('createdBy') !== uid) throw new Outcome(json(409, { error: 'conflict' }))
        return json(200, { ok: true, created: false, partnership: { id: existing.id } })
      }

      const key = uniquenessKey(draft)
      const duplicate = await tx.get(collection.where('uniqueKey', '==', key).limit(1))
      if (!duplicate.empty) throw new Outcome(json(409, { error: 'duplicate' }))

      const ref = collection.doc()
      const now = FieldValue.serverTimestamp()
      tx.create(ref, {
        schemaVersion: 1,
        id: ref.id,
        oscId,
        ...draft,
        administrativeStatus: INITIAL_ADMINISTRATIVE_STATUS,
        workPlan: { approvalDeclared: true, document: WORK_PLAN_DOCUMENT_STATUS },
        uniqueKey: key,
        creationRequestId: requestId,
        createdAt: now,
        createdBy: uid,
        updatedAt: now,
        updatedBy: uid,
      })
      // Auditoria: quem, quando, qual OSC e parceria — sem o conteúdo do cadastro.
      tx.create(deps.db.collection(`oscs/${oscId}/partnershipEvents`).doc(), {
        action: 'create',
        oscId,
        partnershipId: ref.id,
        actorUid: uid,
        actorAuthority: decision.authority,
        at: now,
      })
      return json(201, { ok: true, created: true, partnership: { id: ref.id } })
    })
  } catch (error) {
    if (error instanceof Outcome) return error.response
    throw error
  }
}

/** Ponto de entrada independente de plataforma. */
export async function handlePartnershipsRequest(
  request: ApiRequest,
  deps: ServerDeps | null,
  { policy = decidePartnershipRegistration, today = serverToday() }: PartnershipsOptions = {},
): Promise<ApiResponse> {
  if (deps === null) return json(503, { error: 'not-configured' })
  if (request.method !== 'POST') return json(405, { error: 'method-not-allowed' })

  const token = bearerToken(request.authorization)
  if (!token) return json(401, { error: 'invalid-token' })
  let uid: string
  try {
    uid = (await deps.verifyIdToken(token)).uid
  } catch (error) {
    return json(401, { error: authErrorCode(error) })
  }

  const parsed = parseCreate(request.rawBody)
  if (!parsed) return json(400, { error: 'invalid-request' })
  try {
    return await create(deps, uid, parsed, policy, today)
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown'
    console.error(`[osc-partnerships] falha interna (${code})`)
    return json(500, { error: 'internal' })
  }
}
