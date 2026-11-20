/** Consulta do Plano estruturado da parceria (DEV-02.2) — uma LEITURA no servidor, sob as Security Rules. */
import { mapFirestoreError } from '../organizations/errors.ts'
import type { RawDocument } from '../organizations/parsing.ts'
import { PARTNERSHIP_ID_PATTERN } from '../partnerships/types.ts'
import { isVersionId } from '../../domain/workPlanVersions.ts'
import { parseComponents, parseFinancial, parseWorkPlan } from './parsing.ts'
import type { WorkPlan, WorkPlanService } from './types.ts'

export interface WorkPlansSdk<TDb> {
  getWorkPlan(db: TDb, oscId: string, partnershipId: string): Promise<RawDocument | null>
  /** Todos os documentos de `workPlans` da parceria (versões; quantidade pequena por natureza). */
  listWorkPlans(db: TDb, oscId: string, partnershipId: string): Promise<RawDocument[]>
  /** DEV-02.4: metas e indicadores de uma versão. */
  listComponents(db: TDb, oscId: string, partnershipId: string, workPlanId: string): Promise<{ goals: RawDocument[]; indicators: RawDocument[] }>
  /** DEV-02.5: categorias e itens do planejamento financeiro de uma versão. */
  listFinancial(db: TDb, oscId: string, partnershipId: string, workPlanId: string): Promise<{ categories: RawDocument[]; items: RawDocument[] }>
}

export function createWorkPlanService<TDb>(db: TDb | null, sdk: WorkPlansSdk<TDb>): WorkPlanService {
  const unavailable = () => Promise.resolve({ ok: false as const, error: 'unknown' as const })
  if (db === null) return { available: false, get: unavailable, listVersions: unavailable, listComponents: unavailable, listFinancial: unavailable }
  const instance: TDb = db
  return {
    available: true,
    async get(oscId, partnershipId) {
      if (!PARTNERSHIP_ID_PATTERN.test(partnershipId)) return { ok: true, data: null }
      try {
        const raw = await sdk.getWorkPlan(instance, oscId, partnershipId)
        return { ok: true, data: raw ? parseWorkPlan(raw, oscId, partnershipId) : null }
      } catch (error) {
        return { ok: false, error: mapFirestoreError(error) }
      }
    },
    async listVersions(oscId, partnershipId) {
      if (!PARTNERSHIP_ID_PATTERN.test(partnershipId)) return { ok: true, data: [] }
      try {
        const raws = await sdk.listWorkPlans(instance, oscId, partnershipId)
        // Documentos fora do formato são descartados (falha fechada); ordem pela sequência formal.
        const versions = raws.map((raw) => parseWorkPlan(raw, oscId, partnershipId)).filter((p): p is WorkPlan => p !== null)
        return { ok: true, data: versions.sort((a, b) => a.sequence - b.sequence) }
      } catch (error) {
        return { ok: false, error: mapFirestoreError(error) }
      }
    },
    async listComponents(oscId, partnershipId, workPlanId) {
      if (!PARTNERSHIP_ID_PATTERN.test(partnershipId) || !isVersionId(workPlanId)) return { ok: true, data: { goals: [], indicators: [], discarded: 0 } }
      try {
        const raw = await sdk.listComponents(instance, oscId, partnershipId, workPlanId)
        return { ok: true, data: parseComponents(raw, oscId, partnershipId, workPlanId) }
      } catch (error) {
        return { ok: false, error: mapFirestoreError(error) }
      }
    },
    async listFinancial(oscId, partnershipId, workPlanId) {
      if (!PARTNERSHIP_ID_PATTERN.test(partnershipId) || !isVersionId(workPlanId)) return { ok: true, data: { categories: [], items: [], discarded: 0 } }
      try {
        const raw = await sdk.listFinancial(instance, oscId, partnershipId, workPlanId)
        return { ok: true, data: parseFinancial(raw, oscId, partnershipId, workPlanId) }
      } catch (error) {
        return { ok: false, error: mapFirestoreError(error) }
      }
    },
  }
}
