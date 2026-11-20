/**
 * Planejamento financeiro PREVISTO do Plano de Trabalho (DEV-02.5) — AMBIENTE CONFIÁVEL (servidor).
 *
 * POST  {oscId, partnershipId, workPlanId, requestId, action: 'create-category' | 'create-item', data}
 * PATCH {oscId, partnershipId, workPlanId, requestId, kind: 'financial-category' | 'financial-item', id, expectedRevision, data}
 *
 * `data` é o registro COMPLETO (validado por inteiro). Consulta pelo cliente sob as Security Rules
 * (`work-plan.view`); nenhuma escrita pelo navegador. Exige `work-plan.edit` (componente do Plano;
 * `financial.*` é a gestão financeira OPERACIONAL e não autoriza alterar o Plano aprovado).
 *
 * Transação: OSC, vínculo, parceria, versão, categorias e itens relidos → permissão antes de revelar
 * a parceria → instrumento sem transferência = "não se aplica" → arquivada/suspensão comercial →
 * versão EM CADASTRAMENTO (finalizada: bloqueada; a incorporação da DEC-PT-006 não se estende ao
 * financeiro) → validação, código único, limites e integridade categoria–item → revisão → gravação +
 * auditoria. IDs lógicos determinísticos por usuário e pedido (reenvios colidem no mesmo documento).
 * Não há receitas, despesas, saldos nem totais persistidos: os totais são derivados dos itens.
 */
import { createHash } from 'node:crypto'
import { FieldValue, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore'
import type { AuthorizationContext } from '../../src/domain/authorization.ts'
import {
  FIN_LIMITS,
  financialApplicability,
  financialIntegrity,
  isDuplicateFinancialCode,
  isFinancialId,
  validateFinancialCategory,
  validateFinancialItem,
  type FinancialCategoryData,
  type FinancialItemData,
  type FinancialKind,
  type FinStatus,
  type FinStored,
} from '../../src/domain/workPlanFinancial.ts'
import { isVersionId, type VersionDenial } from '../../src/domain/workPlanVersions.ts'
import { decideWorkPlanOperation } from '../../src/domain/workPlans.ts'
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
  | { op: 'create'; kind: FinancialKind; oscId: string; partnershipId: string; workPlanId: string; requestId: string; data: unknown }
  | { op: 'update'; kind: FinancialKind; oscId: string; partnershipId: string; workPlanId: string; requestId: string; id: string; expectedRevision: number; data: unknown }

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
    if (body.action === 'create-category') return { op: 'create', kind: 'financial-category', ...base }
    if (body.action === 'create-item') return { op: 'create', kind: 'financial-item', ...base }
    return null
  }
  if (method === 'PATCH' && sameKeys(body, ['oscId', 'partnershipId', 'workPlanId', 'requestId', 'kind', 'id', 'expectedRevision', 'data'])) {
    if ((body.kind !== 'financial-category' && body.kind !== 'financial-item') || !isFinancialId(body.id) || !isRevision(body.expectedRevision)) return null
    if ((body.kind === 'financial-category') !== body.id.startsWith('c_')) return null
    return { op: 'update', kind: body.kind, ...base, id: body.id, expectedRevision: body.expectedRevision }
  }
  return null
}

export const financialIdFor = (kind: FinancialKind, uid: string, requestId: string) =>
  `${kind === 'financial-category' ? 'c' : 'f'}_${createHash('sha256').update(`${kind}:${uid}:${requestId}`).digest('hex').slice(0, 20)}`

class Outcome extends Error {
  readonly response: ApiResponse
  constructor(response: ApiResponse) {
    super('outcome')
    this.response = response
  }
}
const CONFLICTS: readonly VersionDenial[] = ['already-finalized', 'financial-transcription-pending', 'financial-not-applicable']
const deny = (reason: VersionDenial) => new Outcome(json(CONFLICTS.includes(reason) ? 409 : 403, { error: 'forbidden', reason }))
const invalid = (fields: Record<string, unknown>) => new Outcome(json(422, { error: 'invalid-financial', fields }))

const revisionOf = (d: DocumentSnapshot) => {
  const r: unknown = d.get('revision')
  return isRevision(r) ? r : 1
}

async function run(deps: ServerDeps, uid: string, request: Parsed): Promise<ApiResponse> {
  const { oscId, partnershipId, workPlanId, requestId, kind } = request
  const oscRef = deps.db.doc(`oscs/${oscId}`)
  const actorRef = deps.db.doc(`oscs/${oscId}/members/${uid}`)
  const partnershipRef = deps.db.doc(`oscs/${oscId}/partnerships/${partnershipId}`)
  const planRef = partnershipRef.collection('workPlans').doc(workPlanId)
  const events = deps.db.collection(`oscs/${oscId}/workPlanEvents`)
  const collection = kind === 'financial-category' ? 'financialCategories' : 'financialItems'
  const id = request.op === 'create' ? financialIdFor(kind, uid, requestId) : request.id
  const ref = planRef.collection(collection).doc(id)

  try {
    return await deps.db.runTransaction(async (tx: Transaction) => {
      const [oscSnap, actorSnap, partnershipSnap, planSnap] = await tx.getAll(oscRef, actorRef, partnershipRef, planRef)
      const context: AuthorizationContext = { uid, oscId, organization: organizationFacts(oscSnap, oscId), membership: membershipFacts(actorSnap, oscId, uid) }
      // 1. Permissão antes de revelar parceria ou versão.
      const permission = decideWorkPlanOperation(context, 'update', 'em-execucao', 'in-registration')
      if (!permission.allowed) throw deny(permission.reason)
      const partnership = partnershipFacts(partnershipSnap, oscId)
      if (!partnership) throw new Outcome(json(404, { error: 'not-found' }))
      if (!planSnap?.exists || planSnap.get('partnershipId') !== partnershipId || planSnap.get('oscId') !== oscId) throw new Outcome(json(404, { error: 'not-found' }))
      const [catSnap, itemSnap] = await Promise.all([
        tx.get(planRef.collection('financialCategories').limit(FIN_LIMITS.categoriesPerVersion + 1)),
        tx.get(planRef.collection('financialItems').limit(FIN_LIMITS.itemsPerVersion + 1)),
      ])
      const target = (kind === 'financial-category' ? catSnap : itemSnap).docs.find((d) => d.id === id)

      // 2. Reenvio do MESMO pedido pelo MESMO usuário: estado confirmado, sem nova gravação.
      if (target && request.op === 'create' && target.get('creationRequestId') === requestId && target.get('createdBy') === uid) return json(200, { ok: true, created: false, record: { id, kind, revision: revisionOf(target) } })
      if (target && request.op === 'update' && target.get('lastUpdateRequestId') === requestId && target.get('updatedBy') === uid) return json(200, { ok: true, changed: false, record: { id, kind, revision: revisionOf(target) } })

      // 3. Aplicabilidade e ciclo de vida.
      if (financialApplicability(partnership.instrument) === 'not-applicable') throw deny('financial-not-applicable')
      const registration = planSnap.get('registrationStatus') === 'finalized' ? 'finalized' : 'in-registration'
      const decision = decideWorkPlanOperation(context, 'update', partnership.administrativeStatus, registration)
      if (!decision.allowed) {
        // Plano finalizado SEM planejamento financeiro: inclusão não autorizada (sem regra aprovada).
        if (decision.reason === 'already-finalized' && catSnap.empty && itemSnap.empty) throw deny('financial-transcription-pending')
        throw deny(decision.reason)
      }

      // 4. Estado atual (relido e revalidado; inválido → nada é presumido).
      const statusMap = new Map<string, FinStatus>()
      const categories: FinStored<FinancialCategoryData>[] = catSnap.docs.map((d) => {
        const v = validateFinancialCategory(d.get('data'))
        if (!v.ok) throw new Outcome(json(409, { error: 'invalid-state' }))
        statusMap.set(d.id, v.data.status)
        return { id: d.id, kind: 'financial-category', data: v.data, revision: revisionOf(d) }
      })
      const items: FinStored<FinancialItemData>[] = itemSnap.docs.map((d) => {
        const v = validateFinancialItem(d.get('data'), new Map([...statusMap].map(([k]) => [k, 'active' as FinStatus])))
        if (!v.ok) throw new Outcome(json(409, { error: 'invalid-state' }))
        return { id: d.id, kind: 'financial-item', data: v.data, revision: revisionOf(d) }
      })
      const list = kind === 'financial-category' ? categories : items
      if (request.op === 'create') {
        if (target) throw new Outcome(json(409, { error: 'conflict' }))
        if (list.length >= (kind === 'financial-category' ? FIN_LIMITS.categoriesPerVersion : FIN_LIMITS.itemsPerVersion)) throw invalid({ [kind === 'financial-category' ? 'category' : 'item']: 'too-many' })
      } else {
        const current = list.find((c) => c.id === id)
        if (!current) throw new Outcome(json(404, { error: 'not-found' }))
        if (current.revision !== request.expectedRevision) throw new Outcome(json(409, { error: 'stale', revision: current.revision }))
      }

      // 5. Validação do registro completo, código único e integridade categoria–item.
      const validation = kind === 'financial-category' ? validateFinancialCategory(request.data) : validateFinancialItem(request.data, statusMap)
      if (!validation.ok) throw invalid(validation.errors)
      const data = validation.data as FinancialCategoryData | FinancialItemData
      if (isDuplicateFinancialCode(data.code, list.map((c) => ({ id: c.id, code: c.data.code })), id)) throw invalid({ code: 'duplicate-code' })
      const nextCategories = kind === 'financial-category' ? [...categories.filter((c) => c.id !== id), { id, kind, data: data as FinancialCategoryData, revision: 1 }] : categories
      const nextItems = kind === 'financial-item' ? [...items.filter((i) => i.id !== id), { id, kind, data: data as FinancialItemData, revision: 1 }] : items
      const integrity = financialIntegrity(nextCategories, nextItems)
      if (!integrity.ok) throw invalid(kind === 'financial-category' ? { status: 'category-has-items' } : { categoryId: 'discontinued-category' })

      const before = request.op === 'update' ? (list.find((c) => c.id === id)?.data as unknown as Record<string, unknown>) : null
      const fields = Object.keys(data).filter((k) => before === null || JSON.stringify(before[k]) !== JSON.stringify((data as unknown as Record<string, unknown>)[k]))
      if (request.op === 'update' && fields.length === 0) return json(200, { ok: true, changed: false, record: { id, kind, revision: request.expectedRevision } })
      const revision = request.op === 'create' ? 1 : request.expectedRevision + 1
      const now = FieldValue.serverTimestamp()
      const meta = { updatedAt: now, updatedBy: uid, lastUpdateRequestId: requestId }
      if (request.op === 'create') tx.create(ref, { id, kind, oscId, partnershipId, workPlanId, data, revision, creationRequestId: requestId, createdAt: now, createdBy: uid, inheritedFrom: null, ...meta })
      else tx.update(ref, { data, revision, ...meta })
      const item = kind === 'financial-item' ? (data as FinancialItemData) : null
      const prevItem = kind === 'financial-item' && before ? (before as unknown as FinancialItemData) : null
      tx.create(events.doc(), {
        action: `${kind}-${request.op === 'create' ? 'created' : 'updated'}`,
        oscId,
        partnershipId,
        workPlanId,
        sequence: planSnap.get('origin.sequence') ?? 1,
        kind,
        recordId: id,
        code: data.code,
        fields,
        // Rastreabilidade das mudanças relevantes (valor previsto, categoria e situação).
        plannedValueChange: item && fields.includes('plannedValue') ? { before: prevItem?.plannedValue ?? null, after: item.plannedValue } : null,
        categoryChange: item && fields.includes('categoryId') ? { before: prevItem?.categoryId ?? null, after: item.categoryId } : null,
        statusChanged: fields.includes('status') ? data.status : null,
        actorUid: uid,
        actorAuthority: decision.authority,
        requestId,
        fromRevision: request.op === 'create' ? 0 : request.expectedRevision,
        toRevision: revision,
        at: now,
      })
      return json(request.op === 'create' ? 201 : 200, { ok: true, [request.op === 'create' ? 'created' : 'changed']: true, record: { id, kind, revision } })
    })
  } catch (error) {
    if (error instanceof Outcome) return error.response
    throw error
  }
}

/** Ponto de entrada independente de plataforma. */
export async function handleWorkPlanFinancialRequest(request: ApiRequest, deps: ServerDeps | null): Promise<ApiResponse> {
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
    console.error(`[osc-work-plan-financial] falha interna (${code})`)
    return json(500, { error: 'internal' })
  }
}
