/**
 * Validação defensiva das parcerias lidas do Firestore (DEV-02.1). Documentos fora do
 * formato, de outro caminho ou de outra OSC são DESCARTADOS (falha fechada).
 */
import { isAdministrativeStatus, isInstrument, isValidDate, type GlobalValueStatus } from '../../domain/partnerships.ts'
import type { RawDocument } from '../organizations/parsing.ts'
import type { Partnership } from './types.ts'

const PATH = /^oscs\/([^/]+)\/partnerships\/([^/]+)$/

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    const date: unknown = value.toDate()
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null
  }
  return null
}

const str = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

export function parsePartnership(raw: RawDocument, oscId: string): Partnership | null {
  const match = PATH.exec(raw.path)
  if (!match || match[1] !== oscId) return null
  const id = match[2] as string
  const d = raw.data
  if (d.oscId !== oscId || (d.id !== undefined && d.id !== id)) return null
  if (!isInstrument(d.instrument) || !isAdministrativeStatus(d.administrativeStatus)) return null
  if (!str(d.instrumentNumber) || !str(d.publicPartner) || !str(d.object)) return null
  if (!isValidDate(d.formalizationDate) || !isValidDate(d.termStart) || !isValidDate(d.termEnd)) return null
  // Valor global: esquema C01 (`globalValueStatus`) ou anterior (derivado sem inventar valores).
  const cents = typeof d.globalValueCents === 'number' && Number.isSafeInteger(d.globalValueCents) && d.globalValueCents >= 0 ? d.globalValueCents : null
  let globalValueStatus: GlobalValueStatus
  if (d.instrument === 'acordo-cooperacao') globalValueStatus = 'not-applicable'
  else if (d.globalValueStatus === 'informed' && cents !== null) globalValueStatus = 'informed'
  else if (d.globalValueStatus === 'not-informed') globalValueStatus = 'not-informed'
  else if (d.globalValueStatus === undefined) globalValueStatus = cents !== null && cents > 0 ? 'informed' : 'not-informed'
  else return null
  const workPlan = d.workPlan as Record<string, unknown> | undefined
  const revision = typeof d.revision === 'number' && Number.isSafeInteger(d.revision) && d.revision >= 1 ? d.revision : 1
  return {
    id,
    oscId,
    instrument: d.instrument,
    instrumentNumber: d.instrumentNumber,
    publicPartner: d.publicPartner,
    object: d.object,
    administrativeProcess: str(d.administrativeProcess) ? d.administrativeProcess : null,
    formalizationDate: d.formalizationDate,
    termStart: d.termStart,
    termEnd: d.termEnd,
    globalValueStatus,
    globalValueCents: globalValueStatus === 'informed' ? cents : null,
    administrativeStatus: d.administrativeStatus,
    administrativeStatusDeclaredAt: toDate(d.administrativeStatusDeclaredAt),
    administrativeStatusDeclaredBy: typeof d.administrativeStatusDeclaredBy === 'string' ? d.administrativeStatusDeclaredBy : null,
    revision,
    workPlanApprovalDeclared: workPlan?.approvalDeclared === true,
    createdAt: toDate(d.createdAt),
    createdBy: typeof d.createdBy === 'string' ? d.createdBy : null,
    updatedAt: toDate(d.updatedAt),
    updatedBy: typeof d.updatedBy === 'string' ? d.updatedBy : null,
  }
}
