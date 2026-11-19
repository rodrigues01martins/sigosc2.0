/**
 * Plano de Trabalho aprovado — cadastro, finalização, correção material e VERSIONAMENTO
 * (DEV-02.2, DEV-02.2-C01 e DEV-02.3) — AMBIENTE CONFIÁVEL (servidor).
 *
 * POST  {oscId, partnershipId, requestId, action: 'start'}                                   → iniciar a versão original
 * PATCH {oscId, partnershipId, [workPlanId], requestId, expectedRevision, changes}           → editar cadastro em andamento
 * PATCH {oscId, partnershipId, workPlanId, requestId, expectedRevision, formalAct}           → editar o ato formal (versão em andamento)
 * POST  {..., [workPlanId], action: 'finalize', expectedRevision, confirm: true}             → finalizar internamente
 *       (versão posterior: finalização + ATIVAÇÃO cadastral na mesma transação — DEC-PT-003)
 * POST  {..., [workPlanId], action: 'correct', expectedRevision, changes, justification, declaration} → correção material
 * POST  {..., action: 'create-version', baseWorkPlanId, baseRevision, formalAct}             → nova versão (alteração formal)
 * GET   ?oscId=…&partnershipId=…[&workPlanId=…]                                              → histórico de correções
 *
 * Todas as gravações exigem `work-plan.edit` (DEC-PT-001); o histórico exige `work-plan.view`.
 * Sem `workPlanId`, as operações atuam sobre `original` (contratos da DEV-02.2 preservados).
 *
 * Em cada requisição: token → corpo ESTRITO → TRANSAÇÃO que relê OSC, vínculo, parceria e o(s)
 * documento(s) do Plano → permissão ANTES de revelar a parceria → arquivada = somente consulta →
 * situação do cadastro → revisão técnica (concorrência) → validação → gravação + auditoria.
 *
 * Versões: documentos `workPlans/{original|v2|v3…}` com `origin.sequence` (cadeia FORMAL) distinta
 * de `revision` (técnica). A criação é atômica: a versão seguinte tem ID determinístico, e pedidos
 * simultâneos colidem no mesmo documento. A versão anterior nunca é modificada pela criação.
 * Não há ação manual de ativação (DEC-PT-003): `action: 'activate'` é recusada como corpo inválido.
 * Na ativação, a versão substituída recebe SOMENTE `activation.*` (valores, revisão e finalização intactos).
 */
import { FieldValue, type DocumentSnapshot } from 'firebase-admin/firestore'
import { evaluate, type AuthorizationContext } from '../../src/domain/authorization.ts'
import { isAdministrativeStatus, isInstrument, isValidDate } from '../../src/domain/partnerships.ts'
import {
  checkVersionFinalization,
  checkActivationChain,
  effectsStatus,
  parseStoredActivation,
  decideVersionCreation,
  isVersionId,
  validateFormalAct,
  versionIdFor,
  type FormalAct,
  type VersionDenial,
  type VersionSummary,
} from '../../src/domain/workPlanVersions.ts'
import {
  CORRECTION_DECLARATION,
  EDIT_PERMISSION,
  FIELD_IDS,
  ORIGINAL_WORK_PLAN_ID,
  VIEW_PERMISSION,
  decideWorkPlanOperation,
  emptyValues,
  parseFieldValue,
  validateChanges,
  validateCorrection,
  type FieldValue as PlanValue,
  type PartnershipFacts,
  type WorkPlanField,
  type WorkPlanSituation,
  type WorkPlanValues,
} from '../../src/domain/workPlans.ts'
import { MAX_BODY_BYTES } from './limits.ts'
import { serverToday } from './partnershipsService.ts'
import { membershipFacts, organizationFacts, type ApiRequest, type ApiResponse, type ServerDeps } from './permissionsService.ts'

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
const MAX_VERSIONS = 200

export interface WorkPlansOptions {
  readonly today?: string
}

interface Base {
  oscId: string
  partnershipId: string
  requestId: string
}
type Parsed =
  | (Base & { kind: 'start' })
  | (Base & { kind: 'finalize'; workPlanId: string; expectedRevision: number })
  | (Base & { kind: 'update'; workPlanId: string; expectedRevision: number; changes: Record<string, unknown> })
  | (Base & { kind: 'update-act'; workPlanId: string; expectedRevision: number; formalAct: unknown })
  | (Base & { kind: 'correct'; workPlanId: string; expectedRevision: number; changes: unknown; justification: unknown; declaration: unknown })
  | (Base & { kind: 'create-version'; baseWorkPlanId: string; baseRevision: number; formalAct: unknown })

const json = (status: number, body: Record<string, unknown>): ApiResponse => ({ status, body })
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** Chaves obrigatórias exatas + `workPlanId` opcional (compatibilidade com a DEV-02.2). */
const keysMatch = (r: Record<string, unknown>, keys: string[], optionalWorkPlanId = true) => {
  const extra = Object.keys(r).filter((k) => !keys.includes(k))
  return keys.every((k) => k in r) && extra.every((k) => optionalWorkPlanId && k === 'workPlanId')
}
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
  const workPlanId = body.workPlanId === undefined ? ORIGINAL_WORK_PLAN_ID : body.workPlanId
  if (!isVersionId(workPlanId)) return null
  const base = { oscId, partnershipId, requestId }
  if (method === 'PATCH') {
    if (!isRevision(body.expectedRevision)) return null
    if (keysMatch(body, ['oscId', 'partnershipId', 'requestId', 'expectedRevision', 'changes']) && isObject(body.changes)) {
      return { ...base, kind: 'update', workPlanId, expectedRevision: body.expectedRevision, changes: body.changes }
    }
    if (keysMatch(body, ['oscId', 'partnershipId', 'workPlanId', 'requestId', 'expectedRevision', 'formalAct'], false)) {
      return { ...base, kind: 'update-act', workPlanId, expectedRevision: body.expectedRevision, formalAct: body.formalAct }
    }
    return null
  }
  if (body.action === 'start' && keysMatch(body, ['oscId', 'partnershipId', 'requestId', 'action'], false)) return { ...base, kind: 'start' }
  if (body.action === 'finalize' && keysMatch(body, ['oscId', 'partnershipId', 'requestId', 'action', 'expectedRevision', 'confirm'])) {
    // A confirmação explícita é exigida também no servidor (operação que preserva o registro).
    if (body.confirm !== true || !isRevision(body.expectedRevision)) return null
    return { ...base, kind: 'finalize', workPlanId, expectedRevision: body.expectedRevision }
  }
  if (body.action === 'correct' && keysMatch(body, ['oscId', 'partnershipId', 'requestId', 'action', 'expectedRevision', 'changes', 'justification', 'declaration'])) {
    if (!isRevision(body.expectedRevision)) return null
    return { ...base, kind: 'correct', workPlanId, expectedRevision: body.expectedRevision, changes: body.changes, justification: body.justification, declaration: body.declaration }
  }
  if (body.action === 'create-version' && keysMatch(body, ['oscId', 'partnershipId', 'requestId', 'action', 'baseWorkPlanId', 'baseRevision', 'formalAct'], false)) {
    if (!isVersionId(body.baseWorkPlanId) || !isRevision(body.baseRevision)) return null
    return { ...base, kind: 'create-version', baseWorkPlanId: body.baseWorkPlanId, baseRevision: body.baseRevision, formalAct: body.formalAct }
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
const CONFLICTS: readonly VersionDenial[] = ['already-finalized', 'not-finalized', 'base-not-current', 'base-not-finalized', 'pending-version-exists', 'legacy-version-pending', 'versions-inconsistent']
const deny = (reason: VersionDenial) => new Outcome(json(CONFLICTS.includes(reason) ? 409 : 403, { error: 'forbidden', reason }))

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
const sequenceOf = (snap: DocumentSnapshot) => {
  const value: unknown = snap.get('origin.sequence')
  return isRevision(value) ? value : snap.id === ORIGINAL_WORK_PLAN_ID ? 1 : 0
}
const registrationOf = (snap: DocumentSnapshot | undefined): WorkPlanSituation =>
  !snap?.exists ? 'not-structured' : snap.get('registrationStatus') === 'finalized' ? 'finalized' : 'in-registration'
const storedAct = (snap: DocumentSnapshot): FormalAct | null => {
  const act = snap.get('formalAct') as Record<string, unknown> | undefined
  if (!act) return null
  const { type, typeDescription, reference, actDate, description, effectiveDate } = act
  return { type, typeDescription, reference, actDate, description, effectiveDate } as FormalAct
}
function summaryOf(snap: DocumentSnapshot): VersionSummary {
  const previous: unknown = snap.get('origin.previousWorkPlanId')
  return {
    id: snap.id,
    sequence: sequenceOf(snap),
    registrationStatus: snap.get('registrationStatus') === 'finalized' ? 'finalized' : 'in-registration',
    activationStatus: parseStoredActivation(snap.get('activation.status')),
    previousWorkPlanId: isVersionId(previous) ? previous : null,
  }
}
const isoOf = (value: unknown) => (value && typeof (value as { toDate?: unknown }).toDate === 'function' ? (value as { toDate(): Date }).toDate().toISOString() : null)
/** Estado CONFIRMADO de uma versão finalizada (resposta da finalização e de seus reenvios). */
function finalizedState(snap: DocumentSnapshot, revision: number) {
  const sequence = sequenceOf(snap)
  const status = parseStoredActivation(snap.get('activation.status'))
  return {
    id: snap.id,
    revision,
    registrationStatus: 'finalized' as const,
    sequence,
    activationStatus: sequence === 1 ? (status === 'superseded' ? 'superseded' : 'original-current') : status,
    supersededWorkPlanId: (snap.get('activation.supersededWorkPlanId') as string | undefined) ?? null,
    activatedAt: isoOf(snap.get('activation.activatedAt')),
    effectiveDate: sequence > 1 ? (storedAct(snap)?.effectiveDate ?? null) : null,
  }
}

export const correctionEventId = (uid: string, requestId: string) => `correction_${uid}_${requestId}`

async function run(deps: ServerDeps, uid: string, request: Parsed, today: string): Promise<ApiResponse> {
  const { oscId, partnershipId, requestId } = request
  const oscRef = deps.db.doc(`oscs/${oscId}`)
  const actorRef = deps.db.doc(`oscs/${oscId}/members/${uid}`)
  const partnershipRef = deps.db.doc(`oscs/${oscId}/partnerships/${partnershipId}`)
  const plans = partnershipRef.collection('workPlans')
  const workPlanId = request.kind === 'start' ? ORIGINAL_WORK_PLAN_ID : request.kind === 'create-version' ? request.baseWorkPlanId : request.workPlanId
  const planRef = plans.doc(workPlanId)
  const events = deps.db.collection(`oscs/${oscId}/workPlanEvents`)

  try {
    return await deps.db.runTransaction(async (tx) => {
      const [oscSnap, actorSnap, partnershipSnap, planSnap] = await tx.getAll(oscRef, actorRef, partnershipRef, planRef)
      const context: AuthorizationContext = { uid, oscId, organization: organizationFacts(oscSnap, oscId), membership: membershipFacts(actorSnap, oscId, uid) }

      // 1. Permissão antes de revelar se a parceria existe (conhecer um ID não autoriza nada).
      const base = evaluate(context, { kind: 'operate', permission: EDIT_PERMISSION })
      if (!base.allowed) throw deny(base.reason)

      // 2. Parceria da MESMA OSC (o caminho já isola; o documento é conferido).
      const partnership = partnershipFacts(partnershipSnap, oscId)
      if (!partnership) throw new Outcome(json(404, { error: 'not-found' }))
      if (planSnap?.exists && planSnap.get('partnershipId') !== partnershipId) throw new Outcome(json(409, { error: 'invalid-state' }))
      const now = FieldValue.serverTimestamp()

      // ------------------------------------------------------------- versionamento
      if (request.kind === 'create-version') {
        const all = await tx.get(plans.limit(MAX_VERSIONS))
        // Reenvio do MESMO pedido: devolve a versão já criada.
        const previous = all.docs.find((d) => d.get('creationRequestId') === requestId && d.get('createdBy') === uid && sequenceOf(d) > 1)
        if (previous) return json(200, { ok: true, created: false, workPlan: { id: previous.id, revision: revisionOf(previous), registrationStatus: registrationOf(previous) } })
        const versions = all.docs.filter((d) => d.get('partnershipId') === partnershipId).map(summaryOf)
        const decision = decideVersionCreation(context, partnership.administrativeStatus, versions, request.baseWorkPlanId)
        if (!decision.allowed) throw deny(decision.reason)
        const baseSnap = planSnap as DocumentSnapshot
        if (revisionOf(baseSnap) !== request.baseRevision) throw new Outcome(json(409, { error: 'stale', revision: revisionOf(baseSnap) }))
        const act = validateFormalAct(request.formalAct, today)
        if (!act.ok) throw new Outcome(json(422, { error: 'invalid-formal-act', fields: act.errors }))
        const sequence = Math.max(...versions.map((v) => v.sequence)) + 1
        const id = versionIdFor(sequence)
        tx.create(plans.doc(id), {
          schemaVersion: 1,
          id,
          oscId,
          partnershipId,
          // Cadeia formal (DEC-034): origem, anterior e base copiada; NÃO é validação jurídica.
          origin: { kind: 'formal-alteration', formalVersion: true, sequence, sourceWorkPlanId: ORIGINAL_WORK_PLAN_ID, previousWorkPlanId: request.baseWorkPlanId, baseRevision: request.baseRevision },
          formalAct: { ...act.act, declaredBy: uid, declaredAt: now, automatedVerification: false },
          // DEC-PT-003: em cadastramento ainda NÃO é vigente; a finalização a ativará.
          activation: { status: 'awaiting-finalization' },
          registrationStatus: 'in-registration',
          // Cópia INTEGRAL da versão vigente (valores corrigidos inclusive), com estados de informação.
          values: storedValues(baseSnap, today),
          document: { status: 'not-stored', storagePath: null },
          revision: 1,
          creationRequestId: requestId,
          createdAt: now,
          createdBy: uid,
          updatedAt: now,
          updatedBy: uid,
        })
        tx.create(events.doc(), { action: 'version-created', oscId, partnershipId, workPlanId: id, previousWorkPlanId: request.baseWorkPlanId, baseRevision: request.baseRevision, sequence, actType: act.act.type, actorUid: uid, actorAuthority: decision.authority, at: now })
        return json(201, { ok: true, created: true, workPlan: { id, revision: 1, registrationStatus: 'in-registration', sequence } })
      }

      // ------------------------------------------------------------- cadastro do documento indicado
      const registration = registrationOf(planSnap)
      if (planSnap?.exists) {
        const current = revisionOf(planSnap)
        const summary = { id: workPlanId, revision: current, registrationStatus: registration }
        if (request.kind === 'start' && registration === 'in-registration') return json(200, { ok: true, created: false, workPlan: summary })
        if ((request.kind === 'update' || request.kind === 'update-act') && planSnap.get('lastUpdateRequestId') === requestId && planSnap.get('updatedBy') === uid) {
          return json(200, { ok: true, changed: false, workPlan: summary })
        }
        if (request.kind === 'finalize' && registration === 'finalized' && planSnap.get('finalizationRequestId') === requestId && planSnap.get('finalizedBy') === uid) {
          // Reenvio: devolve o estado já confirmado (sem nova ativação, eventos ou revisão).
          return json(200, { ok: true, finalized: false, workPlan: finalizedState(planSnap, current) })
        }
        if (request.kind === 'correct') {
          // Evento com ID determinístico por usuário e pedido: marcador de idempotência e registro append-only.
          const previous = await tx.get(events.doc(correctionEventId(uid, requestId)))
          if (previous.exists) return json(200, { ok: true, corrected: false, workPlan: { ...summary, revision: previous.get('toRevision') as number } })
        }
      }

      const operation = request.kind === 'update-act' ? 'update' : request.kind
      const decision = decideWorkPlanOperation(context, operation, partnership.administrativeStatus, registration)
      if (!decision.allowed) throw deny(decision.reason)

      if (request.kind === 'start') {
        tx.create(planRef, {
          schemaVersion: 1,
          id: ORIGINAL_WORK_PLAN_ID,
          oscId,
          partnershipId,
          // Origem da cadeia de versões (DEC-034/039) — NÃO é versão formal.
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

      if (request.kind === 'update-act') {
        if (sequenceOf(snap) <= 1) throw new Outcome(json(422, { error: 'invalid-formal-act', fields: { formalAct: 'invalid' } }))
        const act = validateFormalAct(request.formalAct, today)
        if (!act.ok) throw new Outcome(json(422, { error: 'invalid-formal-act', fields: act.errors }))
        tx.update(planRef, {
          formalAct: { ...act.act, declaredBy: uid, declaredAt: now, automatedVerification: false },
          revision: current + 1,
          lastUpdateRequestId: requestId,
          updatedAt: now,
          updatedBy: uid,
        })
        tx.create(events.doc(), { action: 'formal-act-update', oscId, partnershipId, workPlanId, actorUid: uid, actorAuthority: decision.authority, fromRevision: current, toRevision: current + 1, at: now })
        return json(200, { ok: true, changed: true, workPlan: { id: workPlanId, revision: current + 1, registrationStatus: 'in-registration' } })
      }

      if (request.kind === 'update') {
        const validation = validateChanges(request.changes, values, today)
        if (!validation.ok) throw new Outcome(json(422, { error: 'invalid-values', fields: validation.errors }))
        const changed = (Object.entries(validation.changes) as [WorkPlanField, PlanValue][]).filter(([id, value]) => JSON.stringify(values[id]) !== JSON.stringify(value))
        if (changed.length === 0) return json(200, { ok: true, changed: false, workPlan: { id: workPlanId, revision: current, registrationStatus: registration } })
        tx.update(planRef, {
          ...Object.fromEntries(changed.map(([id, value]) => [`values.${id}`, value])),
          revision: current + 1,
          lastUpdateRequestId: requestId,
          updatedAt: now,
          updatedBy: uid,
        })
        tx.create(events.doc(), { action: 'update', oscId, partnershipId, workPlanId, actorUid: uid, actorAuthority: decision.authority, fields: changed.map(([id]) => id), fromRevision: current, toRevision: current + 1, at: now })
        return json(200, { ok: true, changed: true, workPlan: { id: workPlanId, revision: current + 1, registrationStatus: 'in-registration' } })
      }

      if (request.kind === 'correct') {
        const validation = validateCorrection(request, values, partnership, today)
        if (!validation.ok) throw new Outcome(json(422, { error: 'invalid-correction', fields: validation.errors, ...(validation.pending ? { pending: validation.pending } : {}) }))
        // Somente o documento INDICADO é alterado; versões, finalização e eventos anteriores intactos.
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
          workPlanId,
          sequence: sequenceOf(snap),
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
        return json(200, { ok: true, corrected: true, workPlan: { id: workPlanId, revision: current + 1, registrationStatus: 'finalized' }, warnings: validation.warnings })
      }

      // Finalização interna (DEC-038/PT-001): requisitos do Plano e, nas versões posteriores, do ato formal.
      const sequence = sequenceOf(snap)
      // DEC-PT-003: versão posterior → a origem precisa ser a vigente; leitura de TODAS as versões
      // nesta transação (pedidos concorrentes conflitam e são repetidos pelo Firestore).
      let supersededId: string | null = null
      let supersededSnap: DocumentSnapshot | undefined
      if (sequence > 1) {
        const all = await tx.get(plans.limit(MAX_VERSIONS))
        const docs = all.docs.filter((d) => d.get('partnershipId') === partnershipId)
        const chain = checkActivationChain(docs.map(summaryOf), workPlanId)
        if (!chain.ok) throw deny(chain.reason)
        supersededId = chain.supersededId
        supersededSnap = docs.find((d) => d.id === supersededId)
      }
      const act = sequence > 1 ? storedAct(snap) : null
      const check = checkVersionFinalization(values, partnership, act, today)
      if (check.pending.length > 0) throw new Outcome(json(422, { error: 'finalization-pending', pending: check.pending, warnings: check.warnings }))
      tx.update(planRef, {
        registrationStatus: 'finalized',
        revision: current + 1,
        finalizationRequestId: requestId,
        finalizedAt: now,
        finalizedBy: uid,
        updatedAt: now,
        updatedBy: uid,
        ...(supersededId
          ? { activation: { status: 'active', rule: 'DEC-PT-003', activatedAt: now, activatedBy: uid, supersededWorkPlanId: supersededId, finalizationRequestId: requestId } }
          : {}),
      })
      tx.create(events.doc(), { action: 'finalize', oscId, partnershipId, workPlanId, sequence, actorUid: uid, actorAuthority: decision.authority, requestId, fromRevision: current, toRevision: current + 1, warnings: check.warnings.length, at: now })
      if (supersededId && supersededSnap) {
        // Somente os metadados de vigência da versão substituída (sem revogação jurídica; valores intactos).
        tx.update(supersededSnap.ref, {
          'activation.status': 'superseded',
          'activation.supersededAt': now,
          'activation.supersededByWorkPlanId': workPlanId,
        })
        tx.create(events.doc(), {
          action: 'version-activated',
          rule: 'DEC-PT-003',
          oscId,
          partnershipId,
          workPlanId,
          sequence,
          previousWorkPlanId: supersededId,
          actorUid: uid,
          actorAuthority: decision.authority,
          requestId,
          revision: current + 1,
          effectiveDate: act?.effectiveDate ?? null,
          effectsAtActivation: effectsStatus(act?.effectiveDate, today),
          at: now,
        })
      }
      return json(200, {
        ok: true,
        finalized: true,
        workPlan: {
          id: workPlanId,
          revision: current + 1,
          registrationStatus: 'finalized',
          sequence,
          activationStatus: supersededId ? 'active' : 'original-current',
          supersededWorkPlanId: supersededId,
          activatedAt: null, // hora do servidor gravada na transação; disponível na releitura
          effectiveDate: act?.effectiveDate ?? null,
        },
        warnings: check.warnings,
      })
    })
  } catch (error) {
    if (error instanceof Outcome) return error.response
    throw error
  }
}

const MAX_HISTORY = 200

/**
 * Histórico de correções materiais (DEC-PT-002), servido SOMENTE pelo servidor: a auditoria é
 * ilegível pelo navegador (Security Rules). Exige `work-plan.view` na OSC (mesma regra da
 * consulta do Plano, inclusive na suspensão comercial) e parceria da própria OSC. O responsável
 * é identificado apenas como "você" ou pela competência (sem e-mails de terceiros).
 */
async function history(deps: ServerDeps, uid: string, oscId: string, partnershipId: string, workPlanId: string | null): Promise<ApiResponse> {
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
    .filter((e) => e.oscId === oscId && isVersionId(e.workPlanId) && (workPlanId === null || e.workPlanId === workPlanId))
    .map((e) => ({
      workPlanId: e.workPlanId as string,
      at: e.at && typeof e.at.toDate === 'function' ? (e.at.toDate() as Date).toISOString() : null,
      actor: e.actorUid === uid ? 'you' : 'other',
      actorAuthority: e.actorAuthority,
      corrections: e.corrections,
      justification: e.justification,
      fromRevision: e.fromRevision,
      toRevision: e.toRevision,
    }))
    .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '') || (a.toRevision as number) - (b.toRevision as number))
  return json(200, { ok: true, partnershipId, workPlanId, entries })
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
    const workPlanId = request.query.get('workPlanId')
    const keys = [...request.query.keys()]
    const allowed = keys.every((k) => k === 'oscId' || k === 'partnershipId' || k === 'workPlanId') && new Set(keys).size === keys.length
    if (!oscId || !partnershipId || !ID_PATTERN.test(oscId) || !ID_PATTERN.test(partnershipId) || !allowed || (workPlanId !== null && !isVersionId(workPlanId))) {
      return json(400, { error: 'invalid-request' })
    }
    try {
      return await history(deps, uid, oscId, partnershipId, workPlanId)
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
