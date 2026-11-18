/**
 * Validação defensiva das parcerias lidas do Firestore (DEV-02.1). Documentos fora do
 * formato, de outro caminho ou de outra OSC são DESCARTADOS (falha fechada).
 */
import { isAdministrativeStatus, isInstrument, isValidDate } from '../../domain/partnerships.ts'
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
  const value = d.globalValueCents
  const globalValueCents = typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
  const workPlan = d.workPlan as Record<string, unknown> | undefined
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
    globalValueCents: d.instrument === 'acordo-cooperacao' ? null : globalValueCents,
    administrativeStatus: d.administrativeStatus,
    workPlanApprovalDeclared: workPlan?.approvalDeclared === true,
    createdAt: toDate(d.createdAt),
    createdBy: typeof d.createdBy === 'string' ? d.createdBy : null,
    updatedAt: toDate(d.updatedAt),
  }
}
