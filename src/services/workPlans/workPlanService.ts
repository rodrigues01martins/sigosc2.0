/** Consulta do Plano estruturado da parceria (DEV-02.2) — uma LEITURA no servidor, sob as Security Rules. */
import { mapFirestoreError } from '../organizations/errors.ts'
import type { RawDocument } from '../organizations/parsing.ts'
import { PARTNERSHIP_ID_PATTERN } from '../partnerships/types.ts'
import { parseWorkPlan } from './parsing.ts'
import type { WorkPlan, WorkPlanService } from './types.ts'

export interface WorkPlansSdk<TDb> {
  getWorkPlan(db: TDb, oscId: string, partnershipId: string): Promise<RawDocument | null>
  /** Todos os documentos de `workPlans` da parceria (versões; quantidade pequena por natureza). */
  listWorkPlans(db: TDb, oscId: string, partnershipId: string): Promise<RawDocument[]>
}

export function createWorkPlanService<TDb>(db: TDb | null, sdk: WorkPlansSdk<TDb>): WorkPlanService {
  if (db === null) return { available: false, get: () => Promise.resolve({ ok: false, error: 'unknown' }), listVersions: () => Promise.resolve({ ok: false, error: 'unknown' }) }
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
  }
}
