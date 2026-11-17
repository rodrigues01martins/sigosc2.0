/**
 * Validação defensiva dos documentos lidos do Firestore (DEV-01.2).
 * Documentos fora do formato esperado são DESCARTADOS (falha fechada):
 * um vínculo inconsistente nunca é tratado como autorizado.
 */
import { sanitizePermissions, type GrantablePermissionId } from '../../domain/authorization.ts'
import {
  COMMERCIAL_STATUSES,
  MEMBERSHIP_STATUSES,
  REGISTRATION_STATUSES,
  type MembershipStatus,
  type OrganizationSummary,
} from './types.ts'

/** Documento bruto devolvido pelo adaptador do SDK. */
export interface RawDocument {
  /** Caminho completo, ex.: `oscs/osc-a/members/uid-1`. */
  readonly path: string
  readonly data: Readonly<Record<string, unknown>>
}

const MEMBER_PATH = /^oscs\/([^/]+)\/members\/([^/]+)$/
const OSC_PATH = /^oscs\/([^/]+)$/

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

export interface ParsedMember {
  readonly oscId: string
  readonly uid: string
  readonly status: MembershipStatus
  readonly permissions: readonly GrantablePermissionId[]
  readonly canManagePermissions: boolean
}

/**
 * Aceita somente vínculos em `oscs/{oscId}/members/{uid}` cujos campos `uid` e
 * `oscId` coincidam com o caminho e com o usuário esperado.
 */
export function parseMember(doc: RawDocument, expectedUid: string): ParsedMember | null {
  const match = MEMBER_PATH.exec(doc.path)
  if (!match) return null
  const [, oscId, pathUid] = match
  const { uid, oscId: fieldOscId, status, permissions, canManagePermissions } = doc.data
  if (pathUid !== expectedUid || uid !== expectedUid || fieldOscId !== oscId || !oscId) return null
  if (!oneOf(MEMBERSHIP_STATUSES, status)) return null
  // DEV-01.3: campos opcionais. Valores desconhecidos não concedem nada (falha fechada).
  return {
    oscId,
    uid: expectedUid,
    status,
    permissions: sanitizePermissions(permissions),
    canManagePermissions: canManagePermissions === true,
  }
}

export function parseOrganization(doc: RawDocument, expectedId: string): OrganizationSummary | null {
  const match = OSC_PATH.exec(doc.path)
  if (!match || match[1] !== expectedId) return null
  const { id, name, registrationStatus, commercialStatus, administratorUid } = doc.data
  if (id !== expectedId || typeof name !== 'string' || name.trim() === '') return null
  if (!oneOf(REGISTRATION_STATUSES, registrationStatus)) return null
  if (!oneOf(COMMERCIAL_STATUSES, commercialStatus)) return null
  if (administratorUid !== null && (typeof administratorUid !== 'string' || administratorUid === '')) return null
  return { id: expectedId, name: name.trim(), registrationStatus, commercialStatus, administratorUid }
}
