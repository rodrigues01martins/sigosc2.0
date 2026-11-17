import {
  GRANTABLE_PERMISSIONS,
  PERMISSION_CATALOG,
  PERMISSION_MODULES,
  type GrantablePermissionId,
} from '../../../domain/authorization.ts'
import type { ManagedMember } from '../../../services/permissions/permissionsApi.ts'

export const nameOf = (m: ManagedMember) => m.email ?? m.uid

export function roleOf(m: ManagedMember): string {
  if (m.isAdministrator) return 'Administrador único'
  return m.canManagePermissions ? 'Delegado' : 'Operacional'
}

/** Colunas na ordem dos módulos do catálogo vigente (sem permissões inventadas). */
export function orderedPermissions(): GrantablePermissionId[] {
  return PERMISSION_MODULES.flatMap((module) => GRANTABLE_PERMISSIONS.filter((p) => p.startsWith(`${module.id}.`)))
}

export function moduleLabelOf(permission: GrantablePermissionId): string {
  const entry = PERMISSION_CATALOG.find((p) => p.id === permission)
  return PERMISSION_MODULES.find((m) => m.id === entry?.module)?.label ?? ''
}
