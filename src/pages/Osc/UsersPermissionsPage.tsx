import { useCallback, useEffect, useState } from 'react'
import { CheckIcon, InfoIcon, MinusIcon, UsersIcon } from '../../components/ds/icons.tsx'
import ds from '../../components/ds/ds.module.css'
import { ContextBar } from '../../components/osc/ContextBar.tsx'
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
  ApiResult,
  ManagedMember,
  MemberDirectory,
  MutationAction,
  PermissionsApiError,
} from '../../services/permissions/permissionsApi.ts'
import { directoryToCsv } from '../Permissions/exportCsv.ts'
import { AUTHORITY_LABEL } from './oscLabels.ts'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: PermissionsApiError; reason?: DenialReason }
  | { status: 'ready'; directory: MemberDirectory }

type Mode = 'grant' | 'revoke' | null

interface Pending {
  action: MutationAction
  member: ManagedMember
  permission?: GrantablePermissionId
}

const API_ERROR_MESSAGE: Record<PermissionsApiError, string> = {
  unavailable:
    'Gestão de permissões indisponível neste ambiente: as operações de servidor não estão publicadas ou configuradas. Nenhuma alteração foi realizada.',
  network: 'Falha de conexão com o servidor. Nenhuma alteração foi confirmada.',
  'session-expired': 'Sua sessão expirou ou foi encerrada. Saia e entre novamente.',
  forbidden: 'Acesso negado pelo servidor.',
  'invalid-request': 'Solicitação inválida.',
  unknown: 'Não foi possível concluir a operação. Tente novamente.',
}

function errorMessage(error: PermissionsApiError, reason?: DenialReason): string {
  return error === 'forbidden' && reason ? `Acesso negado: ${DENIAL_MESSAGE[reason]}` : API_ERROR_MESSAGE[error]
}

const nameOf = (m: ManagedMember) => m.email ?? m.uid
const facts = (m: ManagedMember): MembershipFacts => ({ uid: m.uid, status: m.status, permissions: m.permissions, canManagePermissions: m.canManagePermissions })

function roleOf(m: ManagedMember): string {
  if (m.status !== 'active') return 'Vínculo inativo'
  if (m.isAdministrator) return AUTHORITY_LABEL.administrator
  return m.canManagePermissions ? AUTHORITY_LABEL.delegate : AUTHORITY_LABEL.member
}

function confirmText(p: Pending, oscName: string): string {
  const who = nameOf(p.member)
  const perm = p.permission ? permissionLabel(p.permission) : ''
  switch (p.action) {
    case 'grant-permission':
      return `Conceder a permissão “${perm}” a ${who}, com efeito em todas as parcerias da ${oscName}?`
    case 'revoke-permission':
      return `Revogar a permissão “${perm}” de ${who}, com efeito em todas as parcerias da ${oscName}?`
    case 'grant-delegation':
      return `Conceder a ${who} a delegação para gerir permissões da ${oscName}?`
    case 'revoke-delegation':
      return `Revogar a delegação de ${who} para gerir permissões da ${oscName}?`
  }
}

function resultText(p: Pending, changed: boolean): string {
  if (!changed) return 'Nenhuma alteração necessária: a situação já estava registrada.'
  const who = nameOf(p.member)
  const perm = p.permission ? permissionLabel(p.permission) : ''
  switch (p.action) {
    case 'grant-permission':
      return `Permissão “${perm}” concedida a ${who}. Vale para todas as parcerias desta OSC.`
    case 'revoke-permission':
      return `Permissão “${perm}” revogada de ${who}. Vale para todas as parcerias desta OSC.`
    case 'grant-delegation':
      return `Delegação para gestão de permissões concedida a ${who}.`
    case 'revoke-delegation':
      return `Delegação para gestão de permissões revogada de ${who}.`
  }
}

interface Props {
  context: AuthorizationContext
  oscName: string
}

/**
 * PAG-OSC03 — Usuários e Permissões (layout HF-G05) com as operações REAIS da DEV-01.3.
 * A interface usa o avaliador de domínio apenas para decidir o que exibir; toda
 * operação é autorizada pelo servidor (/api/osc-permissions), que registra autoria
 * e auditoria. Nenhum sucesso é simulado.
 */
export function UsersPermissionsPage({ context, oscName }: Props) {
  const api = usePermissionsApi()
  const oscId = context.oscId
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const apply = useCallback((result: ApiResult<MemberDirectory>) => {
    setState(result.ok ? { status: 'ready', directory: result.data } : { status: 'error', error: result.error, reason: result.reason })
  }, [])

  useEffect(() => {
    let active = true
    void api.listMembers(oscId).then((result) => active && apply(result))
    return () => {
      active = false
    }
  }, [api, oscId, apply])

  const reload = async () => apply(await api.listMembers(oscId))

  async function confirm() {
    if (!pending) return
    setBusy(true)
    setMessage(null)
    const result = await api.mutate({ oscId, targetUid: pending.member.uid, action: pending.action, permission: pending.permission })
    setBusy(false)
    if (result.ok) {
      setMessage({ kind: 'success', text: resultText(pending, result.data.changed) })
      setPending(null)
      setMode(null)
      await reload()
    } else {
      setMessage({ kind: 'error', text: errorMessage(result.error, result.reason) })
      setPending(null)
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

  const viewer = context.organization && context.membership
    ? AUTHORITY_LABEL[context.organization.administratorUid === context.membership.uid ? 'administrator' : context.membership.canManagePermissions ? 'delegate' : 'member']
    : ''
  const contextBar = (
    <ContextBar
      oscName={oscName}
      partnership="Sem parceria selecionada"
      extra={
        <>
          {'  •  '}Usuário atual: <strong>{viewer}</strong>
        </>
      }
    />
  )

  if (state.status === 'loading') {
    return (
      <>
        {contextBar}
        <p className={ds.info} role="status" aria-busy="true">
          <InfoIcon />
          <span>Carregando usuários e permissões…</span>
        </p>
      </>
    )
  }

  if (state.status === 'error') {
    return (
      <>
        {contextBar}
        <div className={ds.stack}>
          <p className={ds.error} role="alert">
            {errorMessage(state.error, state.reason)}
          </p>
          {state.error === 'network' || state.error === 'unknown' ? (
            <span>
              <button type="button" className={ds.secondary} onClick={() => { setState({ status: 'loading' }); void reload() }}>
                Tentar novamente
              </button>
            </span>
          ) : null}
        </div>
      </>
    )
  }

  const { directory } = state
  const isAdmin = directory.viewerAuthority === 'administrator'
  const readOnly = directory.readOnly
  const allowed = (operation: Operation) => !readOnly && decide(context, operation).allowed
  const selected = directory.members.find((m) => m.uid === selectedUid) ?? null
  const canEditPermissions = !readOnly && directory.viewerAuthority !== 'member'
  const delegationAction: MutationAction | null = selected ? (selected.canManagePermissions ? 'revoke-delegation' : 'grant-delegation') : null
  const delegationAllowed = selected && delegationAction ? allowed({ kind: delegationAction, target: facts(selected) }) : false
  const selfSelected = selected?.uid === context.uid

  return (
    <>
      {contextBar}

      {message ? (
        <p className={message.kind === 'success' ? ds.success : ds.error} role={message.kind === 'success' ? 'status' : 'alert'}>
          {message.kind === 'success' ? <CheckIcon size={16} /> : null}
          <span>{message.text}</span>
        </p>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <section className={ds.cardFlush} style={{ flex: '3 1 480px' }} aria-labelledby="osc03-usuarios">
          <div style={{ padding: '20px 20px 12px' }}>
            <h2 id="osc03-usuarios" className={ds.sectionTitle}>
              Usuários vinculados
            </h2>
            <p className={ds.muted}>Permissões operacionais individuais, aplicadas a todas as parcerias desta OSC.</p>
          </div>
          <div className={ds.tableScroll}>
            <table className={ds.table}>
              <thead>
                <tr>
                  <th scope="col">Usuário</th>
                  <th scope="col">Vínculo / função</th>
                  <th scope="col">Permissões</th>
                </tr>
              </thead>
              <tbody>
                {directory.members.map((member) => {
                  const isSelected = member.uid === selectedUid
                  const self = member.uid === context.uid
                  return (
                    <tr key={member.uid} className={isSelected ? ds.rowSelected : undefined}>
                      <td>
                        <button
                          type="button"
                          className={ds.userLink}
                          aria-pressed={isSelected}
                          onClick={() => { setSelectedUid(member.uid); setPending(null); setMessage(null) }}
                        >
                          {nameOf(member)}
                          {self ? ' (você)' : ''}
                        </button>
                      </td>
                      <td>
                        {member.isAdministrator && member.status === 'active' ? (
                          <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <UsersIcon size={16} />
                            {roleOf(member)}
                          </strong>
                        ) : (
                          roleOf(member)
                        )}
                      </td>
                      <td>{member.permissions.length > 0 ? `Individuais (${member.permissions.length})` : 'Nenhuma'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className={ds.card} style={{ flex: '1 1 260px', gap: 12 }} aria-labelledby="osc03-acoes">
          <h2 id="osc03-acoes" className={ds.cardTitle}>
            Ações autorizadas
          </h2>
          {readOnly ? (
            <p className={ds.muted}>Somente consulta durante a suspensão comercial.</p>
          ) : (
            <>
              {(['grant', 'revoke'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`${mode === m ? ds.primaryActive : ds.secondary} ${ds.blockLeft}`}
                  aria-pressed={mode === m}
                  disabled={!canEditPermissions || busy}
                  onClick={() => { setMode(mode === m ? null : m); setPending(null); setMessage(null) }}
                >
                  {mode === m ? <CheckIcon size={14} /> : null}
                  {m === 'grant' ? 'Conceder permissão' : 'Revogar permissão'}
                </button>
              ))}
              {isAdmin ? (
                <button
                  type="button"
                  className={`${ds.secondary} ${ds.blockLeft}`}
                  disabled={!delegationAllowed || busy || pending !== null}
                  onClick={() => selected && delegationAction && (setMessage(null), setPending({ action: delegationAction, member: selected }))}
                >
                  {selected?.canManagePermissions ? 'Revogar delegação' : 'Conceder delegação'}
                </button>
              ) : null}
            </>
          )}
          {isAdmin ? (
            <button type="button" className={`${ds.secondary} ${ds.blockLeft}`} onClick={() => exportCsv(directory)}>
              Exportar relação (CSV)
            </button>
          ) : null}
          <p className={ds.meta}>
            {isAdmin
              ? 'Convite e desvinculação de usuários aguardam implementação.'
              : 'Convidar e desvincular usuários são ações do administrador único; delegações também.'}
          </p>
        </section>
      </div>

      {selected ? (
        <section className={ds.card} aria-labelledby="osc03-consultado" style={{ gap: 12 }}>
          <h2 id="osc03-consultado" className={ds.sectionTitle}>
            Usuário consultado: {nameOf(selected)} · {roleOf(selected)}
          </h2>
          {selfSelected ? (
            <p className={ds.info}>
              <InfoIcon />
              <span>{DENIAL_MESSAGE['self-modification']}</span>
            </p>
          ) : null}
          {pending ? (
            <div className={ds.stack}>
              <strong>Passo 3 de 3: confirme a operação.</strong>
              <div className={ds.warning} role="alertdialog" aria-label="Confirmar operação" aria-describedby="osc03-confirmacao" style={{ flexDirection: 'column' }}>
                <span id="osc03-confirmacao">{confirmText(pending, oscName)}</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button type="button" className={ds.linkButton} disabled={busy} onClick={() => setPending(null)}>
                    Cancelar
                  </button>
                  <button type="button" className={ds.primary} autoFocus disabled={busy} onClick={() => void confirm()}>
                    {busy ? 'Enviando…' : 'Confirmar'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <strong>
              {readOnly
                ? 'Somente consulta.'
                : mode
                  ? `Passo 2 de 3: escolha a permissão a ${mode === 'grant' ? 'conceder' : 'revogar'}.`
                  : 'Passo 1 de 3 concluído: usuário identificado. Escolha “Conceder permissão” ou “Revogar permissão” em Ações autorizadas.'}
            </strong>
          )}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label={`Permissões de ${nameOf(selected)}`}>
            {GRANTABLE_PERMISSIONS.map((permission) => {
              const granted = selected.permissions.includes(permission)
              const action: MutationAction = granted ? 'revoke-permission' : 'grant-permission'
              const showAction =
                !pending && mode !== null && (mode === 'grant') !== granted && allowed({ kind: action, target: facts(selected), permission })
              return (
                <li key={permission} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, minHeight: 52, padding: '4px 0', borderTop: '1px solid var(--ds-border-subtle)' }}>
                  <span style={{ flex: '1 1 220px' }}>{permissionLabel(permission)}</span>
                  {granted ? (
                    <span className={ds.badgeGranted}><CheckIcon />Concedida</span>
                  ) : (
                    <span className={ds.badgeNotGranted}><MinusIcon />Não concedida</span>
                  )}
                  <span style={{ flex: '0 0 140px', display: 'flex' }}>
                    {showAction ? (
                      <button
                        type="button"
                        className={ds.secondary}
                        style={{ width: '100%' }}
                        aria-label={`${granted ? 'Revogar' : 'Conceder'} ${permissionLabel(permission)} — ${nameOf(selected)}`}
                        onClick={() => { setMessage(null); setPending({ action, member: selected, permission }) }}
                      >
                        {granted ? 'Revogar' : 'Conceder'}
                      </button>
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ) : (
        <p className={ds.info}>
          <InfoIcon />
          <span>Consulte um usuário na lista para continuar.</span>
        </p>
      )}

      <section className={ds.card} aria-labelledby="osc03-regras" style={{ gap: 8 }}>
        <h2 id="osc03-regras" className={ds.cardTitle}>
          Regras de competência e permissões
        </h2>
        <p style={{ margin: 0 }}>
          Administrador único: concede e revoga permissões operacionais e a delegação; não possui permissões operacionais implícitas.
        </p>
        <p style={{ margin: 0 }}>
          Delegado: somente concede e revoga permissões operacionais de outros usuários; não altera as próprias permissões nem as do administrador, e não cria delegações.
        </p>
        <p style={{ margin: 0 }}>Nenhum usuário altera as próprias permissões. Durante a suspensão comercial, as alterações ficam bloqueadas.</p>
      </section>
    </>
  )
}
