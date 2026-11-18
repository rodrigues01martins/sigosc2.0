/** Leitura defensiva do Plano estruturado (DEV-02.2): fora do formato ou de outro caminho → descartado. */
import { FIELD_IDS, ORIGINAL_WORK_PLAN_ID, emptyValues, parseFieldValue } from '../../domain/workPlans.ts'
import type { RawDocument } from '../organizations/parsing.ts'
import type { WorkPlan } from './types.ts'

const PATH = /^oscs\/([^/]+)\/partnerships\/([^/]+)\/workPlans\/([^/]+)$/

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    const date: unknown = value.toDate()
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null
  }
  return null
}

export function parseWorkPlan(raw: RawDocument, oscId: string, partnershipId: string): WorkPlan | null {
  const match = PATH.exec(raw.path)
  if (!match || match[1] !== oscId || match[2] !== partnershipId || match[3] !== ORIGINAL_WORK_PLAN_ID) return null
  const d = raw.data
  if (d.oscId !== oscId || d.partnershipId !== partnershipId) return null
  if (d.registrationStatus !== 'in-registration' && d.registrationStatus !== 'finalized') return null
  const stored = (typeof d.values === 'object' && d.values !== null ? d.values : {}) as Record<string, unknown>
  const values = emptyValues()
  // Valores inválidos viram "não informado" (nunca são inventados); datas gravadas não são limitadas por "hoje".
  for (const id of FIELD_IDS) {
    const parsed = parseFieldValue(id, stored[id], '9999-12-31')
    if (parsed.value) values[id] = parsed.value
  }
  const revision = typeof d.revision === 'number' && Number.isSafeInteger(d.revision) && d.revision >= 1 ? d.revision : 1
  return {
    id: ORIGINAL_WORK_PLAN_ID,
    oscId,
    partnershipId,
    registrationStatus: d.registrationStatus,
    values,
    documentStatus: 'not-stored',
    revision,
    createdAt: toDate(d.createdAt),
    createdBy: typeof d.createdBy === 'string' ? d.createdBy : null,
    updatedAt: toDate(d.updatedAt),
    updatedBy: typeof d.updatedBy === 'string' ? d.updatedBy : null,
    finalizedAt: toDate(d.finalizedAt),
    finalizedBy: typeof d.finalizedBy === 'string' ? d.finalizedBy : null,
  }
}
