/**
 * Plano de Trabalho SIMULADO (DEV-02.2) para testes de interface — em memória, sem rede.
 * Não decide autorização (testada no servidor com emuladores); aplica as gravações como o
 * servidor confirmaria, para exercitar a interface.
 */
import { checkFinalization, emptyValues, validateCorrection, type FieldValue, type WorkPlanField, type WorkPlanValues } from '../../src/domain/workPlans.ts'
import type { RawDocument } from '../../src/services/organizations/parsing.ts'
import type { WorkPlansSdk } from '../../src/services/workPlans/workPlanService.ts'
import type { CorrectionEntry, HistoryResult, WorkPlansApi, WorkPlansResult } from '../../src/services/workPlans/workPlansApi.ts'
import { workPlanDocument, workPlanPath } from './workPlanFixtures.ts'

export interface FakeWorkPlansDb {
  readonly kind: 'fake-work-plans'
}

type Call = { kind: 'start' | 'update' | 'finalize' | 'correct' | 'history'; request: Record<string, unknown> }

export function createFakeWorkPlans(initial: Parameters<typeof workPlanDocument>[0][] = []) {
  const db: FakeWorkPlansDb = { kind: 'fake-work-plans' }
  const docs = new Map<string, Record<string, unknown>>()
  for (const p of initial) docs.set(workPlanPath(p.oscId, p.partnershipId), workPlanDocument(p))
  const reads: string[] = []
  const calls: Call[] = []
  const failures = new Map<'get', unknown>()

  const sdk: WorkPlansSdk<FakeWorkPlansDb> = {
    async getWorkPlan(_db, oscId, partnershipId) {
      reads.push(`${oscId}/${partnershipId}`)
      if (failures.has('get')) throw failures.get('get')
      const path = workPlanPath(oscId, partnershipId)
      const data = docs.get(path)
      return data ? ({ path, data: structuredClone(data) } satisfies RawDocument) : null
    },
  }

  const history = new Map<string, CorrectionEntry[]>()
  const FACTS = { instrument: 'termo-colaboracao', termStart: '2000-01-01', termEnd: '2999-12-31', formalizationDate: '2999-12-31', administrativeStatus: 'em-execucao', workPlanApprovalDeclared: true } as const
  let override: ((call: Call) => WorkPlansResult | HistoryResult | Promise<WorkPlansResult | HistoryResult> | undefined) | null = null
  const ok = (revision: number, changed = true): WorkPlansResult => ({ ok: true, revision, changed, warnings: [] })
  const api: WorkPlansApi = {
    async start(request) {
      const call: Call = { kind: 'start', request }
      calls.push(call)
      const custom = (await override?.(call)) as WorkPlansResult | undefined
      if (custom) return custom
      const path = workPlanPath(request.oscId, request.partnershipId)
      if (!docs.has(path)) docs.set(path, workPlanDocument({ oscId: request.oscId, partnershipId: request.partnershipId }))
      return ok(1)
    },
    async update(request) {
      const call: Call = { kind: 'update', request }
      calls.push(call)
      const custom = (await override?.(call)) as WorkPlansResult | undefined
      if (custom) return custom
      const path = workPlanPath(request.oscId, request.partnershipId)
      const doc = docs.get(path)
      if (!doc) return { ok: false, error: 'not-structured' }
      if (doc.revision !== request.expectedRevision) return { ok: false, error: 'stale' }
      const values = { ...(doc.values as Record<WorkPlanField, FieldValue>), ...request.changes }
      docs.set(path, { ...doc, values, revision: (doc.revision as number) + 1, updatedAt: new Date() })
      return ok((doc.revision as number) + 1)
    },
    async finalize(request) {
      const call: Call = { kind: 'finalize', request }
      calls.push(call)
      const custom = (await override?.(call)) as WorkPlansResult | undefined
      if (custom) return custom
      const path = workPlanPath(request.oscId, request.partnershipId)
      const doc = docs.get(path)
      if (!doc) return { ok: false, error: 'not-structured' }
      const values = { ...emptyValues(), ...(doc.values as object) }
      const check = checkFinalization(values, { instrument: 'termo-colaboracao', termStart: '2000-01-01', termEnd: '2999-12-31', formalizationDate: '2999-12-31', administrativeStatus: 'em-execucao', workPlanApprovalDeclared: true })
      if (check.pending.length) return { ok: false, error: 'finalization-pending', pending: check.pending }
      docs.set(path, { ...doc, registrationStatus: 'finalized', revision: (doc.revision as number) + 1, finalizedAt: new Date(), finalizedBy: 'simulado' })
      return ok((doc.revision as number) + 1)
    },
    async correct(request) {
      const call: Call = { kind: 'correct', request }
      calls.push(call)
      const custom = (await override?.(call)) as WorkPlansResult | undefined
      if (custom) return custom
      const path = workPlanPath(request.oscId, request.partnershipId)
      const doc = docs.get(path)
      if (!doc) return { ok: false, error: 'not-structured' }
      if (doc.revision !== request.expectedRevision) return { ok: false, error: 'stale' }
      const current = { ...emptyValues(), ...(doc.values as object) } as WorkPlanValues
      const validation = validateCorrection(request, current, FACTS, '2026-11-17')
      if (!validation.ok) return { ok: false, error: 'invalid-correction', fields: validation.errors }
      const revision = (doc.revision as number) + 1
      docs.set(path, { ...doc, values: { ...current, ...Object.fromEntries(validation.items.map((i) => [i.field, i.after])) }, revision })
      const list = history.get(path) ?? []
      list.push({ at: new Date('2026-11-17T15:00:00Z').toISOString(), actor: 'you', actorAuthority: 'member', corrections: validation.items, justification: validation.justification, fromRevision: revision - 1, toRevision: revision })
      history.set(path, list)
      return ok(revision)
    },
    async history(request) {
      const call: Call = { kind: 'history', request }
      calls.push(call)
      const custom = (await override?.(call)) as HistoryResult | undefined
      if (custom) return custom
      return { ok: true, entries: history.get(workPlanPath(request.oscId, request.partnershipId)) ?? [] }
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
