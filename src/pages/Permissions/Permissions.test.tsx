/**
 * Testes de interface da gestão de permissões (DEV-01.3) — Vitest + jsdom.
 * Auth, Firestore e servidor de permissões SIMULADOS (sem rede, dados fictícios).
 * O servidor real é verificado em `npm run test:server` (Admin SDK + emuladores).
 */
import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeAuthSdk } from '../../../tests/support/fakeAuthSdk.ts'
import { createFakeOrganizationsSdk } from '../../../tests/support/fakeOrganizationsSdk.ts'
import { createFakePermissionsServer, type FakeServerMember } from '../../../tests/support/fakePermissionsServer.ts'
import { MEMBERS, OSCS, USERS, memberDocument, memberPath } from '../../../tests/support/organizationFixtures.ts'
import { PERMISSION_MEMBERS, PERMISSION_USERS } from '../../../tests/support/permissionFixtures.ts'
import { AuthGate } from '../../components/AuthGate.tsx'
import { AuthProvider } from '../../components/AuthProvider.tsx'
import { OrganizationProvider } from '../../components/OrganizationProvider.tsx'
import { PermissionsApiProvider } from '../../components/PermissionsApiProvider.tsx'
import { sanitizePermissions } from '../../domain/authorization.ts'
import { createAuthService } from '../../services/auth/authService.ts'
import { createAuthStore } from '../../services/auth/authStore.ts'
import { createOrganizationService } from '../../services/organizations/organizationService.ts'
import { createOrganizationStore } from '../../services/organizations/organizationStore.ts'
import { createMemorySelectionStorage } from '../../services/organizations/selectionStorage.ts'
import { directoryToCsv } from './exportCsv.ts'

afterEach(cleanup)

const ALL_USERS = { ...USERS, ...PERMISSION_USERS }
type User = (typeof ALL_USERS)[keyof typeof ALL_USERS]
const ALL_MEMBERS = [...MEMBERS, ...PERMISSION_MEMBERS]

function renderAs(user: User, { suspendAlfa = false, forge }: { suspendAlfa?: boolean; forge?: Record<string, unknown> } = {}) {
  const fakeAuth = createFakeAuthSdk({ accounts: Object.values(ALL_USERS).map((u) => ({ ...u })), persistedUser: { ...user } })
  const authService = createAuthService(fakeAuth.auth, fakeAuth.sdk)
  const authStore = createAuthStore(authService)
  // "Firestore" visto pelo navegador (pode ser manipulado: `forge`).
  const fakeDb = createFakeOrganizationsSdk()
  for (const m of PERMISSION_MEMBERS) fakeDb.docs.set(memberPath(m), memberDocument(m))
  if (suspendAlfa) fakeDb.docs.set('oscs/osc-alfa', { ...fakeDb.docs.get('oscs/osc-alfa'), commercialStatus: 'suspended' })
  if (forge) fakeDb.docs.set(memberPath({ oscId: OSCS.ALFA.id, uid: user.uid }), { ...fakeDb.docs.get(memberPath({ oscId: OSCS.ALFA.id, uid: user.uid })), ...forge })
  // Verdade do servidor (independente do navegador).
  const server = createFakePermissionsServer(
    Object.values(OSCS).map((o) => ({ ...o, commercialStatus: suspendAlfa && o.id === 'osc-alfa' ? 'suspended' : o.commercialStatus })),
    Object.fromEntries(
      Object.values(OSCS).map((o) => [
        o.id,
        ALL_MEMBERS.filter((m) => m.oscId === o.id).map(
          (m): FakeServerMember => ({
            uid: m.uid,
            status: m.status,
            email: Object.values(ALL_USERS).find((u) => u.uid === m.uid)?.email ?? null,
            permissions: sanitizePermissions('permissions' in m ? m.permissions : []),
            canManagePermissions: 'canManagePermissions' in m && m.canManagePermissions === true,
          }),
        ),
      ]),
    ),
  )
  const organizationStore = createOrganizationStore({
    authStore,
    service: createOrganizationService(fakeDb.db, fakeDb.sdk),
    selectionStorage: createMemorySelectionStorage(),
  })
  const api = server.apiFor(() => {
    const state = authStore.getSnapshot()
    return state.status === 'authenticated' ? state.user.uid : null
  })
  render(
    <StrictMode>
      <AuthProvider value={{ store: authStore, service: authService }}>
        <OrganizationProvider store={organizationStore}>
          <PermissionsApiProvider api={api}>
            <AuthGate environment="test" />
          </PermissionsApiProvider>
        </OrganizationProvider>
      </AuthProvider>
    </StrictMode>,
  )
  return { server }
}

async function selectAlfa() {
  fireEvent.click(await screen.findByRole('button', { name: `Selecionar ${OSCS.ALFA.name}` }))
  return screen.findByRole('region', { name: 'Permissões nesta OSC' })
}
const openManager = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Gerenciar permissões da OSC' }))
  return screen.findByRole('list', { name: 'Usuários vinculados' })
}
const memberCard = (list: HTMLElement, text: string) => within(list).getByText(text, { exact: false }).closest('li') as HTMLElement

describe('Administrador único', () => {
  it('concede e revoga permissão com confirmação; resultado vem do servidor', async () => {
    const { server } = renderAs(USERS.MULTI)
    const panel = await selectAlfa()
    expect(within(panel).getByText('Administrador designado da OSC')).toBeTruthy()
    expect(within(panel).getByText('Nenhuma permissão operacional concedida.')).toBeTruthy()
    const list = await openManager()
    expect(within(list).getAllByRole('listitem', { name: undefined }).filter((li) => li.parentElement === list)).toHaveLength(4)

    fireEvent.click(within(list).getByRole('button', { name: `Conceder Consultar documentos — ${PERMISSION_USERS.OPERATOR.email}` }))
    const dialog = screen.getByRole('alertdialog', { name: 'Confirmar operação' })
    expect(dialog.textContent).toContain(`Conceder a permissão "Consultar documentos" para ${PERMISSION_USERS.OPERATOR.email}?`)
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Confirmar'))
    expect(server.calls.filter((c) => c.startsWith('grant'))).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('Alteração registrada pelo servidor.')).toBeTruthy()
    await waitFor(() => {
      const card = memberCard(screen.getByRole('list', { name: 'Usuários vinculados' }), PERMISSION_USERS.OPERATOR.email)
      expect(within(card).getByRole('button', { name: `Revogar Consultar documentos — ${PERMISSION_USERS.OPERATOR.email}` })).toBeTruthy()
    })
    expect(server.truth.get('osc-alfa')?.get(PERMISSION_USERS.OPERATOR.uid)?.permissions).toContain('documents.view')

    fireEvent.click(screen.getByRole('button', { name: `Revogar Consultar documentos — ${PERMISSION_USERS.OPERATOR.email}` }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(server.truth.get('osc-alfa')?.get(PERMISSION_USERS.OPERATOR.uid)?.permissions).not.toContain('documents.view'))
  })

  it('cancelar a confirmação não envia nada; delegação somente pelo administrador; sem controles sobre si', async () => {
    const { server } = renderAs(USERS.MULTI)
    await selectAlfa()
    const list = await openManager()
    fireEvent.click(within(list).getByRole('button', { name: `Conceder delegação — ${PERMISSION_USERS.OPERATOR.email}` }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(server.calls.some((c) => c.startsWith('grant-delegation'))).toBe(false)

    fireEvent.click(within(list).getByRole('button', { name: `Conceder delegação — ${PERMISSION_USERS.OPERATOR.email}` }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(server.truth.get('osc-alfa')?.get(PERMISSION_USERS.OPERATOR.uid)?.canManagePermissions).toBe(true))
    // Próprio cartão: nenhum controle.
    const self = memberCard(screen.getByRole('list', { name: 'Usuários vinculados' }), `${USERS.MULTI.email} (você)`)
    expect(within(self).queryAllByRole('button')).toHaveLength(0)
    // Ex-membro (inativo): pode revogar, não pode conceder nem delegar.
    const former = memberCard(screen.getByRole('list', { name: 'Usuários vinculados' }), PERMISSION_USERS.FORMER.email)
    expect(within(former).getByRole('button', { name: `Revogar Consultar documentos — ${PERMISSION_USERS.FORMER.email}` })).toBeTruthy()
    expect(within(former).queryByRole('button', { name: /^Conceder/ })).toBeNull()
  })
})

describe('Delegado e usuário operacional', () => {
  it('delegado gere permissões de outros, sem delegação, sem si mesmo e sem o administrador', async () => {
    renderAs(PERMISSION_USERS.DELEGATE)
    const panel = await screen.findByRole('region', { name: 'Permissões nesta OSC' })
    expect(within(panel).getByText('Delegado para gestão de permissões')).toBeTruthy()
    const list = await openManager()
    expect(within(list).queryByRole('button', { name: /delegação/ })).toBeNull()
    expect(within(memberCard(list, `${PERMISSION_USERS.DELEGATE.email} (você)`)).queryAllByRole('button')).toHaveLength(0)
    expect(within(memberCard(list, USERS.MULTI.email)).queryAllByRole('button')).toHaveLength(0)
    expect(within(memberCard(list, PERMISSION_USERS.OPERATOR.email)).getAllByRole('button').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Exportar relação (CSV)' })).toBeNull()
  })

  it('usuário operacional vê só as próprias permissões e não acessa a gestão', async () => {
    renderAs(PERMISSION_USERS.OPERATOR)
    const panel = await screen.findByRole('region', { name: 'Permissões nesta OSC' })
    expect(within(panel).getByText('Usuário vinculado')).toBeTruthy()
    expect(within(panel).getByRole('list', { name: 'Gestão de parcerias' }).textContent).toContain('Consultar parcerias da OSC')
    expect(screen.queryByRole('button', { name: 'Gerenciar permissões da OSC' })).toBeNull()
    expect(document.body.textContent).not.toContain(PERMISSION_USERS.DELEGATE.email)
  })

  it('PER-18 — estado manipulado no navegador não concede autorização (servidor nega)', async () => {
    const { server } = renderAs(PERMISSION_USERS.OPERATOR, { forge: { canManagePermissions: true, permissions: ['admin', 'all', 'financial.view'] } })
    const panel = await screen.findByRole('region', { name: 'Permissões nesta OSC' })
    // A interface foi enganada e exibe a gestão...
    fireEvent.click(within(panel).getByRole('button', { name: 'Gerenciar permissões da OSC' }))
    // ...mas o servidor decide com a própria verdade.
    expect((await screen.findByRole('alert')).textContent).toContain('Acesso negado: Você não tem competência para gerir permissões nesta OSC.')
    // Somente consultas (o StrictMode repete o efeito em desenvolvimento); nenhuma alteração.
    expect(server.calls.length).toBeGreaterThan(0)
    expect(server.calls.every((c) => c === 'list:osc-alfa')).toBe(true)
    expect(screen.queryByRole('list', { name: 'Usuários vinculados' })).toBeNull()
    // Textos livres manipulados nunca aparecem como permissões.
    expect(within(panel).queryByText(/admin|all/)).toBeNull()
  })
})

describe('Suspensão comercial', () => {
  it('administrador: somente consulta e exportação; nenhum controle de alteração', async () => {
    renderAs(USERS.MULTI, { suspendAlfa: true })
    const panel = await selectAlfa()
    expect(within(panel).getByText(/consulta e exportação disponíveis/)).toBeTruthy()
    const list = await openManager()
    expect(screen.getByText('Somente consulta: alterações bloqueadas pela suspensão comercial.')).toBeTruthy()
    expect(within(list).queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Exportar relação (CSV)' })).toBeTruthy()
  })

  it('delegado: operação bloqueada, sem acesso à gestão', async () => {
    renderAs(PERMISSION_USERS.DELEGATE, { suspendAlfa: true })
    const panel = await screen.findByRole('region', { name: 'Permissões nesta OSC' })
    expect(within(panel).getByText('Situação comercial suspensa: as operações nesta OSC estão bloqueadas.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Gerenciar permissões da OSC' })).toBeNull()
  })
})

describe('Falhas, contexto e logout', () => {
  it('operações de servidor não publicadas: mensagem de indisponibilidade, nada simulado', async () => {
    const { server } = renderAs(USERS.MULTI)
    server.fail('unavailable')
    await selectAlfa()
    fireEvent.click(await screen.findByRole('button', { name: 'Gerenciar permissões da OSC' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/indisponível neste ambiente.*Nenhuma alteração foi realizada/)
  })

  it('falha de rede na alteração: erro informado e estado preservado', async () => {
    const { server } = renderAs(USERS.MULTI)
    await selectAlfa()
    const list = await openManager()
    server.fail('network')
    fireEvent.click(within(list).getByRole('button', { name: `Conceder Consultar documentos — ${PERMISSION_USERS.OPERATOR.email}` }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Falha de conexão')
    expect(within(memberCard(list, PERMISSION_USERS.OPERATOR.email)).getByRole('button', { name: `Conceder Consultar documentos — ${PERMISSION_USERS.OPERATOR.email}` })).toBeTruthy()
  })

  it('troca de OSC atualiza imediatamente o contexto de autorização', async () => {
    renderAs(USERS.MULTI)
    await selectAlfa()
    await openManager()
    fireEvent.click(screen.getByRole('button', { name: `Selecionar ${OSCS.BETA.name}` }))
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Permissões nesta OSC' })).getByText('Usuário vinculado')).toBeTruthy())
    expect(screen.queryByRole('list', { name: 'Usuários vinculados' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Gerenciar permissões da OSC' })).toBeNull()
  })

  it('logout remove a gestão e o contexto de autorização', async () => {
    renderAs(USERS.MULTI)
    await selectAlfa()
    await openManager()
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
    await screen.findByRole('button', { name: 'Entrar' })
    expect(screen.queryByRole('region', { name: 'Permissões nesta OSC' })).toBeNull()
    expect(document.body.textContent).not.toContain(PERMISSION_USERS.OPERATOR.email)
  })

  it('vínculo inativo: OSC não selecionável, sem painel de permissões', async () => {
    renderAs(USERS.MULTI)
    await screen.findByText(`Identificador: ${OSCS.GAMA.id}`)
    expect(screen.queryByRole('button', { name: /Gama/ })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Permissões nesta OSC' })).toBeNull()
  })
})

describe('Exportação CSV', () => {
  it('gera a relação e neutraliza fórmulas (injeção de CSV)', () => {
    const csv = directoryToCsv({
      oscId: 'osc-alfa', organizationName: 'x', commercialStatus: 'suspended', readOnly: true, viewerAuthority: 'administrator',
      members: [{ uid: 'u1', email: '=HYPERLINK("http://x")', status: 'active', isAdministrator: true, canManagePermissions: false, permissions: ['documents.view'] }],
    })
    const [header, row] = csv.split('\r\n')
    expect(header).toContain('"documents.view"')
    expect(row).toContain(`"'=HYPERLINK(""http://x"")"`)
    expect(row?.split(';').filter((c) => c === '"sim"')).toHaveLength(2)
  })
})
