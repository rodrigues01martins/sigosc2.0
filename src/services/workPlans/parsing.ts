/** Leitura defensiva do Plano estruturado (DEV-02.2): fora do formato ou de outro caminho → descartado. */
import { isValidDate } from '../../domain/partnerships.ts'
import { FORMAL_ACT_TYPES, isVersionId, type FormalActType } from '../../domain/workPlanVersions.ts'
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
  if (!match || match[1] !== oscId || match[2] !== partnershipId || !isVersionId(match[3])) return null
  const id = match[3] as string
  const d = raw.data
  if (d.oscId !== oscId || d.partnershipId !== partnershipId) return null
  const origin = (typeof d.origin === 'object' && d.origin !== null ? d.origin : {}) as Record<string, unknown>
  const sequence = id === ORIGINAL_WORK_PLAN_ID ? 1 : typeof origin.sequence === 'number' && Number.isSafeInteger(origin.sequence) && origin.sequence > 1 ? origin.sequence : null
  if (sequence === null || (id !== ORIGINAL_WORK_PLAN_ID && id !== `v${sequence}`)) return null
  const act = (typeof d.formalAct === 'object' && d.formalAct !== null ? d.formalAct : null) as Record<string, unknown> | null
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  const formalAct =
    sequence > 1 && act && FORMAL_ACT_TYPES.some((t) => t.id === act.type) && isValidDate(act.actDate)
      ? {
          type: act.type as FormalActType,
          typeDescription: str(act.typeDescription),
          reference: str(act.reference),
          actDate: act.actDate,
          description: str(act.description),
          effectiveDate: isValidDate(act.effectiveDate) ? act.effectiveDate : null,
          declaredBy: str(act.declaredBy),
          declaredAt: toDate(act.declaredAt),
        }
      : null
  if (sequence > 1 && !formalAct) return null
  const activation = (d.activation as Record<string, unknown> | undefined)?.status
  const activationStatus: WorkPlan['activationStatus'] =
    sequence === 1 ? null : activation === 'active' || activation === 'superseded' ? activation : 'pending-decision'
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
    id,
    sequence,
    previousWorkPlanId: sequence > 1 && isVersionId(origin.previousWorkPlanId) ? origin.previousWorkPlanId : null,
    formalAct,
    activationStatus,
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
