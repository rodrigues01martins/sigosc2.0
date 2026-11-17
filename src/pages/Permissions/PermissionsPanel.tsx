import { useId, useState } from 'react'
import { PERMISSION_MODULES, isCommerciallySuspended, permissionLabel } from '../../domain/authorization.ts'
import { decide, useAuthorizationContext } from '../../hooks/useAuthorization.ts'
import type { Membership } from '../../services/organizations/types.ts'
import authStyles from '../Auth/AuthPages.module.css'
import { PermissionsManager } from './PermissionsManager.tsx'
import styles from './Permissions.module.css'

const AUTHORITY_LABEL = {
  administrator: 'Administrador designado da OSC',
  delegate: 'Delegado para gestão de permissões',
  member: 'Usuário vinculado',
} as const

/**
 * P01 — permissões próprias na OSC ativa e acesso à gestão (DEV-01.3).
 * Montado com `key` = OSC ativa: a troca de OSC descarta todo o estado (U05).
 */
export function PermissionsPanel({ membership }: { membership: Membership }) {
  const context = useAuthorizationContext(membership)
  const titleId = useId()
  const [managing, setManaging] = useState(false)

  const own = decide(context, { kind: 'view-own-permissions' })
  if (!own.allowed) return null
  const canManage = decide(context, { kind: 'list-members' })
  const suspended = context.organization ? isCommerciallySuspended(context.organization) : false

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.heading}>
        Permissões nesta OSC
      </h3>
      <p className={styles.text}>
        Sua competência: <strong>{AUTHORITY_LABEL[own.authority]}</strong>
      </p>

      {suspended ? (
        <p className={authStyles.notice}>
          {own.authority === 'administrator'
            ? 'Situação comercial suspensa: consulta e exportação disponíveis; concessões, revogações e delegações bloqueadas.'
            : 'Situação comercial suspensa: as operações nesta OSC estão bloqueadas.'}
        </p>
      ) : null}

      <h4 className={styles.subheading}>Permissões operacionais</h4>
      {membership.permissions.length === 0 ? (
        <p className={styles.text}>Nenhuma permissão operacional concedida.</p>
      ) : (
        PERMISSION_MODULES.filter((module) => membership.permissions.some((p) => p.startsWith(`${module.id}.`))).map((module) => (
          <div key={module.id}>
            <p className={styles.text}>{module.label}</p>
            <ul className={styles.chips} aria-label={module.label}>
              {membership.permissions
                .filter((p) => p.startsWith(`${module.id}.`))
                .map((p) => (
                  <li key={p} className={styles.chip}>
                    {permissionLabel(p)}
                  </li>
                ))}
            </ul>
          </div>
        ))
      )}
      {own.authority === 'administrator' ? (
        <p className={styles.text}>A função de administrador não inclui permissões operacionais implícitas.</p>
      ) : null}

      {canManage.allowed ? (
        <button
          className={authStyles.secondaryButton}
          type="button"
          aria-expanded={managing}
          onClick={() => setManaging((open) => !open)}
        >
          {managing ? 'Fechar gestão de permissões' : 'Gerenciar permissões da OSC'}
        </button>
      ) : null}
      {canManage.allowed && managing ? <PermissionsManager context={context} /> : null}
    </section>
  )
}
