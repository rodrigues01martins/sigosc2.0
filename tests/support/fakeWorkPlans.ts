/**
 * Plano de Trabalho SIMULADO (DEV-02.2/02.3) para testes de interface — em memória, sem rede.
 * Não decide autorização (testada no servidor com emuladores); aplica as gravações como o
 * servidor confirmaria (com as validações de domínio), para exercitar a interface.
 */
import { checkActivationChain, checkVersionFinalization, decideVersionCreation, parseStoredActivation, validateFormalAct, versionIdFor, type VersionSummary } from '../../src/domain/workPlanVersions.ts'
import { emptyValues, validateCorrection, type FieldValue, type WorkPlanField, type WorkPlanValues } from '../../src/domain/workPlans.ts'
import type { RawDocument } from '../../src/services/organizations/parsing.ts'
import type { WorkPlansSdk } from '../../src/services/workPlans/workPlanService.ts'
import type { CorrectionEntry, HistoryResult, WorkPlansApi, WorkPlansResult } from '../../src/services/workPlans/workPlansApi.ts'
import { workPlanDocument, workPlanPath, type WorkPlanFixture } from './workPlanFixtures.ts'

export interface FakeWorkPlansDb {
  readonly kind: 'fake-work-plans'
}

type Kind = 'start' | 'update' | 'finalize' | 'correct' | 'history' | 'create-version' | 'update-act'
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
  for (const p of initial) docs.set(workPlanPath(p.oscId, p.partnershipId, (p.sequence ?? 1) === 1 ? 'original' : `v${p.sequence}`), workPlanDocument(p))
  const reads: string[] = []
  const calls: Call[] = []
  const failures = new Map<'get', unknown>()
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
  }

  let override: ((call: Call) => WorkPlansResult | HistoryResult | Promise<WorkPlansResult | HistoryResult> | undefined) | null = null
  const ok = (id: string, revision: number, changed = true): WorkPlansResult => ({ ok: true, id, revision, changed, warnings: [] })
  async function intercept(kind: Kind, request: object) {
    const call: Call = { kind, request: request as Record<string, unknown> }
    calls.push(call)
    return (await override?.(call)) as WorkPlansResult | undefined
  }
  const valuesOf = (doc: Record<string, unknown>) => ({ ...emptyValues(), ...(doc.values as object) }) as WorkPlanValues

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
      const check = checkVersionFinalization(valuesOf(doc), FACTS, null, TODAY)
      if (check.pending.length) return { ok: false, error: 'finalization-pending', pending: check.pending }
      const sequence = (doc.origin as { sequence: number }).sequence
      const revision = (doc.revision as number) + 1
      if (sequence === 1) {
        docs.set(path, { ...doc, registrationStatus: 'finalized', revision, finalizedAt: new Date(), finalizedBy: 'simulado' })
        return ok(request.workPlanId, revision)
      }
      // DEC-PT-003 (como o servidor): finalização + ativação; a vigente anterior passa a substituída.
      const chain = checkActivationChain(summariesOf(request.oscId, request.partnershipId), request.workPlanId)
      if (!chain.ok) return { ok: false, error: 'forbidden', reason: chain.reason }
      const now = new Date()
      docs.set(path, { ...doc, registrationStatus: 'finalized', revision, finalizedAt: now, finalizedBy: 'simulado', activation: { status: 'active', activatedAt: now, supersededWorkPlanId: chain.supersededId } })
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
      docs.set(workPlanPath(request.oscId, request.partnershipId, id), {
        ...workPlanDocument({ oscId: request.oscId, partnershipId: request.partnershipId, sequence, formalAct: { ...act.act, declaredBy: 'simulado' }, values: valuesOf(base), createdBy: 'simulado' }),
        createdAt: new Date(),
      })
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
