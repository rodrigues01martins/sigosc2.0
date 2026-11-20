/**
 * Plano de Trabalho SIMULADO (DEV-02.2/02.3) para testes de interface — em memória, sem rede.
 * Não decide autorização (testada no servidor com emuladores); aplica as gravações como o
 * servidor confirmaria (com as validações de domínio), para exercitar a interface.
 */
import { checkActivationChain, checkVersionFinalization, decideVersionCreation, parseStoredActivation, validateFormalAct, versionIdFor, type VersionSummary } from '../../src/domain/workPlanVersions.ts'
import { checkComponentReview, componentsToken, isDuplicateCode, linkIntegrity, validateGoal, validateIndicator, type GoalData, type IndicatorData, type Stored } from '../../src/domain/workPlanComponents.ts'
import { financialIntegrity, isDuplicateFinancialCode, validateFinancialCategory, validateFinancialItem, type FinancialCategoryData, type FinancialItemData, type FinStatus } from '../../src/domain/workPlanFinancial.ts'
import { emptyValues, validateCorrection, type FieldValue, type WorkPlanField, type WorkPlanValues } from '../../src/domain/workPlans.ts'
import type { RawDocument } from '../../src/services/organizations/parsing.ts'
import type { WorkPlansSdk } from '../../src/services/workPlans/workPlanService.ts'
import type { ComponentResult, CorrectionEntry, HistoryResult, WorkPlansApi, WorkPlansResult } from '../../src/services/workPlans/workPlansApi.ts'
import { componentDocument, workPlanDocument, workPlanPath, type WorkPlanFixture } from './workPlanFixtures.ts'

export interface FakeWorkPlansDb {
  readonly kind: 'fake-work-plans'
}

type Kind = 'start' | 'update' | 'finalize' | 'correct' | 'history' | 'create-version' | 'update-act' | 'create-component' | 'update-component' | 'open-transcription' | 'close-transcription' | 'create-financial' | 'update-financial'
type Call = { kind: Kind; request: Record<string, unknown> }

const TODAY = '2026-11-17'
const FACTS = { instrument: 'termo-colaboracao', termStart: '2000-01-01', termEnd: '2999-12-31', formalizationDate: '2999-12-31', administrativeStatus: 'em-execucao', workPlanApprovalDeclared: true } as const
/** Contexto sempre autorizado: o simulador NÃO testa autorização. */
const ALLOWED = {
  uid: 'simulado',
  oscId: 'osc',
  organization: { id: 'osc', registrationStatus: 'active', commercialStatus: 'active', administratorUid: null },
  membership: { uid: 'simulado', status: 'active' as const, permissions: ['work-plan.edit' as const], canManagePermissions: false },
}

export function createFakeWorkPlans(initial: WorkPlanFixture[] = []) {
  const db: FakeWorkPlansDb = { kind: 'fake-work-plans' }
  const docs = new Map<string, Record<string, unknown>>()
  for (const p of initial) {
    const workPlanId = (p.sequence ?? 1) === 1 ? 'original' : `v${p.sequence}`
    const path = workPlanPath(p.oscId, p.partnershipId, workPlanId)
    docs.set(path, workPlanDocument(p))
    for (const g of p.goals ?? []) docs.set(`${path}/goals/${g.id}`, componentDocument('goal', g, { ...p, workPlanId }))
    for (const i of p.indicators ?? []) docs.set(`${path}/indicators/${i.id}`, componentDocument('indicator', i, { ...p, workPlanId }))
    for (const c of p.financialCategories ?? []) docs.set(`${path}/financialCategories/${c.id}`, componentDocument('financial-category', c, { ...p, workPlanId }))
    for (const i of p.financialItems ?? []) docs.set(`${path}/financialItems/${i.id}`, componentDocument('financial-item', i, { ...p, workPlanId }))
  }
  let componentCounter = 0
  const componentsOf = (planPath: string, collection: 'goals' | 'indicators' | 'financialCategories' | 'financialItems') =>
    [...docs.entries()].filter(([p]) => p.startsWith(`${planPath}/${collection}/`)).map(([p, d]) => ({ path: p, id: p.slice(planPath.length + collection.length + 2), doc: d }))
  const reads: string[] = []
  const calls: Call[] = []
  const failures = new Map<'get' | 'components', unknown>()
  const history = new Map<string, CorrectionEntry[]>()

  const prefix = (oscId: string, partnershipId: string) => `oscs/${oscId}/partnerships/${partnershipId}/workPlans/`
  const versionsOf = (oscId: string, partnershipId: string) =>
    [...docs.entries()].filter(([p]) => p.startsWith(prefix(oscId, partnershipId)) && !p.slice(prefix(oscId, partnershipId).length).includes('/'))

  const summariesOf = (oscId: string, partnershipId: string): VersionSummary[] =>
    versionsOf(oscId, partnershipId).map(([, d]) => ({
      id: d.id as string,
      sequence: (d.origin as { sequence: number }).sequence,
      registrationStatus: d.registrationStatus as 'in-registration' | 'finalized',
      activationStatus: parseStoredActivation((d.activation as { status?: string } | undefined)?.status),
      previousWorkPlanId: ((d.origin as { previousWorkPlanId?: string }).previousWorkPlanId ?? null),
    }))

  const sdk: WorkPlansSdk<FakeWorkPlansDb> = {
    async getWorkPlan(_db, oscId, partnershipId) {
      reads.push(`${oscId}/${partnershipId}`)
      if (failures.has('get')) throw failures.get('get')
      const path = workPlanPath(oscId, partnershipId)
      const data = docs.get(path)
      return data ? ({ path, data: structuredClone(data) } satisfies RawDocument) : null
    },
    async listWorkPlans(_db, oscId, partnershipId) {
      reads.push(`${oscId}/${partnershipId}`)
      if (failures.has('get')) throw failures.get('get')
      return versionsOf(oscId, partnershipId).map(([path, data]) => ({ path, data: structuredClone(data) }))
    },
    async listComponents(_db, oscId, partnershipId, workPlanId) {
      reads.push(`${oscId}/${partnershipId}/${workPlanId}/components`)
      if (failures.has('components')) throw failures.get('components')
      const planPath = workPlanPath(oscId, partnershipId, workPlanId)
      const raw = (c: 'goals' | 'indicators') => componentsOf(planPath, c).map(({ path, doc }) => ({ path, data: structuredClone(doc) }))
      return { goals: raw('goals'), indicators: raw('indicators') }
    },
    async listFinancial(_db, oscId, partnershipId, workPlanId) {
      reads.push(`${oscId}/${partnershipId}/${workPlanId}/financial`)
      if (failures.has('components')) throw failures.get('components')
      const planPath = workPlanPath(oscId, partnershipId, workPlanId)
      const raw = (c: 'financialCategories' | 'financialItems') => componentsOf(planPath, c).map(({ path, doc }) => ({ path, data: structuredClone(doc) }))
      return { categories: raw('financialCategories'), items: raw('financialItems') }
    },
  }

  let override: ((call: Call) => WorkPlansResult | HistoryResult | Promise<WorkPlansResult | HistoryResult> | undefined) | null = null
  const ok = (id: string, revision: number, changed = true): WorkPlansResult => ({ ok: true, id, revision, changed, warnings: [] })
  async function intercept(kind: Kind, request: object) {
    const call: Call = { kind, request: request as Record<string, unknown> }
    calls.push(call)
    return (await override?.(call)) as WorkPlansResult | undefined
  }
  const valuesOf = (doc: Record<string, unknown>) => ({ ...emptyValues(), ...(doc.values as object) }) as WorkPlanValues

  const storedOf = (planPath: string) => {
    const goals = componentsOf(planPath, 'goals').map((c) => ({ id: c.id, kind: 'goal' as const, data: c.doc.data as GoalData, revision: (c.doc.revision as number) ?? 1 }))
    const indicators = componentsOf(planPath, 'indicators').map((c) => ({ id: c.id, kind: 'indicator' as const, data: c.doc.data as IndicatorData, revision: (c.doc.revision as number) ?? 1 }))
    return { goals, indicators }
  }

  let financialCounter = 0
  /** Categoria/item financeiro como o servidor confirmaria (validação do domínio; sem autorização). */
  async function financial(kind: 'create-financial' | 'update-financial', request: Parameters<WorkPlansApi['createFinancial']>[0] & { id?: string; expectedRevision?: number }, id: string | null): Promise<ComponentResult> {
    const call: Call = { kind, request: request as unknown as Record<string, unknown> }
    calls.push(call)
    const custom = (await override?.(call)) as ComponentResult | undefined
    if (custom) return custom
    const planPath = workPlanPath(request.oscId, request.partnershipId, request.workPlanId)
    const plan = docs.get(planPath)
    if (!plan) return { ok: false, error: 'not-found' }
    const cats = componentsOf(planPath, 'financialCategories')
    const items = componentsOf(planPath, 'financialItems')
    if (plan.registrationStatus === 'finalized') return { ok: false, error: 'forbidden', reason: cats.length + items.length === 0 ? 'financial-transcription-pending' : 'already-finalized' }
    const statusMap = new Map(cats.map((c) => [c.id, (c.doc.data as { status: FinStatus }).status]))
    const v = request.kind === 'financial-category' ? validateFinancialCategory(request.data) : validateFinancialItem(request.data, statusMap)
    if (!v.ok) return { ok: false, error: 'invalid-financial', fields: v.errors }
    const collection = request.kind === 'financial-category' ? 'financialCategories' : 'financialItems'
    const recordId = id ?? `${request.kind === 'financial-category' ? 'c' : 'f'}_${String(++financialCounter).padStart(20, '0')}`
    const path = `${planPath}/${collection}/${recordId}`
    const existing = docs.get(path)
    if (id && !existing) return { ok: false, error: 'not-found' }
    if (existing && existing.revision !== request.expectedRevision) return { ok: false, error: 'stale' }
    const peers = (request.kind === 'financial-category' ? cats : items).map((c) => ({ id: c.id, code: (c.doc.data as { code: string }).code }))
    if (isDuplicateFinancialCode(v.data.code, peers, recordId)) return { ok: false, error: 'invalid-financial', fields: { code: 'duplicate-code' } }
    const asStored = <T,>(list: { id: string; doc: Record<string, unknown> }[], k: 'financial-category' | 'financial-item') => list.map((c) => ({ id: c.id, kind: k, data: c.doc.data as T, revision: 1 }))
    const nextCats = request.kind === 'financial-category' ? [...asStored<FinancialCategoryData>(cats, 'financial-category').filter((c) => c.id !== recordId), { id: recordId, kind: 'financial-category' as const, data: v.data as FinancialCategoryData, revision: 1 }] : asStored<FinancialCategoryData>(cats, 'financial-category')
    const nextItems = request.kind === 'financial-item' ? [...asStored<FinancialItemData>(items, 'financial-item').filter((c) => c.id !== recordId), { id: recordId, kind: 'financial-item' as const, data: v.data as FinancialItemData, revision: 1 }] : asStored<FinancialItemData>(items, 'financial-item')
    if (!financialIntegrity(nextCats, nextItems).ok) return { ok: false, error: 'invalid-financial', fields: request.kind === 'financial-category' ? { status: 'category-has-items' } : { categoryId: 'discontinued-category' } }
    const revision = existing ? (existing.revision as number) + 1 : 1
    docs.set(path, { ...(existing ?? {}), id: recordId, kind: request.kind, oscId: request.oscId, partnershipId: request.partnershipId, workPlanId: request.workPlanId, data: v.data, revision, inheritedFrom: existing?.inheritedFrom ?? null })
    return { ok: true, id: recordId, revision, changed: true }
  }

  /** Meta/indicador como o servidor confirmaria (validação do domínio; sem autorização). */
  async function component(kind: 'create-component' | 'update-component', request: Parameters<WorkPlansApi['createComponent']>[0] & { componentId?: string; expectedRevision?: number }, componentId: string | null): Promise<ComponentResult> {
    const call: Call = { kind, request: request as unknown as Record<string, unknown> }
    calls.push(call)
    const custom = (await override?.(call)) as ComponentResult | undefined
    if (custom) return custom
    const planPath = workPlanPath(request.oscId, request.partnershipId, request.workPlanId)
    const plan = docs.get(planPath)
    if (!plan) return { ok: false, error: 'not-found' }
    const goalsNow = componentsOf(planPath, 'goals')
    const indicatorsNow = componentsOf(planPath, 'indicators')
    const transcription = (plan.complementaryTranscription as { status?: string } | undefined)?.status
    if (plan.registrationStatus === 'finalized' && transcription !== 'open')
      return { ok: false, error: 'forbidden', reason: transcription === 'closed' ? 'transcription-closed' : goalsNow.length + indicatorsNow.length === 0 ? 'complementary-transcription-pending' : 'already-finalized' }
    const known = new Set(goalsNow.map((g) => g.id))
    const v = request.kind === 'goal' ? validateGoal(request.data) : validateIndicator(request.data, known)
    if (!v.ok) return { ok: false, error: 'invalid-component', fields: v.errors }
    const collection = request.kind === 'goal' ? 'goals' : 'indicators'
    const id = componentId ?? `${request.kind === 'goal' ? 'g' : 'i'}_${String(++componentCounter).padStart(20, '0')}`
    const path = `${planPath}/${collection}/${id}`
    const existing = docs.get(path)
    if (componentId && !existing) return { ok: false, error: 'not-found' }
    if (existing && existing.revision !== request.expectedRevision) return { ok: false, error: 'stale' }
    const peers = (request.kind === 'goal' ? goalsNow : indicatorsNow).map((c) => ({ id: c.id, code: (c.doc.data as { code: string }).code }))
    if (isDuplicateCode(v.data.code, peers, id)) return { ok: false, error: 'invalid-component', fields: { code: 'duplicate-code' } }
    const asStored = <T,>(list: { id: string; doc: Record<string, unknown> }[], k: 'goal' | 'indicator') => list.map((c) => ({ id: c.id, kind: k, data: c.doc.data as T, revision: 1 }) as Stored<T>)
    const goals = asStored<GoalData>(goalsNow, 'goal').filter((g) => g.id !== id)
    const indicators = asStored<IndicatorData>(indicatorsNow, 'indicator').filter((i) => i.id !== id)
    const integrity = request.kind === 'goal' ? linkIntegrity([...goals, { id, kind: 'goal', data: v.data as GoalData, revision: 1 }], asStored<IndicatorData>(indicatorsNow, 'indicator')) : linkIntegrity(goals.concat(asStored<GoalData>(goalsNow, 'goal').filter((g) => g.id === id)), [...indicators, { id, kind: 'indicator', data: v.data as IndicatorData, revision: 1 }])
    if (!integrity.ok) return { ok: false, error: 'invalid-component', fields: request.kind === 'goal' ? { status: 'linked-indicators' } : { goalIds: 'discontinued-goal' } }
    const revision = existing ? (existing.revision as number) + 1 : 1
    docs.set(path, { ...(existing ?? {}), id, kind: request.kind, oscId: request.oscId, partnershipId: request.partnershipId, workPlanId: request.workPlanId, data: v.data, revision, inheritedFrom: existing?.inheritedFrom ?? null })
    return { ok: true, id, revision, changed: true }
  }

  const api: WorkPlansApi = {
    async start(request) {
      const custom = await intercept('start', request)
      if (custom) return custom
      const path = workPlanPath(request.oscId, request.partnershipId)
      if (!docs.has(path)) docs.set(path, workPlanDocument({ oscId: request.oscId, partnershipId: request.partnershipId }))
      return ok('original', 1)
    },
    async update(request) {
      const custom = await intercept('update', request)
      if (custom) return custom
      const path = workPlanPath(request.oscId, request.partnershipId, request.workPlanId)
      const doc = docs.get(path)
      if (!doc) return { ok: false, error: 'not-structured' }
      if (doc.registrationStatus === 'finalized') return { ok: false, error: 'forbidden', reason: 'already-finalized' }
      if (doc.revision !== request.expectedRevision) return { ok: false, error: 'stale' }
      const values = { ...(doc.values as Record<WorkPlanField, FieldValue>), ...request.changes }
      docs.set(path, { ...doc, values, revision: (doc.revision as number) + 1, updatedAt: new Date() })
      return ok(request.workPlanId, (doc.revision as number) + 1)
    },
    async updateFormalAct(request) {
      const custom = await intercept('update-act', request)
      if (custom) return custom
      const path = workPlanPath(request.oscId, request.partnershipId, request.workPlanId)
      const doc = docs.get(path)
      if (!doc) return { ok: false, error: 'not-structured' }
      if (doc.revision !== request.expectedRevision) return { ok: false, error: 'stale' }
      const act = validateFormalAct(request.formalAct, TODAY)
      if (!act.ok) return { ok: false, error: 'invalid-formal-act', fields: act.errors }
      docs.set(path, { ...doc, formalAct: { ...(doc.formalAct as object), ...act.act }, revision: (doc.revision as number) + 1 })
      return ok(request.workPlanId, (doc.revision as number) + 1)
    },
    async finalize(request) {
      const custom = await intercept('finalize', request)
      if (custom) return custom
      const path = workPlanPath(request.oscId, request.partnershipId, request.workPlanId)
      const doc = docs.get(path)
      if (!doc) return { ok: false, error: 'not-structured' }
      const stored = storedOf(path)
      if (componentsToken([...stored.goals, ...stored.indicators]) !== request.componentsToken) return { ok: false, error: 'forbidden', reason: 'components-changed' }
      const check = checkVersionFinalization(valuesOf(doc), FACTS, null, TODAY)
      const pending = [...check.pending, ...checkComponentReview(request.review, stored.goals, stored.indicators)]
      if (pending.length) return { ok: false, error: 'finalization-pending', pending }
      if (!request.declaration) return { ok: false, error: 'finalization-pending', pending: ['Confirme a declaração de correspondência ao Plano aprovado.'] }
      const sequence = (doc.origin as { sequence: number }).sequence
      const revision = (doc.revision as number) + 1
      if (sequence === 1) {
        docs.set(path, { ...doc, registrationStatus: 'finalized', revision, finalizedAt: new Date(), finalizedBy: 'simulado', componentReview: { ...request.review, reviewedAt: new Date(), reviewedBy: 'simulado' } })
        return ok(request.workPlanId, revision)
      }
      // DEC-PT-003 (como o servidor): finalização + ativação; a vigente anterior passa a substituída.
      const chain = checkActivationChain(summariesOf(request.oscId, request.partnershipId), request.workPlanId)
      if (!chain.ok) return { ok: false, error: 'forbidden', reason: chain.reason }
      const now = new Date()
      docs.set(path, { ...doc, registrationStatus: 'finalized', revision, finalizedAt: now, finalizedBy: 'simulado', componentReview: { ...request.review, reviewedAt: now, reviewedBy: 'simulado' }, activation: { status: 'active', activatedAt: now, supersededWorkPlanId: chain.supersededId } })
      const prevPath = workPlanPath(request.oscId, request.partnershipId, chain.supersededId)
      const prev = docs.get(prevPath) as Record<string, unknown>
      docs.set(prevPath, { ...prev, activation: { ...(prev.activation as object | undefined), status: 'superseded', supersededAt: now, supersededByWorkPlanId: request.workPlanId } })
      const act = doc.formalAct as { effectiveDate?: string | null }
      return { ...ok(request.workPlanId, revision), activation: { supersededWorkPlanId: chain.supersededId, sequence, effectiveDate: act.effectiveDate ?? null } }
    },
    async createVersion(request) {
      const custom = await intercept('create-version', request)
      if (custom) return custom
      const summaries = summariesOf(request.oscId, request.partnershipId)
      const decision = decideVersionCreation(ALLOWED, 'em-execucao', summaries, request.baseWorkPlanId)
      if (!decision.allowed) return { ok: false, error: 'forbidden', reason: decision.reason }
      const base = docs.get(workPlanPath(request.oscId, request.partnershipId, request.baseWorkPlanId)) as Record<string, unknown>
      if (base.revision !== request.baseRevision) return { ok: false, error: 'stale' }
      const act = validateFormalAct(request.formalAct, TODAY)
      if (!act.ok) return { ok: false, error: 'invalid-formal-act', fields: act.errors }
      const sequence = Math.max(...summaries.map((s) => s.sequence)) + 1
      const id = versionIdFor(sequence)
      const target = workPlanPath(request.oscId, request.partnershipId, id)
      docs.set(target, {
        ...workPlanDocument({ oscId: request.oscId, partnershipId: request.partnershipId, sequence, formalAct: { ...act.act, declaredBy: 'simulado' }, values: valuesOf(base), createdBy: 'simulado' }),
        createdAt: new Date(),
      })
      // Cópia integral dos componentes (mesmos IDs lógicos), como o servidor.
      const basePath = workPlanPath(request.oscId, request.partnershipId, request.baseWorkPlanId)
      for (const c of ['goals', 'indicators', 'financialCategories', 'financialItems'] as const)
        for (const { id: cid, doc } of componentsOf(basePath, c)) docs.set(`${target}/${c}/${cid}`, { ...structuredClone(doc), workPlanId: id, revision: 1, inheritedFrom: { workPlanId: request.baseWorkPlanId, revision: doc.revision } })
      return ok(id, 1)
    },
    async correct(request) {
      const custom = await intercept('correct', request)
      if (custom) return custom
      const path = workPlanPath(request.oscId, request.partnershipId, request.workPlanId)
      const doc = docs.get(path)
      if (!doc) return { ok: false, error: 'not-structured' }
      if (doc.revision !== request.expectedRevision) return { ok: false, error: 'stale' }
      const current = valuesOf(doc)
      const validation = validateCorrection(request, current, FACTS, TODAY)
      if (!validation.ok) return { ok: false, error: 'invalid-correction', fields: validation.errors }
      const revision = (doc.revision as number) + 1
      docs.set(path, { ...doc, values: { ...current, ...Object.fromEntries(validation.items.map((i) => [i.field, i.after])) }, revision })
      const key = prefix(request.oscId, request.partnershipId)
      const list = history.get(key) ?? []
      list.push({ workPlanId: request.workPlanId, at: new Date('2026-11-17T15:00:00Z').toISOString(), actor: 'you', actorAuthority: 'member', corrections: validation.items, justification: validation.justification, fromRevision: revision - 1, toRevision: revision })
      history.set(key, list)
      return ok(request.workPlanId, revision)
    },
    async openTranscription(request) {
      const custom = await intercept('open-transcription', request)
      if (custom) return custom
      const path = workPlanPath(request.oscId, request.partnershipId, request.workPlanId)
      const doc = docs.get(path)
      if (!doc) return { ok: false, error: 'not-found' }
      const t = doc.complementaryTranscription as { status?: string } | undefined
      if (doc.registrationStatus !== 'finalized') return { ok: false, error: 'forbidden', reason: 'not-finalized' }
      if (t?.status === 'open') return { ok: false, error: 'forbidden', reason: 'transcription-already-open' }
      if (t?.status === 'closed') return { ok: false, error: 'forbidden', reason: 'transcription-closed' }
      if (componentsOf(path, 'goals').length + componentsOf(path, 'indicators').length > 0) return { ok: false, error: 'forbidden', reason: 'components-exist' }
      if (!request.declaration) return { ok: false, error: 'finalization-pending', pending: ['Confirme a declaração de correspondência ao Plano aprovado.'] }
      docs.set(path, { ...doc, complementaryTranscription: { status: 'open', revision: 1, openedAt: new Date(), openedBy: 'simulado' } })
      return ok(request.workPlanId, doc.revision as number)
    },
    async closeTranscription(request) {
      const custom = await intercept('close-transcription', request)
      if (custom) return custom
      const path = workPlanPath(request.oscId, request.partnershipId, request.workPlanId)
      const doc = docs.get(path)
      const t = doc?.complementaryTranscription as { status?: string; revision?: number } | undefined
      if (!doc || t?.status !== 'open') return { ok: false, error: 'forbidden', reason: 'transcription-not-open' }
      if (t.revision !== request.expectedTranscriptionRevision) return { ok: false, error: 'stale' }
      const stored = storedOf(path)
      if (componentsToken([...stored.goals, ...stored.indicators]) !== request.componentsToken) return { ok: false, error: 'forbidden', reason: 'components-changed' }
      const pending = checkComponentReview(request.review, stored.goals, stored.indicators)
      if (pending.length) return { ok: false, error: 'finalization-pending', pending }
      if (!request.declaration) return { ok: false, error: 'finalization-pending', pending: ['Confirme a declaração de correspondência ao Plano aprovado.'] }
      docs.set(path, { ...doc, complementaryTranscription: { ...t, status: 'closed', revision: 2, closedAt: new Date(), closedBy: 'simulado', review: request.review } })
      return ok(request.workPlanId, doc.revision as number)
    },
    async createComponent(request) {
      return component('create-component', request, null)
    },
    async updateComponent(request) {
      return component('update-component', request, request.componentId)
    },
    async createFinancial(request) {
      return financial('create-financial', request, null)
    },
    async updateFinancial(request) {
      return financial('update-financial', request, request.id)
    },
    async history(request) {
      const call: Call = { kind: 'history', request }
      calls.push(call)
      const custom = (await override?.(call)) as HistoryResult | undefined
      if (custom) return custom
      const entries = history.get(prefix(request.oscId, request.partnershipId)) ?? []
      return { ok: true, entries: request.workPlanId ? entries.filter((e) => e.workPlanId === request.workPlanId) : entries }
    },
  }

  return {
    db,
    sdk,
    api,
    docs,
    reads,
    calls,
    failures,
    respondWith(handler: typeof override) {
      override = handler
    },
  }
}
