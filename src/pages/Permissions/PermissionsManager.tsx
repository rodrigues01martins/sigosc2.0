import { useCallback, useEffect, useId, useState } from 'react'
import {
  DENIAL_MESSAGE,
  GRANTABLE_PERMISSIONS,
  permissionLabel,
  type AuthorizationContext,
  type DenialReason,
  type GrantablePermissionId,
  type MembershipFacts,
  type Operation,
} from '../../domain/authorization.ts'
import { decide, usePermissionsApi } from '../../hooks/useAuthorization.ts'
import type {
  ManagedMember,
  MemberDirectory,
  MutationAction,
  PermissionsApiError,
} from '../../services/permissions/permissionsApi.ts'
import authStyles from '../Auth/AuthPages.module.css'
import { directoryToCsv } from './exportCsv.ts'
import styles from './Permissions.module.css'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: PermissionsApiError; reason?: DenialReason }
  | { status: 'ready'; directory: MemberDirectory }

interface PendingAction {
  action: MutationAction
  member: ManagedMember
  permission?: GrantablePermissionId
}

const API_ERROR_MESSAGE: Record<PermissionsApiError, string> = {
  unavailable:
    'Gestão de permissões indisponível neste ambiente: as operações de servidor ainda não foram publicadas ou configuradas. Nenhuma alteração foi realizada.',
  network: 'Falha de conexão com o servidor. Nenhuma alteração foi confirmada.',
  'session-expired': 'Sua sessão expirou ou foi encerrada. Saia e entre novamente.',
  forbidden: 'Acesso negado pelo servidor.',
  'invalid-request': 'Solicitação inválida.',
  unknown: 'Não foi possível concluir a operação. Tente novamente.',
}

function errorMessage(error: PermissionsApiError, reason?: DenialReason): string {
  return error === 'forbidden' && reason ? `Acesso negado: ${DENIAL_MESSAGE[reason]}` : API_ERROR_MESSAGE[error]
}

const memberName = (m: ManagedMember) => m.email ?? m.uid

function describe(pending: PendingAction): string {
  const who = memberName(pending.member)
  switch (pending.action) {
    case 'grant-permission':
      return `Conceder a permissão "${permissionLabel(pending.permission as GrantablePermissionId)}" para ${who}?`
    case 'revoke-permission':
      return `Revogar a permissão "${permissionLabel(pending.permission as GrantablePermissionId)}" de ${who}?`
    case 'grant-delegation':
      return `Conceder a ${who} a delegação para gerir permissões desta OSC?`
    case 'revoke-delegation':
      return `Revogar a delegação de ${who} para gerir permissões desta OSC?`
  }
}

function toFacts(member: ManagedMember): MembershipFacts {
  return { uid: member.uid, status: member.status, permissions: member.permissions, canManagePermissions: member.canManagePermissions }
}

/**
 * P02–P06 — gestão de permissões da OSC (interface técnica provisória).
 * Os controles exibidos seguem o avaliador de domínio, mas TODA operação é
 * decidida pelo servidor; nenhuma alteração é simulada localmente.
 */
export function PermissionsManager({ context }: { context: AuthorizationContext }) {
  const api = usePermissionsApi()
  const oscId = context.oscId
  const titleId = useId()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    const result = await api.listMembers(oscId)
    setState(result.ok ? { status: 'ready', directory: result.data } : { status: 'error', error: result.error, reason: result.reason })
  }, [api, oscId])

  useEffect(() => {
    let active = true
    void api.listMembers(oscId).then((result) => {
      if (!active) return
      setState(result.ok ? { status: 'ready', directory: result.data } : { status: 'error', error: result.error, reason: result.reason })
    })
    return () => {
      active = false
    }
  }, [api, oscId])

  async function confirm() {
    if (!pending) return
    setBusy(true)
    setMessage(null)
    const result = await api.mutate({
      oscId,
      targetUid: pending.member.uid,
      action: pending.action,
      permission: pending.permission,
    })
    setBusy(false)
    setPending(null)
    if (result.ok) {
      setMessage({ kind: 'success', text: result.data.changed ? 'Alteração registrada pelo servidor.' : 'Nenhuma alteração necessária.' })
      setState({ status: 'loading' })
      await load()
    } else {
      setMessage({ kind: 'error', text: errorMessage(result.error, result.reason) })
    }
  }

  function exportCsv(directory: MemberDirectory) {
    if (typeof URL.createObjectURL !== 'function') return
    const blob = new Blob(['﻿', directoryToCsv(directory)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `permissoes-${directory.oscId}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const statusMessage = message ? (
    <p className={message.kind === 'success' ? authStyles.success : authStyles.alert} role={message.kind === 'success' ? 'status' : 'alert'}>
      {message.text}
    </p>
  ) : null

  if (state.status === 'loading') {
    return (
      <div className={styles.panel} aria-busy="true">
        {statusMessage}
        <p className={styles.text} role="status">
          Carregando usuários e permissões…
        </p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className={styles.panel}>
        <p className={authStyles.alert} role="alert">
          {errorMessage(state.error, state.reason)}
        </p>
        {state.error === 'network' || state.error === 'unknown' ? (
          <button className={styles.smallButton} type="button" onClick={() => { setState({ status: 'loading' }); void load() }}>
            Tentar novamente
          </button>
        ) : null}
      </div>
    )
  }

  const { directory } = state
  const allowed = (operation: Operation) => !directory.readOnly && decide(context, operation).allowed

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <h4 id={titleId} className={styles.subheading}>
        Gestão de permissões — {directory.organizationName}
      </h4>
      {directory.readOnly ? (
        <p className={authStyles.notice}>Somente consulta: alterações bloqueadas pela suspensão comercial.</p>
      ) : null}
      {statusMessage}
      {directory.viewerAuthority === 'administrator' ? (
        <div className={styles.actions}>
          <button className={styles.smallButton} type="button" onClick={() => exportCsv(directory)}>
            Exportar relação (CSV)
          </button>
        </div>
      ) : null}

      <ul className={styles.members} aria-label="Usuários vinculados">
        {directory.members.map((member) => {
          const target = toFacts(member)
          const self = member.uid === context.uid
          const isPendingHere = pending?.member.uid === member.uid
          return (
            <li key={member.uid} className={styles.member}>
              <p className={styles.memberName}>
                {memberName(member)}
                {self ? ' (você)' : ''}
              </p>
              <ul className={styles.chips} aria-label="Situação">
                <li className={styles.chip}>{member.status === 'active' ? 'Vínculo ativo' : 'Vínculo inativo'}</li>
                {member.isAdministrator ? <li className={styles.chip}>Administrador designado</li> : null}
                {member.canManagePermissions ? <li className={styles.chip}>Delegado</li> : null}
              </ul>

              <ul className={styles.permissionList} aria-label={`Permissões de ${memberName(member)}`}>
                {GRANTABLE_PERMISSIONS.map((permission) => {
                  const granted = member.permissions.includes(permission)
                  const action: MutationAction = granted ? 'revoke-permission' : 'grant-permission'
                  const canAct = allowed({ kind: action, target, permission })
                  return (
                    <li key={permission} className={styles.permissionRow}>
                      <span className={styles.permissionLabel}>{permissionLabel(permission)}</span>
                      <span className={granted ? styles.granted : styles.notGranted}>{granted ? 'Concedida' : 'Não concedida'}</span>
                      {canAct ? (
                        <button
                          className={styles.smallButton}
                          type="button"
                          disabled={busy || pending !== null}
                          aria-label={`${granted ? 'Revogar' : 'Conceder'} ${permissionLabel(permission)} — ${memberName(member)}`}
                          onClick={() => { setMessage(null); setPending({ action, member, permission }) }}
                        >
                          {granted ? 'Revogar' : 'Conceder'}
                        </button>
                      ) : null}
                    </li>
                  )
                })}
              </ul>

              {(() => {
                const action: MutationAction = member.canManagePermissions ? 'revoke-delegation' : 'grant-delegation'
                return allowed({ kind: action, target }) ? (
                  <div className={styles.actions}>
                    <button
                      className={styles.smallButton}
                      type="button"
                      disabled={busy || pending !== null}
                      aria-label={`${member.canManagePermissions ? 'Revogar' : 'Conceder'} delegação — ${memberName(member)}`}
                      onClick={() => { setMessage(null); setPending({ action, member }) }}
                    >
                      {member.canManagePermissions ? 'Revogar delegação' : 'Conceder delegação'}
                    </button>
                  </div>
                ) : null
              })()}

              {isPendingHere && pending ? (
                <div className={styles.confirm} role="alertdialog" aria-label="Confirmar operação" aria-describedby={`${titleId}-confirm`}>
                  <p id={`${titleId}-confirm`} className={styles.text}>
                    {describe(pending)}
                  </p>
                  <div className={styles.actions}>
                    <button className={styles.smallButton} type="button" autoFocus disabled={busy} onClick={() => void confirm()}>
                      {busy ? 'Enviando…' : 'Confirmar'}
                    </button>
                    <button className={styles.smallButton} type="button" disabled={busy} onClick={() => setPending(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
