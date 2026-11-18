import { useState, type ReactNode } from 'react'
import { LoadingState } from '../../components/LoadingState.tsx'
import ds from '../../components/ds/ds.module.css'
import { APP_INFO } from '../../config/app.ts'
import { useAuthActions, useAuthState } from '../../hooks/useAuth.ts'
import { authorizationContextFor, decide } from '../../hooks/useAuthorization.ts'
import { useOscRoute } from '../../hooks/useOscRoute.ts'
import { useActiveMembership, useOrganizationActions, useOrganizationState } from '../../hooks/useOrganization.ts'
import shellStyles from '../../layouts/OscShell.module.css'
import { OscShell } from '../../layouts/OscShell.tsx'
import { administrativeStatusLabel, partnershipTitle } from '../../domain/partnerships.ts'
import type { Partnership } from '../../services/partnerships/types.ts'
import { LOAD_ERROR_MESSAGE, SELECTION_ERROR_MESSAGE } from '../Organizations/labels.ts'
import { IdentificationPage } from './IdentificationPage.tsx'
import { PAGE_META } from './oscLabels.ts'
import { OscNavigation, OscSelector } from './OscSidebar.tsx'
import { NoMembershipState, NoSelectableState, SelectOscPrompt, SuspensionBlocked, SuspensionReadOnly } from './OscStates.tsx'
import { PartnershipIdentificationPage } from './partnerships/PartnershipIdentificationPage.tsx'
import { PartnershipsPage } from './partnerships/PartnershipsPage.tsx'
import { UsersPermissionsPage } from './UsersPermissionsPage.tsx'

/**
 * Gestão da OSC (DEV-01.4) — integra PAG-OSC01 a 03 ao layout homologado HF-G05,
 * reutilizando autenticação (DEV-01.1), contexto organizacional (DEV-01.2) e
 * permissões (DEV-01.3). Nenhuma decisão de autorização é delegada à navegação:
 * as páginas verificam a competência e o servidor/Security Rules decidem as operações.
 */
export function OscWorkspace({ environmentLabel }: { environmentLabel: string }) {
  const auth = useAuthState()
  const { signOut } = useAuthActions()
  const organizations = useOrganizationState()
  const { select, reload } = useOrganizationActions()
  const active = useActiveMembership()
  const [location, navigate] = useOscRoute()
  const { route } = location
  // DEV-02.1 — parceria selecionada (contexto de trabalho), SEMPRE vinculada à OSC em que foi escolhida.
  const [selection, setSelection] = useState<{ oscId: string; id: string; title: string; status: string } | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState(false)

  const user = auth.status === 'authenticated' ? auth.user : null
  const displayName = user?.email ?? 'Usuário autenticado'

  async function handleSignOut() {
    setSigningOut(true)
    setSignOutError(false)
    const result = await signOut()
    if (!result.ok) {
      setSigningOut(false)
      setSignOutError(true)
    }
  }

  const userArea = (
    <div className={shellStyles.user}>
      <span className={shellStyles.userName}>{displayName}</span>
      <span className={shellStyles.avatar} aria-hidden="true">
        {displayName.charAt(0)}
      </span>
      <button type="button" className={ds.secondary} onClick={() => void handleSignOut()} disabled={signingOut} aria-busy={signingOut}>
        {signingOut ? 'Saindo…' : 'Sair'}
      </button>
    </div>
  )

  let title = 'Gestão da OSC'
  let description: string | undefined
  let navigation: ReactNode = null
  let oscSelector: ReactNode = null
  let content: ReactNode

  switch (organizations.status) {
    case 'signed-out':
    case 'loading':
      content = <LoadingState label="Consultando seus vínculos organizacionais…" />
      break
    case 'unavailable':
      content = (
        <p className={ds.error} role="alert">
          Consulta de OSCs indisponível: a configuração do Firebase deste ambiente não é válida.
        </p>
      )
      break
    case 'error':
      content = (
        <div className={ds.stack}>
          <p className={ds.error} role="alert">
            {LOAD_ERROR_MESSAGE[organizations.error]}
          </p>
          <span>
            <button type="button" className={ds.secondary} onClick={() => void reload()}>
              Tentar novamente
            </button>
          </span>
        </div>
      )
      break
    case 'ready': {
      oscSelector = (
        <OscSelector
          memberships={organizations.memberships}
          activeOscId={organizations.activeOscId}
          pendingOscId={organizations.pendingOscId}
          onSelect={(oscId) => {
            // Troca de OSC: a parceria anterior é descartada e a navegação volta à lista (MT-3).
            setSelection(null)
            if (route === 'parceria') navigate('parcerias')
            void select(oscId)
          }}
        />
      )
      const selectable = organizations.memberships.filter((m) => m.selectable)
      if (organizations.memberships.length === 0) {
        content = <NoMembershipState />
      } else if (!active?.organization) {
        content = selectable.length > 0 ? <SelectOscPrompt /> : <NoSelectableState memberships={organizations.memberships} />
      } else {
        const context = authorizationContextFor(user?.uid ?? null, active)
        const own = decide(context, { kind: 'view-own-permissions' })
        const authority = own.allowed ? own.authority : 'member'
        const suspended = active.organization.commercialStatus === 'suspended'
        if (suspended && authority !== 'administrator') {
          content = <SuspensionBlocked key={active.oscId} oscName={active.organization.name} />
        } else {
          const canManage = decide(context, { kind: 'list-members' }).allowed
          // Seleção de outra OSC nunca é exibida nem reutilizada (isolamento Multi-Tenant).
          const selected = selection?.oscId === active.oscId ? selection : null
          const partnershipLabel = selected ? `Parceria: ${selected.title} · ${selected.status}` : 'Parceria: não selecionada'
          const choose = (p: Partnership) => {
            setSelection({ oscId: p.oscId, id: p.id, title: partnershipTitle(p), status: administrativeStatusLabel(p.administrativeStatus) })
            navigate('parceria', p.id)
          }
          navigation = (
            <OscNavigation route={route} canManagePermissions={canManage} selectedPartnershipId={selected?.id ?? null} onNavigate={navigate} />
          )
          title = PAGE_META[route].title
          description = PAGE_META[route].description
          const page =
            route === 'parcerias' ? (
              <PartnershipsPage
                context={context}
                oscName={active.organization.name}
                partnershipLabel={partnershipLabel}
                selectedId={selected?.id ?? null}
                onSelect={choose}
                onCreated={(id) => navigate('parceria', id)}
              />
            ) : route === 'parceria' ? (
              <PartnershipIdentificationPage
                key={location.partnershipId ?? ''}
                context={context}
                oscName={active.organization.name}
                partnershipId={location.partnershipId ?? ''}
                partnershipLabel={partnershipLabel}
                onResolved={(p) => {
                  if (selected?.id !== p.id || selected.status !== administrativeStatusLabel(p.administrativeStatus)) {
                    setSelection({ oscId: active.oscId, id: p.id, title: partnershipTitle(p), status: administrativeStatusLabel(p.administrativeStatus) })
                  }
                }}
                onNotFound={() => setSelection((current) => (current?.id === location.partnershipId ? null : current))}
                onBack={() => navigate('parcerias')}
              />
            ) : route === 'usuarios' ? (
              canManage ? (
                <UsersPermissionsPage context={context} oscName={active.organization.name} partnershipName={selected?.title ?? null} />
              ) : (
                <p className={ds.error} role="alert">
                  Acesso negado: você não tem competência para gerir permissões nesta OSC.
                </p>
              )
            ) : (
              <IdentificationPage
                membership={active}
                authority={authority}
                canManagePermissions={canManage}
                onConsultPartnerships={() => navigate('parcerias')}
                onUsersAndPermissions={() => navigate('usuarios')}
                partnershipLabel={partnershipLabel}
              />
            )
          // `key` = OSC ativa: a troca de contexto descarta todo o estado da OSC anterior (U05).
          content = (
            <div key={active.oscId} style={{ display: 'contents' }}>
              {suspended ? <SuspensionReadOnly /> : null}
              {page}
            </div>
          )
        }
      }
      if (organizations.selectionError) {
        content = (
          <>
            <p className={ds.error} role="alert">
              {SELECTION_ERROR_MESSAGE[organizations.selectionError]}
            </p>
            {content}
          </>
        )
      }
      break
    }
  }

  return (
    <OscShell
      title={title}
      pageKey={`${active?.oscId ?? 'nenhuma'}:${route}:${location.partnershipId ?? ''}`}
      description={description}
      oscSelector={oscSelector}
      navigation={navigation}
      userArea={userArea}
      footer={
        <>
          Ambiente: {environmentLabel}
          <br />
          Versão técnica — {APP_INFO.technicalVersion}
        </>
      }
    >
      {signOutError ? (
        <p className={ds.error} role="alert">
          Não foi possível encerrar a sessão. Tente novamente.
        </p>
      ) : null}
      {content}
    </OscShell>
  )
}
