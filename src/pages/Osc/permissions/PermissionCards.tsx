import { PERMISSION_MODULES, permissionLabel } from '../../../domain/authorization.ts'
import { delegationCell, permissionCell } from './cellModel.ts'
import { nameOf, orderedPermissions, roleOf } from './matrixHelpers.ts'
import type { MatrixProps } from './PermissionMatrix.tsx'
import { DelegationControl, PermissionToggle } from './PermissionToggle.tsx'
import styles from './PermissionMatrix.module.css'
import { cellKey } from './usePermissionDirectory.ts'

/**
 * Apresentação para telas pequenas (UX-001): um cartão por usuário, permissões
 * agrupadas por módulo e controle direto em cada linha (alvo ≥ 44 px).
 * Sem seleção prévia nem passos intermediários.
 */
export function PermissionCards({ context, members, readOnly, showDelegation, pending, failed, onToggle, onDelegation }: MatrixProps) {
  const permissions = orderedPermissions()
  const modules = PERMISSION_MODULES.filter((m) => permissions.some((p) => p.startsWith(`${m.id}.`)))
  return (
    <ul className={styles.cards} aria-label="Usuários e permissões">
      {members.map((member) => {
        const name = nameOf(member)
        const headingId = `cartao-${member.uid}`
        return (
          <li key={member.uid}>
            <article className={styles.card} aria-labelledby={headingId}>
              <header className={styles.cardHeader}>
                <h3 id={headingId} className={styles.cardTitle}>
                  {name}
                  {member.uid === context.uid ? ' (você)' : ''}
                </h3>
                <span className={styles.userMeta}>
                  {roleOf(member)} · {member.status === 'active' ? 'Vínculo ativo' : 'Vínculo inativo'}
                </span>
              </header>
              {modules.map((module) => (
                <fieldset key={module.id} className={styles.cardGroup}>
                  <legend className={styles.cardGroupTitle}>{module.label}</legend>
                  {permissions
                    .filter((p) => p.startsWith(`${module.id}.`))
                    .map((permission) => {
                      const model = permissionCell(context, readOnly, member, permission)
                      const key = cellKey(member.uid, permission)
                      return (
                        <div key={permission} className={styles.cardRow}>
                          <span>{permissionLabel(permission)}</span>
                          <span>
                            <PermissionToggle
                              model={model}
                              label={`${permissionLabel(permission)} — ${name}`}
                              pending={pending[key]}
                              failed={failed[key] === true}
                              onToggle={() => onToggle(member, permission, model.action)}
                            />
                          </span>
                        </div>
                      )
                    })}
                </fieldset>
              ))}
              {showDelegation ? (
                <div className={styles.cardRow}>
                  <span>Delegação (competência administrativa)</span>
                  <span>
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
                  </span>
                </div>
              ) : null}
            </article>
          </li>
        )
      })}
    </ul>
  )
}
