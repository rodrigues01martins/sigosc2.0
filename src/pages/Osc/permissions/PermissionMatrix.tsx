import ds from '../../../components/ds/ds.module.css'
import { permissionLabel, type AuthorizationContext, type GrantablePermissionId } from '../../../domain/authorization.ts'
import type { ManagedMember, MutationAction } from '../../../services/permissions/permissionsApi.ts'
import { delegationCell, permissionCell } from './cellModel.ts'
import { moduleLabelOf, nameOf, orderedPermissions, roleOf } from './matrixHelpers.ts'
import { DelegationControl, PermissionToggle } from './PermissionToggle.tsx'
import styles from './PermissionMatrix.module.css'
import { cellKey } from './usePermissionDirectory.ts'

export interface MatrixProps {
  context: AuthorizationContext
  members: readonly ManagedMember[]
  readOnly: boolean
  showDelegation: boolean
  pending: Readonly<Record<string, MutationAction>>
  failed: Readonly<Record<string, true>>
  onToggle(member: ManagedMember, permission: GrantablePermissionId, action: MutationAction): void
  onDelegation(member: ManagedMember, action: MutationAction): void
  oscName: string
}

/**
 * Matriz desktop (UX-001): usuários nas linhas, permissões nas colunas,
 * controles nas interseções. Primeira coluna fixa na rolagem horizontal.
 */
export function PermissionMatrix({ context, members, readOnly, showDelegation, pending, failed, onToggle, onDelegation, oscName }: MatrixProps) {
  const permissions = orderedPermissions()
  return (
    <div className={styles.scroll}>
      <table className={styles.matrix}>
        <caption className={ds.srOnly}>Matriz de usuários e permissões operacionais da {oscName}</caption>
        <thead>
          <tr>
            <th scope="col" className={`${styles.sticky} ${styles.left}`}>
              Usuário · vínculo e competência
            </th>
            {permissions.map((permission) => (
              <th key={permission} scope="col" className={styles.cell}>
                <span className={styles.module}>{moduleLabelOf(permission)}</span>
                <span className={styles.permission}>{permissionLabel(permission)}</span>
              </th>
            ))}
            {showDelegation ? (
              <th scope="col" className={styles.delegationCol}>
                <span className={styles.module}>Competência administrativa</span>
                <span className={styles.permission}>Delegação</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const name = nameOf(member)
            const self = member.uid === context.uid
            return (
              <tr key={member.uid} className={member.status !== 'active' ? styles.inactiveRow : undefined}>
                <th scope="row" className={styles.sticky}>
                  <span className={styles.userName}>
                    {name}
                    {self ? ' (você)' : ''}
                  </span>
                  <span className={styles.userMeta}>
                    <span className={styles.role}>{roleOf(member)}</span> · {member.status === 'active' ? 'Vínculo ativo' : 'Vínculo inativo'}
                  </span>
                </th>
                {permissions.map((permission) => {
                  const model = permissionCell(context, readOnly, member, permission)
                  const key = cellKey(member.uid, permission)
                  return (
                    <td key={permission} className={styles.cell}>
                      <PermissionToggle
                        model={model}
                        label={`${permissionLabel(permission)} — ${name}`}
                        pending={pending[key]}
                        failed={failed[key] === true}
                        onToggle={() => onToggle(member, permission, model.action)}
                      />
                    </td>
                  )
                })}
                {showDelegation ? (
                  <td className={styles.delegationCol}>
                    {(() => {
                      const model = delegationCell(context, readOnly, member)
                      const key = cellKey(member.uid, 'delegation')
                      return (
                        <DelegationControl
                          model={model}
                          who={name}
                          pending={pending[key]}
                          failed={failed[key] === true}
                          onRequest={() => onDelegation(member, model.action)}
                        />
                      )
                    })()}
                  </td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
