/**
 * Dados FICTÍCIOS complementares para permissões (DEV-01.3).
 *
 * Acrescentam usuários à OSC ALFA SEM alterar os cenários da DEV-01.2
 * (`organizationFixtures.ts`): MULTI continua administrador de ALFA.
 * - DELEGATE: membro ativo de ALFA com delegação de gestão de permissões.
 * - OPERATOR: membro ativo de ALFA com uma permissão operacional.
 * - FORMER:   ex-membro de ALFA (vínculo inativo), com permissão histórica.
 */
import type { MemberFixture } from './organizationFixtures.ts'
import { OSCS } from './organizationFixtures.ts'

export const PERMISSION_USERS = {
  DELEGATE: { uid: 'uid-ficticio-delegate', email: 'delegado@exemplo.invalid', password: 'senha-ficticia-delegate' },
  OPERATOR: { uid: 'uid-ficticio-operator', email: 'operador@exemplo.invalid', password: 'senha-ficticia-operator' },
  FORMER: { uid: 'uid-ficticio-former', email: 'ex.membro@exemplo.invalid', password: 'senha-ficticia-former' },
} as const

export type PermissionMemberFixture = MemberFixture & { permissions?: string[]; canManagePermissions?: boolean }

export const PERMISSION_MEMBERS: PermissionMemberFixture[] = [
  { oscId: OSCS.ALFA.id, uid: PERMISSION_USERS.DELEGATE.uid, status: 'active', specialRole: null, permissions: [], canManagePermissions: true },
  { oscId: OSCS.ALFA.id, uid: PERMISSION_USERS.OPERATOR.uid, status: 'active', specialRole: null, permissions: ['partnerships.view'] },
  { oscId: OSCS.ALFA.id, uid: PERMISSION_USERS.FORMER.uid, status: 'inactive', specialRole: null, permissions: ['documents.view'] },
]
