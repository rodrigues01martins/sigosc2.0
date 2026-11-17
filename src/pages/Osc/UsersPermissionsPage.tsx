import { useState } from 'react'
import { CheckIcon, InfoIcon, LayersIcon, UsersIcon } from '../../components/ds/icons.tsx'
import ds from '../../components/ds/ds.module.css'
import { ContextBar } from '../../components/osc/ContextBar.tsx'
import { GRANTABLE_PERMISSIONS, type AuthorizationContext, type GrantablePermissionId } from '../../domain/authorization.ts'
import { decide, usePermissionsApi } from '../../hooks/useAuthorization.ts'
import { useMediaQuery } from '../../hooks/useMediaQuery.ts'
import type { ManagedMember, MemberDirectory, MutationAction } from '../../services/permissions/permissionsApi.ts'
import { directoryToCsv } from '../Permissions/exportCsv.ts'
import { AUTHORITY_LABEL } from './oscLabels.ts'
import { nameOf } from './permissions/matrixHelpers.ts'
import { PermissionCards } from './permissions/PermissionCards.tsx'
import { PermissionMatrix } from './permissions/PermissionMatrix.tsx'
import matrixStyles from './permissions/PermissionMatrix.module.css'
import { usePermissionDirectory } from './permissions/usePermissionDirectory.ts'

/** Abaixo desta largura a matriz vira cartões por usuário (UX-001). */
const COMPACT_QUERY = '(max-width: 719px)'

interface Props {
  context: AuthorizationContext
  oscName: string
}

interface DelegationRequest {
  member: ManagedMember
  action: MutationAction
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

/**
 * PAG-OSC03 — Usuários e Permissões (UX-001): matriz usuários × permissões com
 * alteração direta por célula. Permissões operacionais: um clique, sem confirmação;
 * delegação: confirmação explícita. Toda operação é decidida pelo servidor
 * (/api/osc-permissions), que registra autoria e auditoria.
 */
export function UsersPermissionsPage({ context, oscName }: Props) {
  const api = usePermissionsApi()
  const { load, pending, failed, feedback, mutate, retryLoad } = usePermissionDirectory(api, context.oscId)
  const compact = useMediaQuery(COMPACT_QUERY)
  const [query, setQuery] = useState('')
  const [delegation, setDelegation] = useState<DelegationRequest | null>(null)

  const viewerAuthority = decide(context, { kind: 'view-own-permissions' })
  const contextBar = (
    <ContextBar
      oscName={oscName}
      partnership="Sem parceria selecionada"
      extra={
        <>
          {'  •  '}Usuário atual: <strong>{viewerAuthority.allowed ? AUTHORITY_LABEL[viewerAuthority.authority] : ''}</strong>
        </>
      }
    />
  )

  if (load.status === 'loading') {
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

  if (load.status === 'error') {
    const retry = load.error !== 'session-expired' && load.error !== 'forbidden'
    return (
      <>
        {contextBar}
        <div className={ds.stack}>
          <p className={ds.error} role="alert">
            {load.message}
          </p>
          {retry ? (
            <span>
              <button type="button" className={ds.secondary} onClick={retryLoad}>
                Tentar novamente
              </button>
            </span>
          ) : null}
        </div>
      </>
    )
  }

  const { directory } = load
  const isAdmin = directory.viewerAuthority === 'administrator'
  const normalized = query.trim().toLocaleLowerCase('pt-BR')
  const members = normalized
    ? directory.members.filter((m) => nameOf(m).toLocaleLowerCase('pt-BR').includes(normalized))
    : directory.members

  const onToggle = (member: ManagedMember, permission: GrantablePermissionId, action: MutationAction) => {
    void mutate(member, action, permission)
  }
  const onDelegation = (member: ManagedMember, action: MutationAction) => setDelegation({ member, action })

  async function confirmDelegation() {
    if (!delegation) return
    const request = delegation
    setDelegation(null)
    await mutate(request.member, request.action)
  }

  const matrixProps = {
    context,
    members,
    readOnly: directory.readOnly,
    showDelegation: isAdmin,
    pending,
    failed,
    onToggle,
    onDelegation,
    oscName,
  }

  let body
  if (directory.members.length === 0) {
    body = (
      <div className={ds.empty}>
        <span className={ds.emptyIcon}>
          <UsersIcon size={28} />
        </span>
        <div className={ds.stack}>
          <h3 className={ds.cardTitle}>Não há vínculos para exibição</h3>
          <p className={ds.muted}>
            Esta OSC ainda não possui usuários vinculados. A inclusão de usuários é realizada pela administração da
            plataforma.
          </p>
        </div>
      </div>
    )
  } else if (GRANTABLE_PERMISSIONS.length === 0) {
    body = (
      <div className={ds.empty}>
        <span className={ds.emptyIcon}>
          <LayersIcon size={28} />
        </span>
        <div className={ds.stack}>
          <h3 className={ds.cardTitle}>Nenhuma permissão disponível</h3>
          <p className={ds.muted}>Nenhuma permissão operacional está disponível para configuração.</p>
        </div>
      </div>
    )
  } else if (members.length === 0) {
    body = <p className={ds.info}><InfoIcon /><span>Nenhum usuário corresponde à pesquisa.</span></p>
  } else {
    body = compact ? <PermissionCards {...matrixProps} /> : <PermissionMatrix {...matrixProps} />
  }

  return (
    <>
      {contextBar}

      <section className={ds.card} aria-labelledby="osc03-matriz" style={{ gap: 16 }}>
        <div className={ds.stack}>
          <h2 id="osc03-matriz" className={ds.sectionTitle}>
            Usuários e permissões
          </h2>
          <p className={ds.muted}>
            {directory.readOnly
              ? 'Somente consulta e exportação durante a suspensão comercial.'
              : 'Acione a permissão desejada para conceder ou revogar. As permissões valem para todas as parcerias desta OSC.'}
          </p>
        </div>

        <div className={matrixStyles.toolbar}>
          <div className={matrixStyles.search}>
            <label className={ds.fieldLabel} htmlFor="osc03-pesquisa">
              Pesquisar usuário
            </label>
            <input
              id="osc03-pesquisa"
              className={matrixStyles.searchInput}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nome ou e-mail"
              autoComplete="off"
            />
          </div>
          {isAdmin ? (
            <button type="button" className={ds.secondary} onClick={() => exportCsv(directory)}>
              Exportar relação (CSV)
            </button>
          ) : null}
        </div>

        {feedback ? (
          <p
            key={feedback.id}
            className={feedback.kind === 'success' ? ds.success : ds.error}
            role={feedback.kind === 'success' ? 'status' : 'alert'}
          >
            {feedback.kind === 'success' ? <CheckIcon size={16} /> : null}
            <span>{feedback.text}</span>
          </p>
        ) : null}

        {delegation ? (
          <div className={ds.warning} role="alertdialog" aria-labelledby="osc03-delegacao-titulo" aria-describedby="osc03-delegacao-texto" style={{ flexDirection: 'column' }}>
            <strong id="osc03-delegacao-titulo">
              {delegation.action === 'grant-delegation' ? 'Confirmar concessão de delegação' : 'Confirmar revogação de delegação'}
            </strong>
            <span id="osc03-delegacao-texto">
              {delegation.action === 'grant-delegation'
                ? `Conceder a ${nameOf(delegation.member)} a delegação para gerir permissões da ${oscName}? O usuário passará a conceder e revogar permissões operacionais de outros usuários desta OSC; não poderá criar delegações nem alterar o administrador único.`
                : `Revogar a delegação de ${nameOf(delegation.member)} na ${oscName}? O usuário deixará de gerir permissões desta OSC; as permissões operacionais dele não serão alteradas.`}
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" className={ds.linkButton} onClick={() => setDelegation(null)}>
                Cancelar
              </button>
              <button type="button" className={ds.primary} autoFocus onClick={() => void confirmDelegation()}>
                {delegation.action === 'grant-delegation' ? 'Conceder delegação' : 'Revogar delegação'}
              </button>
            </div>
          </div>
        ) : null}

        {body}

        <p className={ds.meta}>
          {isAdmin
            ? 'Convite e desvinculação de usuários aguardam implementação.'
            : 'Convidar e desvincular usuários e conceder delegações são ações do administrador único.'}
        </p>
      </section>

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
        <p style={{ margin: 0 }}>
          Nenhum usuário altera as próprias permissões. Durante a suspensão comercial, as alterações ficam bloqueadas. A decisão final de cada operação é do servidor.
        </p>
      </section>
    </>
  )
}
