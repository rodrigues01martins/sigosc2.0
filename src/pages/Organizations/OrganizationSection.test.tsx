/**
 * Testes de interface do contexto organizacional (DEV-01.2) — Vitest + jsdom.
 * Auth e Firestore SIMULADOS (dados fictícios, sem rede). A segurança real é
 * verificada nos emuladores (`npm run test:rules`).
 */
import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeAuthSdk } from '../../../tests/support/fakeAuthSdk.ts'
import { createFakeOrganizationsSdk, firestoreError } from '../../../tests/support/fakeOrganizationsSdk.ts'
import { OSCS, USERS } from '../../../tests/support/organizationFixtures.ts'
import { AuthGate } from '../../components/AuthGate.tsx'
import { AuthProvider } from '../../components/AuthProvider.tsx'
import { OrganizationProvider } from '../../components/OrganizationProvider.tsx'
import { createAuthService } from '../../services/auth/authService.ts'
import { createAuthStore } from '../../services/auth/authStore.ts'
import { createOrganizationService } from '../../services/organizations/organizationService.ts'
import { createOrganizationStore } from '../../services/organizations/organizationStore.ts'
import { createMemorySelectionStorage } from '../../services/organizations/selectionStorage.ts'

afterEach(cleanup)

type User = (typeof USERS)[keyof typeof USERS]

function renderSession(user: User, { storage = createMemorySelectionStorage(), prepare }: {
  storage?: ReturnType<typeof createMemorySelectionStorage>
  prepare?: (db: ReturnType<typeof createFakeOrganizationsSdk>) => void
} = {}) {
  const fakeAuth = createFakeAuthSdk({ accounts: Object.values(USERS).map((u) => ({ ...u })), persistedUser: { ...user } })
  const service = createAuthService(fakeAuth.auth, fakeAuth.sdk)
  const authStore = createAuthStore(service)
  const fakeDb = createFakeOrganizationsSdk()
  prepare?.(fakeDb)
  const organizationStore = createOrganizationStore({
    authStore,
    service: createOrganizationService(fakeDb.db, fakeDb.sdk),
    selectionStorage: storage,
  })
  const view = render(
    <StrictMode>
      <AuthProvider value={{ store: authStore, service }}>
        <OrganizationProvider store={organizationStore}>
          <AuthGate environment="test" />
        </OrganizationProvider>
      </AuthProvider>
    </StrictMode>,
  )
  return { view, fakeDb, fakeAuth, storage, organizationStore }
}

const list = () => screen.findByRole('list', { name: 'OSCs vinculadas' })
const activePanelText = () => document.querySelector('[aria-live="polite"]')?.textContent ?? ''

describe('Seleção da OSC ativa', () => {
  it('U01 — usuário com uma OSC ativa: selecionada automaticamente', async () => {
    renderSession(USERS.SINGLE)
    await list()
    expect(activePanelText()).toContain(OSCS.GAMA.name)
    expect(activePanelText()).toContain('Você é o administrador designado desta OSC')
    expect(screen.getByText('✓ OSC ativa')).toBeTruthy()
    expect(screen.getByText(USERS.SINGLE.email)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy()
    expect(screen.getByText(/Interface técnica provisória para validação da arquitetura/)).toBeTruthy()
  })

  it('U02/U04 — várias OSCs: lista apenas vínculos próprios; inativos e não ativadas sem botão', async () => {
    renderSession(USERS.MULTI)
    const items = within(await list()).getAllByRole('listitem').filter((li) => li.parentElement?.getAttribute('aria-label') === 'OSCs vinculadas')
    expect(items).toHaveLength(4)
    expect(activePanelText()).toContain('Nenhuma OSC selecionada')
    expect(screen.getByRole('button', { name: `Selecionar ${OSCS.ALFA.name}` })).toBeTruthy()
    expect(screen.getByRole('button', { name: `Selecionar ${OSCS.BETA.name}` })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Selecionar .*Delta/ })).toBeNull()
    expect(screen.getByText('OSC ainda não ativada pela administração da plataforma.')).toBeTruthy()
    // Vínculo inativo: sem nome nem dados da OSC; apenas identificador e situação.
    expect(screen.getByText('Vínculo inativo — não pode ser selecionada.')).toBeTruthy()
    expect(screen.getByText(`Identificador: ${OSCS.GAMA.id}`)).toBeTruthy()
    expect(document.body.textContent).not.toContain(OSCS.GAMA.name)
    expect(screen.getAllByText('Administrador da OSC')).toHaveLength(1)
  })

  it('U05 — troca de OSC atualiza o contexto e remonta a área da OSC anterior', async () => {
    const { fakeDb } = renderSession(USERS.MULTI)
    await list()
    fireEvent.click(screen.getByRole('button', { name: `Selecionar ${OSCS.ALFA.name}` }))
    await waitFor(() => expect(activePanelText()).toContain(OSCS.ALFA.name))
    const alfaNode = screen.getByText(OSCS.ALFA.name, { selector: 'p[class*="activeName"]' })

    fireEvent.click(screen.getByRole('button', { name: `Selecionar ${OSCS.BETA.name}` }))
    await waitFor(() => expect(activePanelText()).toContain(OSCS.BETA.name))
    expect(activePanelText()).not.toContain(OSCS.ALFA.name)
    expect(alfaNode.isConnected).toBe(false)
    expect(fakeDb.calls).toContain(`getMembership:osc-beta/${USERS.MULTI.uid}`)
    expect(screen.getByRole('listitem', { current: true }).textContent).toContain(OSCS.BETA.name)
  })

  it('U03 — sem vínculos: orientação institucional, sem cadastro público', async () => {
    renderSession(USERS.NONE)
    expect(await screen.findByText(/ainda não possui vínculo organizacional autorizado/)).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'OSCs vinculadas' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/cadastrar|criar (conta|osc)|solicitar acesso/i)
    for (const osc of Object.values(OSCS)) expect(document.body.textContent).not.toContain(osc.name)
  })

  it('U06 — logout limpa o contexto e a seleção guardada', async () => {
    const { storage, organizationStore } = renderSession(USERS.SINGLE)
    await list()
    expect(storage.entries()).toEqual({ [USERS.SINGLE.uid]: OSCS.GAMA.id })
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
    await screen.findByRole('button', { name: 'Entrar' })
    expect(storage.entries()).toEqual({})
    expect(organizationStore.getSnapshot()).toEqual({ status: 'signed-out' })
    expect(document.body.textContent).not.toContain(OSCS.GAMA.name)
  })

  it('U07 — sessão restaurada reutiliza a OSC guardada somente após revalidação', async () => {
    const storage = createMemorySelectionStorage()
    storage.write(USERS.MULTI.uid, OSCS.BETA.id)
    const { fakeDb } = renderSession(USERS.MULTI, { storage })
    await list()
    expect(activePanelText()).toContain(OSCS.BETA.name)
    expect(fakeDb.calls[0]).toBe(`listMembershipsByUid:${USERS.MULTI.uid}`)
    cleanup()

    const forged = createMemorySelectionStorage()
    forged.write(USERS.MULTI.uid, OSCS.GAMA.id) // vínculo inativo
    renderSession(USERS.MULTI, { storage: forged })
    await list()
    expect(activePanelText()).toContain('Nenhuma OSC selecionada')
  })
})

describe('Falhas e segurança', () => {
  it('falha de rede: mensagem segura e nova tentativa bem-sucedida', async () => {
    const { fakeDb } = renderSession(USERS.SINGLE, { prepare: (db) => db.fail('listMembershipsByUid', firestoreError('unavailable', 'segredo projeto-x')) })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Falha de conexão/)
    expect(document.body.textContent).not.toContain('projeto-x')
    fakeDb.recover()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => expect(activePanelText()).toContain(OSCS.GAMA.name))
  })

  it('regras ainda não publicadas (permission-denied): mensagem segura, sem dados', async () => {
    renderSession(USERS.MULTI, { prepare: (db) => db.fail('listMembershipsByUid', firestoreError('permission-denied', 'Missing or insufficient permissions.')) })
    expect((await screen.findByRole('alert')).textContent).toMatch(/acesso foi negado pelas regras de segurança/)
    expect(document.body.textContent).not.toMatch(/Missing or insufficient/)
    expect(screen.queryByRole('list', { name: 'OSCs vinculadas' })).toBeNull()
  })

  it('falha ao revalidar na troca mantém a OSC atual e informa o erro', async () => {
    const { fakeDb } = renderSession(USERS.MULTI)
    await list()
    fireEvent.click(screen.getByRole('button', { name: `Selecionar ${OSCS.ALFA.name}` }))
    await waitFor(() => expect(activePanelText()).toContain(OSCS.ALFA.name))
    fakeDb.fail('getMembership', firestoreError('unavailable'))
    fireEvent.click(screen.getByRole('button', { name: `Selecionar ${OSCS.BETA.name}` }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Falha de conexão/)
    expect(activePanelText()).toContain(OSCS.ALFA.name)
  })

  it('acessibilidade básica: seção rotulada, botões nomeados, OSC ativa com aria-current', async () => {
    renderSession(USERS.SINGLE)
    await list()
    expect(screen.getByRole('region', { name: 'Organizações' })).toBeTruthy()
    expect(screen.getByRole('listitem', { current: true })).toBeTruthy()
    for (const button of screen.getAllByRole('button')) expect(button.textContent?.trim() || button.getAttribute('aria-label')).toBeTruthy()
  })
})
