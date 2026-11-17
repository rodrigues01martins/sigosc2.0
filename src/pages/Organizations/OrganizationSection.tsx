import { useId } from 'react'
import { LoadingState } from '../../components/LoadingState.tsx'
import { useActiveMembership, useOrganizationActions, useOrganizationState } from '../../hooks/useOrganization.ts'
import type { Membership } from '../../services/organizations/types.ts'
import authStyles from '../Auth/AuthPages.module.css'
import { PermissionsPanel } from '../Permissions/PermissionsPanel.tsx'
import styles from './OrganizationSection.module.css'
import {
  COMMERCIAL_LABEL,
  LOAD_ERROR_MESSAGE,
  NO_MEMBERSHIP_MESSAGE,
  REGISTRATION_LABEL,
  SELECTION_ERROR_MESSAGE,
  UNSELECTABLE_LABEL,
} from './labels.ts'

/**
 * Seleção da OSC ativa (interface técnica provisória — DEV-01.2).
 * Exibe SOMENTE os vínculos do próprio usuário; dados institucionais apenas de
 * OSCs com vínculo ativo. A seleção não substitui as Security Rules.
 */
export function OrganizationSection() {
  const state = useOrganizationState()
  const { reload } = useOrganizationActions()
  const titleId = useId()

  let content
  switch (state.status) {
    case 'signed-out':
    case 'loading':
      content = <LoadingState label="Consultando seus vínculos organizacionais…" />
      break
    case 'unavailable':
      content = (
        <p className={authStyles.alert} role="alert">
          Consulta de OSCs indisponível: a configuração do Firebase deste ambiente não é válida.
        </p>
      )
      break
    case 'error':
      content = (
        <div className={authStyles.stack}>
          <p className={authStyles.alert} role="alert">
            {LOAD_ERROR_MESSAGE[state.error]}
          </p>
          <button className={authStyles.secondaryButton} type="button" onClick={() => void reload()}>
            Tentar novamente
          </button>
        </div>
      )
      break
    case 'ready':
      content =
        state.memberships.length === 0 ? (
          <p className={authStyles.notice}>{NO_MEMBERSHIP_MESSAGE}</p>
        ) : (
          <ReadyContent />
        )
      break
  }

  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.heading}>
        Organizações
      </h2>
      {content}
    </section>
  )
}

function ReadyContent() {
  const state = useOrganizationState()
  const active = useActiveMembership()
  if (state.status !== 'ready') return null

  return (
    <>
      <div className={styles.active} aria-live="polite">
        {active?.organization ? (
          /* `key` força nova montagem a cada troca: dados da OSC anterior são descartados (U05). */
          <ActiveOrganization key={active.oscId} membership={active} />
        ) : (
          <p className={styles.muted}>Nenhuma OSC selecionada. Escolha uma organização abaixo.</p>
        )}
      </div>

      {active?.organization ? (
        /* DEV-01.3: permissões da OSC ativa; `key` descarta o estado ao trocar de OSC. */
        <PermissionsPanel key={active.oscId} membership={active} />
      ) : null}

      {state.selectionError ? (
        <p className={authStyles.alert} role="alert">
          {SELECTION_ERROR_MESSAGE[state.selectionError]}
        </p>
      ) : null}

      <ul className={styles.list} aria-label="OSCs vinculadas">
        {state.memberships.map((membership) => (
          <MembershipItem
            key={membership.oscId}
            membership={membership}
            current={membership.oscId === state.activeOscId}
            pending={state.pendingOscId}
          />
        ))}
      </ul>
    </>
  )
}

function ActiveOrganization({ membership }: { membership: Membership }) {
  return (
    <>
      <p className={styles.muted}>OSC ativa</p>
      <p className={styles.activeName}>{membership.organization?.name}</p>
      <p className={styles.muted}>
        {membership.isAdministrator ? 'Você é o administrador designado desta OSC. ' : ''}
        As funcionalidades da OSC ainda não foram implementadas.
      </p>
    </>
  )
}

interface MembershipItemProps {
  membership: Membership
  current: boolean
  pending: string | null
}

function MembershipItem({ membership, current, pending }: MembershipItemProps) {
  const { select } = useOrganizationActions()
  const { organization, selectable } = membership
  const itemClass = [
    styles.item,
    current ? styles.itemCurrent : selectable ? styles.itemSelectable : styles.itemBlocked,
  ].join(' ')
  const name = organization?.name ?? 'OSC sem dados disponíveis'
  const isPending = pending === membership.oscId

  return (
    <li className={itemClass} aria-current={current ? 'true' : undefined}>
      <p className={styles.name}>{name}</p>
      <ul className={styles.badges} aria-label="Situação">
        <li className={membership.status === 'active' ? styles.badgeOk : styles.badgeBlocked}>
          {membership.status === 'active' ? 'Vínculo ativo' : 'Vínculo inativo'}
        </li>
        {membership.isAdministrator ? <li className={styles.badgeAdmin}>Administrador da OSC</li> : null}
      </ul>
      {organization ? (
        <dl className={styles.details}>
          <div>
            <dt>Situação cadastral:</dt>
            <dd>{REGISTRATION_LABEL[organization.registrationStatus]}</dd>
          </div>
          <div>
            <dt>Situação comercial:</dt>
            <dd>{COMMERCIAL_LABEL[organization.commercialStatus]}</dd>
          </div>
        </dl>
      ) : (
        <p className={styles.muted}>Identificador: {membership.oscId}</p>
      )}
      {membership.unselectableReason ? (
        <p className={styles.reason}>{UNSELECTABLE_LABEL[membership.unselectableReason]}</p>
      ) : null}
      {current ? (
        <p className={styles.current}>✓ OSC ativa</p>
      ) : selectable ? (
        <button
          className={authStyles.secondaryButton}
          type="button"
          onClick={() => void select(membership.oscId)}
          disabled={pending !== null}
          aria-busy={isPending}
          aria-label={`Selecionar ${name}`}
        >
          {isPending ? 'Validando vínculo…' : 'Selecionar'}
        </button>
      ) : null}
    </li>
  )
}
