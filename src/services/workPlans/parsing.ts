/** Leitura defensiva do Plano estruturado (DEV-02.2): fora do formato ou de outro caminho → descartado. */
import { isValidDate } from '../../domain/partnerships.ts'
import { FORMAL_ACT_TYPES, isVersionId, parseStoredActivation, type FormalActType } from '../../domain/workPlanVersions.ts'
import { FIELD_IDS, ORIGINAL_WORK_PLAN_ID, emptyValues, parseFieldValue } from '../../domain/workPlans.ts'
import type { RawDocument } from '../organizations/parsing.ts'
import { isComponentId, parseReview, validateGoal, validateIndicator, type GoalData, type IndicatorData } from '../../domain/workPlanComponents.ts'
import type { ComponentRecord, PlanComponents, WorkPlan } from './types.ts'

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
  const activationRaw = (typeof d.activation === 'object' && d.activation !== null ? d.activation : {}) as Record<string, unknown>
  const storedActivation = parseStoredActivation(activationRaw.status)
  // Original: só `superseded` é gravado. Posterior sem situação válida: tratada como legado (nunca vigente).
  const activationStatus: WorkPlan['activationStatus'] = sequence === 1 ? (storedActivation === 'superseded' ? 'superseded' : null) : (storedActivation ?? 'pending-decision')
  const activation = {
    activatedAt: toDate(activationRaw.activatedAt),
    supersededWorkPlanId: isVersionId(activationRaw.supersededWorkPlanId) ? activationRaw.supersededWorkPlanId : null,
    supersededAt: toDate(activationRaw.supersededAt),
    supersededByWorkPlanId: isVersionId(activationRaw.supersededByWorkPlanId) ? activationRaw.supersededByWorkPlanId : null,
  }
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
    activation,
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
    transcription: parseTranscription(d.complementaryTranscription),
    componentReview: parseStoredReview(d.componentReview),
  }
}

function parseTranscription(raw: unknown): WorkPlan['transcription'] {
  if (typeof raw !== 'object' || raw === null) return null
  const t = raw as Record<string, unknown>
  if (t.status !== 'open' && t.status !== 'closed') return null
  const revision = typeof t.revision === 'number' && Number.isSafeInteger(t.revision) && t.revision >= 1 ? t.revision : 1
  return {
    status: t.status,
    revision,
    openedAt: toDate(t.openedAt),
    openedBy: typeof t.openedBy === 'string' ? t.openedBy : null,
    closedAt: toDate(t.closedAt),
    closedBy: typeof t.closedBy === 'string' ? t.closedBy : null,
    review: parseReview(t.review),
  }
}

function parseStoredReview(raw: unknown): WorkPlan['componentReview'] {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const review = parseReview({ goals: r.goals, indicators: r.indicators })
  return review ? { ...review, reviewedAt: toDate(r.reviewedAt), reviewedBy: typeof r.reviewedBy === 'string' ? r.reviewedBy : null } : null
}

/**
 * Metas e indicadores de UMA versão (DEV-02.4), revalidados com o mesmo domínio do servidor.
 * Documento de outro caminho, ID inválido ou conteúdo fora do formato é DESCARTADO (falha fechada);
 * vínculos a metas inexistentes nesta versão invalidam o indicador.
 */
export function parseComponents(raw: { goals: RawDocument[]; indicators: RawDocument[] }, oscId: string, partnershipId: string, workPlanId: string): PlanComponents {
  const prefix = `oscs/${oscId}/partnerships/${partnershipId}/workPlans/${workPlanId}/`
  let discarded = 0
  const meta = (d: RawDocument, collection: string) => {
    const id = d.path.slice(prefix.length + collection.length + 1)
    const ok = d.path.startsWith(`${prefix}${collection}/`) && isComponentId(id) && d.data.oscId === oscId && d.data.partnershipId === partnershipId && d.data.workPlanId === workPlanId
    const revision = typeof d.data.revision === 'number' && Number.isSafeInteger(d.data.revision) && d.data.revision >= 1 ? d.data.revision : 1
    const inherited = (d.data.inheritedFrom as Record<string, unknown> | null | undefined)?.workPlanId
    return ok ? { id, revision, inheritedFrom: isVersionId(inherited) ? inherited : null } : null
  }
  const goals: ComponentRecord<GoalData>[] = []
  for (const d of raw.goals) {
    const m = meta(d, 'goals')
    const v = m && m.id.startsWith('g_') ? validateGoal(d.data.data) : null
    if (m && v?.ok) goals.push({ ...m, kind: 'goal', data: v.data })
    else discarded++
  }
  const known = new Set(goals.map((g) => g.id))
  const indicators: ComponentRecord<IndicatorData>[] = []
  for (const d of raw.indicators) {
    const m = meta(d, 'indicators')
    const v = m && m.id.startsWith('i_') ? validateIndicator(d.data.data, known) : null
    if (m && v?.ok) indicators.push({ ...m, kind: 'indicator', data: v.data })
    else discarded++
  }
  const byOrder = <T extends { data: { order: number; code: string } }>(a: T, b: T) => a.data.order - b.data.order || a.data.code.localeCompare(b.data.code, 'pt-BR', { numeric: true })
  return { goals: goals.sort(byOrder), indicators: indicators.sort(byOrder), discarded }
}
