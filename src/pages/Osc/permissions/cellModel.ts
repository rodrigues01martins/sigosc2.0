import {
  evaluate,
  type AuthorizationContext,
  type DenialReason,
  type GrantablePermissionId,
  type MembershipFacts,
} from '../../../domain/authorization.ts'
import type { ManagedMember, MutationAction } from '../../../services/permissions/permissionsApi.ts'

export interface CellModel {
  readonly granted: boolean
  /** Ação determinada pelo estado atual: não concedida → conceder; concedida → revogar. */
  readonly action: MutationAction
  /** `null` = acionável na interface (o servidor decide de novo). */
  readonly blockedBy: DenialReason | null
}

export const factsOf = (m: ManagedMember): MembershipFacts => ({
  uid: m.uid,
  status: m.status,
  permissions: m.permissions,
  canManagePermissions: m.canManagePermissions,
})

/** Estado de exibição de uma célula de permissão operacional. */
export function permissionCell(context: AuthorizationContext, readOnly: boolean, member: ManagedMember, permission: GrantablePermissionId): CellModel {
  const granted = member.permissions.includes(permission)
  const action: MutationAction = granted ? 'revoke-permission' : 'grant-permission'
  if (readOnly) return { granted, action, blockedBy: 'commercial-suspension' }
  // DEC-PAR-002: a linha do administrador único é sempre protegida (Administração da Plataforma).
  if (member.isAdministrator) return { granted, action, blockedBy: 'target-is-administrator' }
  const decision = evaluate(context, { kind: action, target: factsOf(member), permission })
  return { granted, action, blockedBy: decision.allowed ? null : decision.reason }
}

/** Estado de exibição da delegação (competência administrativa, separada das permissões). */
export function delegationCell(context: AuthorizationContext, readOnly: boolean, member: ManagedMember): CellModel {
  const granted = member.canManagePermissions
  const action: MutationAction = granted ? 'revoke-delegation' : 'grant-delegation'
  if (readOnly) return { granted, action, blockedBy: 'commercial-suspension' }
  const decision = evaluate(context, { kind: action, target: factsOf(member) })
  return { granted, action, blockedBy: decision.allowed ? null : decision.reason }
}
