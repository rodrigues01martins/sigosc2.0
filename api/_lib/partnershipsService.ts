/**
 * Cadastro e alteração cadastral de parcerias (DEV-02.1-C01) — AMBIENTE CONFIÁVEL (servidor).
 *
 * POST  → cadastro: exige `partnerships.create` (DEC-PAR-001).
 * PATCH → correção cadastral limitada: exige `partnerships.edit` (DEC-PAR-001); parceria
 *         arquivada não admite alterações (DEC-PAR-006).
 *
 * Em cada requisição: token de ID verificado (assinatura, expiração, revogação) → corpo em
 * formato ESTRITO (OSC, autoria, situação forjada etc. fora do esquema são recusados) →
 * TRANSAÇÃO: OSC, vínculo e parceria relidos AGORA → decisão pelo domínio compartilhado →
 * validação com a data do servidor (Brasília) → gravação com autoria, carimbos do servidor
 * e evento de auditoria. O Admin SDK ignora as Security Rules: a autorização é explícita aqui.
 *
 * Idempotência: o pedido (uid + requestId) é registrado em
 * `oscs/{oscId}/partnershipRequests/{uid}_{requestId}` com `create` na MESMA transação;
 * pedidos concorrentes idênticos colidem nesse documento e apenas um cadastro é criado.
 */
import { FieldValue, type DocumentReference, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore'
import { evaluate, type AuthorizationContext } from '../../src/domain/authorization.ts'
import {
  CONSULT_PERMISSION,
  DRAFT_FIELDS,
  WORK_PLAN_DOCUMENT_STATUS,
  decidePartnershipCreation,
  decidePartnershipEdit,
  duplicateCheckKey,
  isAdministrativeStatus,
  partnershipTitle,
  validatePartnershipChanges,
  validatePartnershipDraft,
  type EditableField,
  type InstrumentId,
  type PartnershipDenial,
} from '../../src/domain/partnerships.ts'
import { MAX_BODY_BYTES } from './limits.ts'
import { membershipFacts, organizationFacts, type ApiRequest, type ApiResponse, type ServerDeps } from './permissionsService.ts'

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
const MAX_DUPLICATE_CANDIDATES = 5

export interface PartnershipsOptions {
  /** Data de referência (AAAA-MM-DD). Produção: data do servidor no fuso de Brasília. */
  readonly today?: string
}

interface CreateRequest {
  oscId: string
  requestId: string
  draft: Record<string, unknown>
  acknowledgeDuplicates: boolean
}

interface UpdateRequest {
  oscId: string
  partnershipId: string
  requestId: string
  expectedRevision: number
  changes: Record<string, unknown>
}

const json = (status: number, body: Record<string, unknown>): ApiResponse => ({ status, body })

export function serverToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function parseJsonObject(rawBody: string): Record<string, unknown> | null {
  if (rawBody.length === 0 || Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return null
  try {
    const body: unknown = JSON.parse(rawBody)
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const onlyKeys = (record: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every((k) => k in record) && Object.keys(record).every((k) => required.includes(k) || optional.includes(k))

function parseCreate(rawBody: string): CreateRequest | null {
  const body = parseJsonObject(rawBody)
  if (!body || !onlyKeys(body, ['oscId', 'requestId', 'draft'], ['acknowledgeDuplicates'])) return null
  const { oscId, requestId, draft, acknowledgeDuplicates } = body
  if (typeof oscId !== 'string' || !ID_PATTERN.test(oscId)) return null
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) return null
  if (!isPlainObject(draft)) return null
  // Esquema estrito: OSC, autoria, identificadores ou carimbos NÃO podem ser enviados pelo cliente.
  if (!Object.keys(draft).every((k) => (DRAFT_FIELDS as readonly string[]).includes(k))) return null
  if (acknowledgeDuplicates !== undefined && typeof acknowledgeDuplicates !== 'boolean') return null
  return { oscId, requestId, draft, acknowledgeDuplicates: acknowledgeDuplicates === true }
}

function parseUpdate(rawBody: string): UpdateRequest | null {
  const body = parseJsonObject(rawBody)
  if (!body || !onlyKeys(body, ['oscId', 'partnershipId', 'requestId', 'expectedRevision', 'changes'])) return null
  const { oscId, partnershipId, requestId, expectedRevision, changes } = body
  if (typeof oscId !== 'string' || !ID_PATTERN.test(oscId)) return null
  if (typeof partnershipId !== 'string' || !ID_PATTERN.test(partnershipId)) return null
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) return null
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return null
  if (!isPlainObject(changes)) return null
  return { oscId, partnershipId, requestId, expectedRevision, changes }
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

const denial = (reason: PartnershipDenial) => new Outcome(json(403, { error: 'forbidden', reason }))

async function readContext(tx: Transaction, deps: ServerDeps, uid: string, oscId: string, extra: DocumentReference[] = []) {
  const refs = [deps.db.doc(`oscs/${oscId}`), deps.db.doc(`oscs/${oscId}/members/${uid}`), ...extra]
  const [oscSnap, actorSnap, ...rest] = await tx.getAll(...refs)
  const context: AuthorizationContext = { uid, oscId, organization: organizationFacts(oscSnap, oscId), membership: membershipFacts(actorSnap, oscId, uid) }
  return { context, rest: rest as DocumentSnapshot[] }
}

/** Revisão atual (documentos sem o campo são da revisão 1). */
const revisionOf = (snap: DocumentSnapshot) => {
  const value: unknown = snap.get('revision')
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : 1
}

async function create(deps: ServerDeps, uid: string, request: CreateRequest, today: string): Promise<ApiResponse> {
  const { oscId, requestId } = request
  const collection = deps.db.collection(`oscs/${oscId}/partnerships`)
  const markerRef = deps.db.doc(`oscs/${oscId}/partnershipRequests/${uid}_${requestId}`)

  try {
    return await deps.db.runTransaction(async (tx) => {
      const { context, rest } = await readContext(tx, deps, uid, oscId, [markerRef])
      const decision = decidePartnershipCreation(context)
      if (!decision.allowed) throw denial(decision.reason)

      // 1. Reenvio do MESMO pedido: devolve o cadastro já confirmado (sem segunda parceria).
      const marker = rest[0]
      if (marker?.exists) {
        return json(200, { ok: true, created: false, partnership: { id: marker.get('partnershipId') as string } })
      }

      const validation = validatePartnershipDraft(request.draft, today)
      if (!validation.ok) throw new Outcome(json(422, { error: 'invalid-draft', fields: validation.errors, warnings: validation.warnings }))
      const { draft, warnings } = validation

      // 2. Possível duplicidade: AVISO para conferência, nunca bloqueio definitivo (DEC-PAR-005).
      const key = duplicateCheckKey(draft)
      const similar = await tx.get(collection.where('duplicateCheckKey', '==', key).limit(MAX_DUPLICATE_CANDIDATES))
      if (!similar.empty && !request.acknowledgeDuplicates) {
        // Detalhes só para quem também pode CONSULTAR parcerias (sem vazamento a quem só cadastra).
        const canView = evaluate(context, { kind: 'consult', permission: CONSULT_PERMISSION }).allowed
        const candidates = canView
          ? similar.docs.map((d) => ({
              id: d.id,
              title: partnershipTitle({ instrument: d.get('instrument') as InstrumentId, instrumentNumber: String(d.get('instrumentNumber')) }),
              publicPartner: d.get('publicPartner') as string,
              formalizationDate: d.get('formalizationDate') as string,
              termStart: d.get('termStart') as string,
              termEnd: d.get('termEnd') as string,
              administrativeStatus: d.get('administrativeStatus') as string,
              sameDates:
                d.get('formalizationDate') === draft.formalizationDate && d.get('termStart') === draft.termStart && d.get('termEnd') === draft.termEnd,
            }))
          : []
        throw new Outcome(json(409, { error: 'possible-duplicate', count: similar.size, candidates }))
      }

      const ref = collection.doc()
      const now = FieldValue.serverTimestamp()
      tx.create(markerRef, { requestId, uid, oscId, partnershipId: ref.id, at: now })
      tx.create(ref, {
        schemaVersion: 2,
        id: ref.id,
        oscId,
        ...draft,
        // DEC-PAR-006: situação DECLARADA pelo usuário no cadastro, com autoria e data.
        administrativeStatusSource: 'declared-at-registration',
        administrativeStatusDeclaredAt: now,
        administrativeStatusDeclaredBy: uid,
        workPlan: { approvalDeclared: true, document: WORK_PLAN_DOCUMENT_STATUS, declaredAt: now, declaredBy: uid },
        duplicateCheckKey: key,
        creationRequestId: requestId,
        revision: 1,
        createdAt: now,
        createdBy: uid,
        updatedAt: now,
        updatedBy: uid,
      })
      // Auditoria: quem, quando, qual OSC e parceria, situação declarada — sem o conteúdo do cadastro.
      tx.create(deps.db.collection(`oscs/${oscId}/partnershipEvents`).doc(), {
        action: 'create',
        oscId,
        partnershipId: ref.id,
        actorUid: uid,
        actorAuthority: decision.authority,
        administrativeStatus: draft.administrativeStatus,
        duplicateAcknowledged: !similar.empty,
        at: now,
      })
      return json(201, { ok: true, created: true, partnership: { id: ref.id }, warnings })
    })
  } catch (error) {
    if (error instanceof Outcome) return error.response
    throw error
  }
}

async function update(deps: ServerDeps, uid: string, request: UpdateRequest): Promise<ApiResponse> {
  const { oscId, partnershipId, requestId, expectedRevision } = request
  const ref = deps.db.doc(`oscs/${oscId}/partnerships/${partnershipId}`)

  try {
    return await deps.db.runTransaction(async (tx) => {
      const { context, rest } = await readContext(tx, deps, uid, oscId, [ref])
      // Autorização ANTES de revelar se a parceria existe.
      const permission = evaluate(context, { kind: 'operate', permission: 'partnerships.edit' })
      if (!permission.allowed) throw denial(permission.reason)
      const snap = rest[0]
      if (!snap?.exists || snap.get('oscId') !== oscId) throw new Outcome(json(404, { error: 'not-found' }))
      const status: unknown = snap.get('administrativeStatus')
      if (!isAdministrativeStatus(status)) throw new Outcome(json(409, { error: 'invalid-state' }))
      const decision = decidePartnershipEdit(context, status)
      if (!decision.allowed) throw denial(decision.reason)

      const current = revisionOf(snap)
      // Reenvio do mesmo pedido já aplicado: confirmado sem nova alteração.
      if (snap.get('lastUpdateRequestId') === requestId && snap.get('updatedBy') === uid) {
        return json(200, { ok: true, changed: false, partnership: { id: partnershipId, revision: current } })
      }
      if (current !== expectedRevision) throw new Outcome(json(409, { error: 'stale', revision: current }))

      const validation = validatePartnershipChanges(request.changes)
      if (!validation.ok) throw new Outcome(json(422, { error: 'invalid-draft', fields: validation.errors }))
      const changed = (Object.entries(validation.changes) as [EditableField, string | null][]).filter(([field, value]) => (snap.get(field) ?? null) !== value)
      if (changed.length === 0) return json(200, { ok: true, changed: false, partnership: { id: partnershipId, revision: current } })

      const updates: Record<string, unknown> = Object.fromEntries(changed)
      const merged = {
        instrument: snap.get('instrument') as InstrumentId,
        instrumentNumber: (updates.instrumentNumber as string | undefined) ?? (snap.get('instrumentNumber') as string),
        publicPartner: (updates.publicPartner as string | undefined) ?? (snap.get('publicPartner') as string),
      }
      const now = FieldValue.serverTimestamp()
      tx.update(ref, {
        ...updates,
        duplicateCheckKey: duplicateCheckKey(merged),
        revision: current + 1,
        lastUpdateRequestId: requestId,
        updatedAt: now,
        updatedBy: uid,
      })
      tx.create(deps.db.collection(`oscs/${oscId}/partnershipEvents`).doc(), {
        action: 'update',
        oscId,
        partnershipId,
        actorUid: uid,
        actorAuthority: decision.authority,
        fields: changed.map(([field]) => field),
        fromRevision: current,
        toRevision: current + 1,
        at: now,
      })
      return json(200, { ok: true, changed: true, partnership: { id: partnershipId, revision: current + 1 } })
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
  { today = serverToday() }: PartnershipsOptions = {},
): Promise<ApiResponse> {
  if (deps === null) return json(503, { error: 'not-configured' })
  if (request.method !== 'POST' && request.method !== 'PATCH') return json(405, { error: 'method-not-allowed' })

  const token = bearerToken(request.authorization)
  if (!token) return json(401, { error: 'invalid-token' })
  let uid: string
  try {
    uid = (await deps.verifyIdToken(token)).uid
  } catch (error) {
    return json(401, { error: authErrorCode(error) })
  }

  try {
    if (request.method === 'POST') {
      const parsed = parseCreate(request.rawBody)
      return parsed ? await create(deps, uid, parsed, today) : json(400, { error: 'invalid-request' })
    }
    const parsed = parseUpdate(request.rawBody)
    return parsed ? await update(deps, uid, parsed) : json(400, { error: 'invalid-request' })
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown'
    console.error(`[osc-partnerships] falha interna (${code})`)
    return json(500, { error: 'internal' })
  }
}
