/**
 * Cadastro estruturado do Plano de Trabalho aprovado (DEV-02.2) — AMBIENTE CONFIÁVEL (servidor).
 *
 * POST  {oscId, partnershipId, requestId, action: 'start'}                              → iniciar (`work-plan.edit`)
 * PATCH {oscId, partnershipId, requestId, expectedRevision, changes}                    → alterar (`work-plan.edit`)
 * POST  {oscId, partnershipId, requestId, action: 'finalize', expectedRevision, confirm} → finalizar (`work-plan.edit`, DEC-PT-001)
 * POST  {oscId, partnershipId, requestId, action: 'correct', expectedRevision, changes, justification, declaration}
 *       → correção de ERRO MATERIAL em Plano finalizado (`work-plan.edit`, DEC-PT-002)
 * GET   ?oscId=…&partnershipId=…  → histórico de correções materiais (`work-plan.view`)
 *
 * Em cada requisição: token verificado → corpo em formato ESTRITO → TRANSAÇÃO que relê OSC,
 * vínculo, parceria e Plano → autorização (antes de revelar a existência da parceria) →
 * situação da parceria (arquivada = somente consulta) → situação do cadastro (finalizado =
 * preservado) → revisão (concorrência) → validação → gravação com autoria, carimbos do
 * servidor e evento de auditoria (sem conteúdo textual).
 *
 * O registro tem identificador FIXO (`original`) sob a parceria: dois inícios simultâneos
 * colidem no mesmo documento e só um é criado. Não é versão formal (DEC-034).
 */
import { FieldValue, type DocumentSnapshot } from 'firebase-admin/firestore'
import { evaluate, type AuthorizationContext } from '../../src/domain/authorization.ts'
import { isAdministrativeStatus, isInstrument, isValidDate } from '../../src/domain/partnerships.ts'
import {
  EDIT_PERMISSION,
  FIELD_IDS,
  CORRECTION_DECLARATION,
  ORIGINAL_WORK_PLAN_ID,
  VIEW_PERMISSION,
  checkFinalization,
  decideWorkPlanOperation,
  emptyValues,
  parseFieldValue,
  validateChanges,
  validateCorrection,
  type FieldValue as PlanValue,
  type PartnershipFacts,
  type WorkPlanDenial,
  type WorkPlanField,
  type WorkPlanSituation,
  type WorkPlanValues,
} from '../../src/domain/workPlans.ts'
import { MAX_BODY_BYTES } from './limits.ts'
import { serverToday } from './partnershipsService.ts'
import { membershipFacts, organizationFacts, type ApiRequest, type ApiResponse, type ServerDeps } from './permissionsService.ts'

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

export interface WorkPlansOptions {
  readonly today?: string
}

type Parsed =
  | { kind: 'start'; oscId: string; partnershipId: string; requestId: string }
  | { kind: 'finalize'; oscId: string; partnershipId: string; requestId: string; expectedRevision: number }
  | { kind: 'update'; oscId: string; partnershipId: string; requestId: string; expectedRevision: number; changes: Record<string, unknown> }
  | { kind: 'correct'; oscId: string; partnershipId: string; requestId: string; expectedRevision: number; changes: unknown; justification: unknown; declaration: unknown }

const json = (status: number, body: Record<string, unknown>): ApiResponse => ({ status, body })
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const exactKeys = (r: Record<string, unknown>, keys: string[]) => Object.keys(r).length === keys.length && keys.every((k) => k in r)
const isRevision = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1

function parse(method: string | undefined, rawBody: string): Parsed | null {
  if (rawBody.length === 0 || Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return null
  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (!isObject(body)) return null
  const { oscId, partnershipId, requestId } = body
  if (typeof oscId !== 'string' || !ID_PATTERN.test(oscId)) return null
  if (typeof partnershipId !== 'string' || !ID_PATTERN.test(partnershipId)) return null
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) return null
  if (method === 'PATCH') {
    if (!exactKeys(body, ['oscId', 'partnershipId', 'requestId', 'expectedRevision', 'changes'])) return null
    if (!isRevision(body.expectedRevision) || !isObject(body.changes)) return null
    return { kind: 'update', oscId, partnershipId, requestId, expectedRevision: body.expectedRevision, changes: body.changes }
  }
  if (body.action === 'start' && exactKeys(body, ['oscId', 'partnershipId', 'requestId', 'action'])) return { kind: 'start', oscId, partnershipId, requestId }
  if (body.action === 'finalize' && exactKeys(body, ['oscId', 'partnershipId', 'requestId', 'action', 'expectedRevision', 'confirm'])) {
    // A confirmação explícita é exigida também no servidor (operação que preserva o registro).
    if (body.confirm !== true || !isRevision(body.expectedRevision)) return null
    return { kind: 'finalize', oscId, partnershipId, requestId, expectedRevision: body.expectedRevision }
  }
  if (body.action === 'correct' && exactKeys(body, ['oscId', 'partnershipId', 'requestId', 'action', 'expectedRevision', 'changes', 'justification', 'declaration'])) {
    // Conteúdo (campos, justificativa, declaração) é validado pelo domínio, com mensagens por campo.
    if (!isRevision(body.expectedRevision)) return null
    return { kind: 'correct', oscId, partnershipId, requestId, expectedRevision: body.expectedRevision, changes: body.changes, justification: body.justification, declaration: body.declaration }
  }
  return null
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
const deny = (reason: WorkPlanDenial) => new Outcome(json(reason === 'already-finalized' || reason === 'not-finalized' ? 409 : 403, { error: 'forbidden', reason }))

function partnershipFacts(snap: DocumentSnapshot | undefined, oscId: string): PartnershipFacts | null {
  const d = snap?.exists ? snap.data() : undefined
  if (!d || d.oscId !== oscId || !isInstrument(d.instrument) || !isAdministrativeStatus(d.administrativeStatus)) return null
  if (!isValidDate(d.termStart) || !isValidDate(d.termEnd) || !isValidDate(d.formalizationDate)) return null
  return {
    instrument: d.instrument,
    termStart: d.termStart,
    termEnd: d.termEnd,
    formalizationDate: d.formalizationDate,
    administrativeStatus: d.administrativeStatus,
    workPlanApprovalDeclared: (d.workPlan as Record<string, unknown> | undefined)?.approvalDeclared === true,
  }
}

/** Valores gravados, relidos defensivamente (inválidos → "não informado", nunca inventados). */
export function storedValues(snap: DocumentSnapshot, today: string): WorkPlanValues {
  const raw = (snap.get('values') ?? {}) as Record<string, unknown>
  const values = emptyValues()
  for (const id of FIELD_IDS) {
    // `today` não restringe valores já gravados: datas antigas continuam válidas.
    const parsed = parseFieldValue(id, raw[id], id === 'approvalDate' ? '9999-12-31' : today)
    if (parsed.value) values[id] = parsed.value
  }
  return values
}

const revisionOf = (snap: DocumentSnapshot) => {
  const value: unknown = snap.get('revision')
  return isRevision(value) ? value : 1
}

async function run(deps: ServerDeps, uid: string, request: Parsed, today: string): Promise<ApiResponse> {
  const { oscId, partnershipId, requestId } = request
  const oscRef = deps.db.doc(`oscs/${oscId}`)
  const actorRef = deps.db.doc(`oscs/${oscId}/members/${uid}`)
  const partnershipRef = deps.db.doc(`oscs/${oscId}/partnerships/${partnershipId}`)
  const planRef = partnershipRef.collection('workPlans').doc(ORIGINAL_WORK_PLAN_ID)
  const events = deps.db.collection(`oscs/${oscId}/workPlanEvents`)

  try {
    return await deps.db.runTransaction(async (tx) => {
      const [oscSnap, actorSnap, partnershipSnap, planSnap] = await tx.getAll(oscRef, actorRef, partnershipRef, planRef)
      const context: AuthorizationContext = { uid, oscId, organization: organizationFacts(oscSnap, oscId), membership: membershipFacts(actorSnap, oscId, uid) }

      // 1. Permissão antes de revelar se a parceria existe (conhecer um ID não autoriza nada).
      //    DEC-PT-001: todas as gravações exigem `work-plan.edit` (o identificador descontinuado
      //    `work-plan.finalize` é descartado na leitura do vínculo e nunca autoriza nada).
      const base = evaluate(context, { kind: 'operate', permission: EDIT_PERMISSION })
      if (!base.allowed) throw deny(base.reason)

      // 2. Parceria da MESMA OSC (o caminho já isola; o documento é conferido).
      const partnership = partnershipFacts(partnershipSnap, oscId)
      if (!partnership) throw new Outcome(json(404, { error: 'not-found' }))
      if (planSnap?.exists && planSnap.get('partnershipId') !== partnershipId) throw new Outcome(json(409, { error: 'invalid-state' }))
      const registration: WorkPlanSituation = !planSnap?.exists ? 'not-structured' : planSnap.get('registrationStatus') === 'finalized' ? 'finalized' : 'in-registration'

      // Reenvios idempotentes, reconhecidos antes das regras de estado.
      if (planSnap?.exists) {
        const current = revisionOf(planSnap)
        const summary = { id: ORIGINAL_WORK_PLAN_ID, revision: current, registrationStatus: registration }
        if (request.kind === 'start' && registration === 'in-registration') return json(200, { ok: true, created: false, workPlan: summary })
        if (request.kind === 'update' && planSnap.get('lastUpdateRequestId') === requestId && planSnap.get('updatedBy') === uid) {
          return json(200, { ok: true, changed: false, workPlan: summary })
        }
        if (request.kind === 'finalize' && registration === 'finalized' && planSnap.get('finalizationRequestId') === requestId && planSnap.get('finalizedBy') === uid) {
          return json(200, { ok: true, finalized: false, workPlan: summary })
        }
        if (request.kind === 'correct') {
          // Evento com ID determinístico por usuário e pedido: marcador de idempotência e registro append-only.
          const previous = await tx.get(events.doc(correctionEventId(uid, requestId)))
          if (previous.exists) return json(200, { ok: true, corrected: false, workPlan: { ...summary, revision: previous.get('toRevision') as number } })
        }
      }

      const decision = decideWorkPlanOperation(context, request.kind, partnership.administrativeStatus, registration)
      if (!decision.allowed) throw deny(decision.reason)
      const now = FieldValue.serverTimestamp()

      if (request.kind === 'start') {
        tx.create(planRef, {
          schemaVersion: 1,
          id: ORIGINAL_WORK_PLAN_ID,
          oscId,
          partnershipId,
          // Origem da futura cadeia de versões (DEC-034/039) — NÃO é versão formal.
          origin: { kind: 'approved-plan-registration', formalVersion: false, sequence: 1, sourceWorkPlanId: null },
          registrationStatus: 'in-registration',
          values: emptyValues(),
          // Documento aprovado: armazenamento indisponível; referência preparada, sem arquivo.
          document: { status: 'not-stored', storagePath: null },
          revision: 1,
          startRequestId: requestId,
          createdAt: now,
          createdBy: uid,
          updatedAt: now,
          updatedBy: uid,
        })
        tx.create(events.doc(), { action: 'start', oscId, partnershipId, workPlanId: ORIGINAL_WORK_PLAN_ID, actorUid: uid, actorAuthority: decision.authority, revision: 1, at: now })
        return json(201, { ok: true, created: true, workPlan: { id: ORIGINAL_WORK_PLAN_ID, revision: 1, registrationStatus: 'in-registration' } })
      }

      if (!planSnap?.exists) throw new Outcome(json(409, { error: 'not-structured' }))
      const snap: DocumentSnapshot = planSnap
      const current = revisionOf(snap)
      if (current !== request.expectedRevision) throw new Outcome(json(409, { error: 'stale', revision: current }))
      const values = storedValues(snap, today)

      if (request.kind === 'update') {
        const validation = validateChanges(request.changes, values, today)
        if (!validation.ok) throw new Outcome(json(422, { error: 'invalid-values', fields: validation.errors }))
        const changed = (Object.entries(validation.changes) as [WorkPlanField, PlanValue][]).filter(([id, value]) => JSON.stringify(values[id]) !== JSON.stringify(value))
        if (changed.length === 0) return json(200, { ok: true, changed: false, workPlan: { id: ORIGINAL_WORK_PLAN_ID, revision: current, registrationStatus: registration } })
        tx.update(planRef, {
          ...Object.fromEntries(changed.map(([id, value]) => [`values.${id}`, value])),
          revision: current + 1,
          lastUpdateRequestId: requestId,
          updatedAt: now,
          updatedBy: uid,
        })
        tx.create(events.doc(), { action: 'update', oscId, partnershipId, workPlanId: ORIGINAL_WORK_PLAN_ID, actorUid: uid, actorAuthority: decision.authority, fields: changed.map(([id]) => id), fromRevision: current, toRevision: current + 1, at: now })
        return json(200, { ok: true, changed: true, workPlan: { id: ORIGINAL_WORK_PLAN_ID, revision: current + 1, registrationStatus: 'in-registration' } })
      }

      if (request.kind === 'correct') {
        const validation = validateCorrection(request, values, partnership, today)
        if (!validation.ok) throw new Outcome(json(422, { error: 'invalid-correction', fields: validation.errors, ...(validation.pending ? { pending: validation.pending } : {}) }))
        // Representação atual + evento append-only na MESMA transação. Finalização original intacta.
        tx.update(planRef, {
          ...Object.fromEntries(validation.items.map((item) => [`values.${item.field}`, item.after])),
          revision: current + 1,
          lastCorrectionAt: now,
          lastCorrectionBy: uid,
          correctionCount: FieldValue.increment(1),
          updatedAt: now,
          updatedBy: uid,
        })
        tx.create(events.doc(correctionEventId(uid, requestId)), {
          action: 'material-correction',
          oscId,
          partnershipId,
          workPlanId: ORIGINAL_WORK_PLAN_ID,
          actorUid: uid,
          actorAuthority: decision.authority,
          requestId,
          corrections: validation.items.map((item) => ({ field: item.field, before: item.before, after: item.after })),
          justification: validation.justification,
          declaration: { accepted: true, text: CORRECTION_DECLARATION, automatedVerification: false },
          fromRevision: current,
          toRevision: current + 1,
          at: now,
        })
        return json(200, { ok: true, corrected: true, workPlan: { id: ORIGINAL_WORK_PLAN_ID, revision: current + 1, registrationStatus: 'finalized' }, warnings: validation.warnings })
      }

      // Finalização interna (DEC-038): requisitos aprovados, autoria e preservação.
      const check = checkFinalization(values, partnership)
      if (check.pending.length > 0) throw new Outcome(json(422, { error: 'finalization-pending', pending: check.pending, warnings: check.warnings }))
      tx.update(planRef, {
        registrationStatus: 'finalized',
        revision: current + 1,
        finalizationRequestId: requestId,
        finalizedAt: now,
        finalizedBy: uid,
        updatedAt: now,
        updatedBy: uid,
      })
      tx.create(events.doc(), { action: 'finalize', oscId, partnershipId, workPlanId: ORIGINAL_WORK_PLAN_ID, actorUid: uid, actorAuthority: decision.authority, fromRevision: current, toRevision: current + 1, warnings: check.warnings.length, at: now })
      return json(200, { ok: true, finalized: true, workPlan: { id: ORIGINAL_WORK_PLAN_ID, revision: current + 1, registrationStatus: 'finalized' }, warnings: check.warnings })
    })
  } catch (error) {
    if (error instanceof Outcome) return error.response
    throw error
  }
}

export const correctionEventId = (uid: string, requestId: string) => `correction_${uid}_${requestId}`

const MAX_HISTORY = 200

/**
 * Histórico de correções materiais (DEC-PT-002), servido SOMENTE pelo servidor: a auditoria é
 * ilegível pelo navegador (Security Rules). Exige `work-plan.view` na OSC (mesma regra da
 * consulta do Plano, inclusive na suspensão comercial) e parceria da própria OSC. O responsável
 * é identificado apenas como "você" ou pela competência (sem e-mails de terceiros).
 */
async function history(deps: ServerDeps, uid: string, oscId: string, partnershipId: string): Promise<ApiResponse> {
  const [oscSnap, actorSnap, partnershipSnap] = await deps.db.getAll(deps.db.doc(`oscs/${oscId}`), deps.db.doc(`oscs/${oscId}/members/${uid}`), deps.db.doc(`oscs/${oscId}/partnerships/${partnershipId}`))
  const context: AuthorizationContext = { uid, oscId, organization: organizationFacts(oscSnap, oscId), membership: membershipFacts(actorSnap, oscId, uid) }
  const decision = evaluate(context, { kind: 'consult', permission: VIEW_PERMISSION })
  if (!decision.allowed) return json(403, { error: 'forbidden', reason: decision.reason })
  if (!partnershipFacts(partnershipSnap, oscId)) return json(404, { error: 'not-found' })
  const snapshot = await deps.db
    .collection(`oscs/${oscId}/workPlanEvents`)
    .where('partnershipId', '==', partnershipId)
    .where('action', '==', 'material-correction')
    .limit(MAX_HISTORY)
    .get()
  const entries = snapshot.docs
    .map((d) => d.data())
    .filter((e) => e.oscId === oscId && e.workPlanId === ORIGINAL_WORK_PLAN_ID)
    .map((e) => ({
      at: e.at && typeof e.at.toDate === 'function' ? (e.at.toDate() as Date).toISOString() : null,
      actor: e.actorUid === uid ? 'you' : 'other',
      actorAuthority: e.actorAuthority,
      corrections: e.corrections,
      justification: e.justification,
      fromRevision: e.fromRevision,
      toRevision: e.toRevision,
    }))
    .sort((a, b) => (a.toRevision as number) - (b.toRevision as number))
  return json(200, { ok: true, partnershipId, workPlanId: ORIGINAL_WORK_PLAN_ID, entries })
}

/** Ponto de entrada independente de plataforma. */
export async function handleWorkPlansRequest(request: ApiRequest, deps: ServerDeps | null, { today = serverToday() }: WorkPlansOptions = {}): Promise<ApiResponse> {
  if (deps === null) return json(503, { error: 'not-configured' })
  if (request.method !== 'POST' && request.method !== 'PATCH' && request.method !== 'GET') return json(405, { error: 'method-not-allowed' })
  const token = bearerToken(request.authorization)
  if (!token) return json(401, { error: 'invalid-token' })
  let uid: string
  try {
    uid = (await deps.verifyIdToken(token)).uid
  } catch (error) {
    return json(401, { error: authErrorCode(error) })
  }
  if (request.method === 'GET') {
    const oscId = request.query.get('oscId')
    const partnershipId = request.query.get('partnershipId')
    const keys = [...request.query.keys()]
    if (!oscId || !partnershipId || !ID_PATTERN.test(oscId) || !ID_PATTERN.test(partnershipId) || keys.length !== 2) return json(400, { error: 'invalid-request' })
    try {
      return await history(deps, uid, oscId, partnershipId)
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown'
      console.error(`[osc-work-plans] falha interna (${code})`)
      return json(500, { error: 'internal' })
    }
  }
  const parsed = parse(request.method, request.rawBody)
  if (!parsed) return json(400, { error: 'invalid-request' })
  try {
    return await run(deps, uid, parsed, today)
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown'
    console.error(`[osc-work-plans] falha interna (${code})`)
    return json(500, { error: 'internal' })
  }
}
