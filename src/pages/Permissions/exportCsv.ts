import { GRANTABLE_PERMISSIONS } from '../../domain/authorization.ts'
import type { MemberDirectory } from '../../services/permissions/permissionsApi.ts'

/** Neutraliza fórmulas de planilha (injeção de CSV) e escapa aspas. */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

/** Relação de usuários e permissões da OSC (exportação autorizada ao administrador). */
export function directoryToCsv(directory: MemberDirectory): string {
  const header = ['uid', 'email', 'vinculo', 'administrador', 'delegado', ...GRANTABLE_PERMISSIONS]
  const rows = directory.members.map((m) => [
    m.uid,
    m.email ?? '',
    m.status === 'active' ? 'ativo' : 'inativo',
    m.isAdministrator ? 'sim' : 'nao',
    m.canManagePermissions ? 'sim' : 'nao',
    ...GRANTABLE_PERMISSIONS.map((p) => (m.permissions.includes(p) ? 'sim' : 'nao')),
  ])
  return [header, ...rows].map((row) => row.map(cell).join(';')).join('\r\n')
}
