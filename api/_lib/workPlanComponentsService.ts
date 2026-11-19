/**
 * Metas e indicadores PREVISTOS do Plano de Trabalho (DEV-02.4) — AMBIENTE CONFIÁVEL (servidor).
 *
 * POST  {oscId, partnershipId, workPlanId, requestId, action: 'create-goal' | 'create-indicator', data}
 * PATCH {oscId, partnershipId, workPlanId, requestId, componentKind: 'goal' | 'indicator', componentId, expectedRevision, data}
 *
 * `data` é o componente COMPLETO (validado por inteiro). A consulta é feita pelo cliente sob as
 * Security Rules (`work-plan.view`); nenhuma escrita pelo navegador.
 *
 * Transação: OSC, vínculo, parceria, versão e TODOS os componentes da versão são relidos →
 * `work-plan.edit` antes de revelar a parceria → arquivada/suspensão comercial → versão em
 * cadastramento (finalizada = sem alteração comum; sem componentes = transcrição complementar
 * BLOQUEADA, aguardando decisão administrativa) → validação, código único, limites e integridade
 * dos vínculos → revisão (concorrência) → gravação + auditoria. IDs lógicos determinísticos por
 * usuário e pedido: reenvios e pedidos simultâneos colidem no mesmo documento.
 */
import { createHash } from 'node:crypto'
import { FieldValue, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore'
import type { AuthorizationContext } from '../../src/domain/authorization.ts'
import {
  LIMITS,
  isComponentId,
  isDuplicateCode,
  linkIntegrity,
  validateGoal,
  validateIndicator,
  type ComponentKind,
  type GoalData,
  type IndicatorData,
  type Stored,
} from '../../src/domain/workPlanComponents.ts'
import { isVersionId } from '../../src/domain/workPlanVersions.ts'
import { decideWorkPlanOperation, type WorkPlanDenial } from '../../src/domain/workPlans.ts'
import { MAX_BODY_BYTES } from './limits.ts'
import { membershipFacts, organizationFacts, type ApiRequest, type ApiResponse, type ServerDeps } from './permissionsService.ts'
import { authErrorCode, bearerToken, partnershipFacts } from './workPlansService.ts'

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
const json = (status: number, body: Record<string, unknown>): ApiResponse => ({ status, body })
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isRevision = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1
const sameKeys = (r: Record<string, unknown>, keys: string[]) => Object.keys(r).length === keys.length && keys.every((k) => k in r)

type Parsed =
  | { kind: 'create'; componentKind: ComponentKind; oscId: string; partnershipId: string; workPlanId: string; requestId: string; data: unknown }
  | { kind: 'update'; componentKind: ComponentKind; oscId: string; partnershipId: string; workPlanId: string; requestId: string; componentId: string; expectedRevision: number; data: unknown }

function parse(method: string | undefined, rawBody: string): Parsed | null {
  if (!rawBody || rawBody.length > MAX_BODY_BYTES) return null
  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (!isObject(body)) return null
  const { oscId, partnershipId, workPlanId, requestId } = body
  if (typeof oscId !== 'string' || !ID_PATTERN.test(oscId) || typeof partnershipId !== 'string' || !ID_PATTERN.test(partnershipId)) return null
  if (!isVersionId(workPlanId) || typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) return null
  const base = { oscId, partnershipId, workPlanId, requestId, data: body.data }
  if (method === 'POST' && sameKeys(body, ['oscId', 'partnershipId', 'workPlanId', 'requestId', 'action', 'data'])) {
    if (body.action === 'create-goal') return { kind: 'create', componentKind: 'goal', ...base }
    if (body.action === 'create-indicator') return { kind: 'create', componentKind: 'indicator', ...base }
    return null
  }
  if (method === 'PATCH' && sameKeys(body, ['oscId', 'partnershipId', 'workPlanId', 'requestId', 'componentKind', 'componentId', 'expectedRevision', 'data'])) {
    if ((body.componentKind !== 'goal' && body.componentKind !== 'indicator') || !isComponentId(body.componentId) || !isRevision(body.expectedRevision)) return null
    if ((body.componentKind === 'goal') !== body.componentId.startsWith('g_')) return null
    return { kind: 'update', componentKind: body.componentKind, ...base, componentId: body.componentId, expectedRevision: body.expectedRevision }
  }
  return null
}

/** ID lógico determinístico por usuário e pedido (idempotência e colisão de pedidos simultâneos). */
export const componentIdFor = (kind: ComponentKind, uid: string, requestId: string) => `${kind === 'goal' ? 'g' : 'i'}_${createHash('sha256').update(`${kind}:${uid}:${requestId}`).digest('hex').slice(0, 20)}`

class Outcome extends Error {
  readonly response: ApiResponse
  constructor(response: ApiResponse) {
    super('outcome')
    this.response = response
  }
}
type ComponentDenial = WorkPlanDenial | 'complementary-transcription-pending'
const CONFLICTS: readonly ComponentDenial[] = ['already-finalized', 'complementary-transcription-pending']
const deny = (reason: ComponentDenial) => new Outcome(json(CONFLICTS.includes(reason) ? 409 : 403, { error: 'forbidden', reason }))

function storedOf<T>(snap: DocumentSnapshot, kind: ComponentKind, knownGoals: ReadonlySet<string>): Stored<T> {
  const raw: unknown = snap.get('data')
  const v = kind === 'goal' ? validateGoal(raw) : validateIndicator(raw, knownGoals)
  // Componente gravado inválido: nada é presumido; a operação é recusada.
  if (!v.ok) throw new Outcome(json(409, { error: 'invalid-state' }))
  const revision: unknown = snap.get('revision')
  return { id: snap.id, kind, data: v.data as T, revision: isRevision(revision) ? revision : 1 }
}

const changedFields = (before: Record<string, unknown> | null, after: Record<string, unknown>) =>
  Object.keys(after).filter((k) => before === null || JSON.stringify(before[k]) !== JSON.stringify(after[k]))

async function run(deps: ServerDeps, uid: string, request: Parsed): Promise<ApiResponse> {
  const { oscId, partnershipId, workPlanId, requestId, componentKind } = request
  const oscRef = deps.db.doc(`oscs/${oscId}`)
  const actorRef = deps.db.doc(`oscs/${oscId}/members/${uid}`)
  const partnershipRef = deps.db.doc(`oscs/${oscId}/partnerships/${partnershipId}`)
  const planRef = partnershipRef.collection('workPlans').doc(workPlanId)
  const events = deps.db.collection(`oscs/${oscId}/workPlanEvents`)
  const collection = componentKind === 'goal' ? 'goals' : 'indicators'
  const componentId = request.kind === 'create' ? componentIdFor(componentKind, uid, requestId) : request.componentId
  const ref = planRef.collection(collection).doc(componentId)

  try {
    return await deps.db.runTransaction(async (tx: Transaction) => {
      const [oscSnap, actorSnap, partnershipSnap, planSnap] = await tx.getAll(oscRef, actorRef, partnershipRef, planRef)
      const context: AuthorizationContext = { uid, oscId, organization: organizationFacts(oscSnap, oscId), membership: membershipFacts(actorSnap, oscId, uid) }
      // 1. Permissão antes de revelar parceria ou versão (conhecer IDs não autoriza nada).
      const permission = decideWorkPlanOperation(context, 'update', 'em-execucao', 'in-registration')
      if (!permission.allowed && permission.reason !== 'partnership-archived') throw deny(permission.reason)
      const partnership = partnershipFacts(partnershipSnap, oscId)
      if (!partnership) throw new Outcome(json(404, { error: 'not-found' }))
      if (!planSnap?.exists || planSnap.get('partnershipId') !== partnershipId || planSnap.get('oscId') !== oscId) throw new Outcome(json(404, { error: 'not-found' }))
      const [goalsSnap, indicatorsSnap] = await Promise.all([
        tx.get(planRef.collection('goals').limit(LIMITS.goalsPerVersion + 1)),
        tx.get(planRef.collection('indicators').limit(LIMITS.indicatorsPerVersion + 1)),
      ])
      const target = (componentKind === 'goal' ? goalsSnap : indicatorsSnap).docs.find((d) => d.id === componentId)

      // 2. Reenvio do MESMO pedido pelo MESMO usuário: devolve o estado confirmado.
      if (target && request.kind === 'create' && target.get('creationRequestId') === requestId && target.get('createdBy') === uid) {
        return json(200, { ok: true, created: false, component: { id: componentId, kind: componentKind, revision: target.get('revision') } })
      }
      if (target && request.kind === 'update' && target.get('lastUpdateRequestId') === requestId && target.get('updatedBy') === uid) {
        return json(200, { ok: true, changed: false, component: { id: componentId, kind: componentKind, revision: target.get('revision') } })
      }

      // 3. Ciclo de vida: parceria e versão (finalizada = sem edição comum).
      const registration = planSnap.get('registrationStatus') === 'finalized' ? 'finalized' : 'in-registration'
      const decision = decideWorkPlanOperation(context, 'update', partnership.administrativeStatus, registration)
      if (!decision.allowed) {
        // Plano finalizado SEM componentes: a transcrição complementar depende de decisão administrativa.
        if (decision.reason === 'already-finalized' && goalsSnap.empty && indicatorsSnap.empty) throw deny('complementary-transcription-pending')
        throw deny(decision.reason)
      }

      // 4. Estado atual da versão (componentes relidos e revalidados).
      const goalIds = new Set(goalsSnap.docs.map((d) => d.id))
      const goals = goalsSnap.docs.map((d) => storedOf<GoalData>(d, 'goal', goalIds))
      const indicators = indicatorsSnap.docs.map((d) => storedOf<IndicatorData>(d, 'indicator', goalIds))
      if (request.kind === 'create') {
        if (target) throw new Outcome(json(409, { error: 'conflict' })) // ID ocupado por outro pedido (não ocorre na prática)
        if (componentKind === 'goal' ? goals.length >= LIMITS.goalsPerVersion : indicators.length >= LIMITS.indicatorsPerVersion) throw new Outcome(json(422, { error: 'invalid-component', fields: { [componentKind]: 'too-many' } }))
      } else {
        if (!target) throw new Outcome(json(404, { error: 'not-found' }))
        const current = (componentKind === 'goal' ? goals : indicators).find((c) => c.id === componentId) as Stored<GoalData | IndicatorData>
        if (current.revision !== request.expectedRevision) throw new Outcome(json(409, { error: 'stale', revision: current.revision }))
      }

      // 5. Validação do componente completo, código único e vínculos.
      const validation = componentKind === 'goal' ? validateGoal(request.data) : validateIndicator(request.data, goalIds)
      if (!validation.ok) throw new Outcome(json(422, { error: 'invalid-component', fields: validation.errors }))
      const data = validation.data as GoalData | IndicatorData
      const peers = (componentKind === 'goal' ? goals : indicators).map((c) => ({ id: c.id, code: c.data.code }))
      if (isDuplicateCode(data.code, peers, componentId)) throw new Outcome(json(422, { error: 'invalid-component', fields: { code: 'duplicate-code' } }))
      const nextGoals = componentKind === 'goal' ? [...goals.filter((g) => g.id !== componentId), { id: componentId, kind: 'goal' as const, data: data as GoalData, revision: 1 }] : goals
      const nextIndicators = componentKind === 'indicator' ? [...indicators.filter((i) => i.id !== componentId), { id: componentId, kind: 'indicator' as const, data: data as IndicatorData, revision: 1 }] : indicators
      const integrity = linkIntegrity(nextGoals, nextIndicators)
      if (!integrity.ok) {
        throw new Outcome(json(422, { error: 'invalid-component', fields: componentKind === 'goal' ? { status: 'linked-indicators' } : { goalIds: 'discontinued-goal' }, goalId: integrity.goalId }))
      }

      const now = FieldValue.serverTimestamp()
      const before = request.kind === 'update' ? ((componentKind === 'goal' ? goals : indicators).find((c) => c.id === componentId)?.data as unknown as Record<string, unknown>) : null
      const fields = changedFields(before, data as unknown as Record<string, unknown>)
      if (request.kind === 'update' && fields.length === 0) return json(200, { ok: true, changed: false, component: { id: componentId, kind: componentKind, revision: request.expectedRevision } })
      const revision = request.kind === 'create' ? 1 : request.expectedRevision + 1
      const meta = { updatedAt: now, updatedBy: uid, lastUpdateRequestId: requestId }
      if (request.kind === 'create') {
        tx.create(ref, { id: componentId, kind: componentKind, oscId, partnershipId, workPlanId, data, revision, creationRequestId: requestId, createdAt: now, createdBy: uid, inheritedFrom: null, ...meta })
      } else {
        tx.update(ref, { data, revision, ...meta })
      }
      tx.create(events.doc(), {
        action: `${componentKind}-${request.kind === 'create' ? 'created' : 'updated'}`,
        oscId,
        partnershipId,
        workPlanId,
        sequence: planSnap.get('origin.sequence') ?? 1,
        componentKind,
        componentId,
        code: data.code,
        fields,
        linksChanged: fields.includes('goalIds'),
        periodicityChanged: fields.includes('periodicity'),
        criteriaChanged: fields.some((f) => ['rule', 'target', 'expectedParameter', 'categories', 'classificationCriterion', 'completionCriterion', 'expectedQuantity', 'expectedResult'].includes(f)),
        statusChanged: fields.includes('status') ? (data.status as string) : null,
        actorUid: uid,
        actorAuthority: decision.authority,
        requestId,
        fromRevision: request.kind === 'create' ? 0 : request.expectedRevision,
        toRevision: revision,
        at: now,
      })
      return json(request.kind === 'create' ? 201 : 200, { ok: true, [request.kind === 'create' ? 'created' : 'changed']: true, component: { id: componentId, kind: componentKind, revision } })
    })
  } catch (error) {
    if (error instanceof Outcome) return error.response
    throw error
  }
}

/** Ponto de entrada independente de plataforma. */
export async function handleWorkPlanComponentsRequest(request: ApiRequest, deps: ServerDeps | null): Promise<ApiResponse> {
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
  const parsed = parse(request.method, request.rawBody)
  if (!parsed) return json(400, { error: 'invalid-request' })
  try {
    return await run(deps, uid, parsed)
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown'
    console.error(`[osc-work-plan-components] falha interna (${code})`)
    return json(500, { error: 'internal' })
  }
}
