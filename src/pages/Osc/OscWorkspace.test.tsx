/**
 * Testes de interface da Gestão da OSC (DEV-01.4) — Vitest + jsdom.
 *
 * Substituem os testes da interface técnica provisória (DEV-01.2 e DEV-01.3),
 * preservando os mesmos cenários (U01–U07, PER-18, suspensão, falhas, CSV) sobre
 * o layout homologado HF-G05 de PAG-OSC01 a 03, e acrescentam a navegação.
 * Auth, Firestore e servidor de permissões SIMULADOS (dados fictícios, sem rede).
 */
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeAuthSdk } from '../../../tests/support/fakeAuthSdk.ts'
import { createFakeOrganizationsSdk, firestoreError } from '../../../tests/support/fakeOrganizationsSdk.ts'
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
import { directoryToCsv } from '../Permissions/exportCsv.ts'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const ALL_USERS = { ...USERS, ...PERMISSION_USERS }
type User = (typeof ALL_USERS)[keyof typeof ALL_USERS]
const ALL_MEMBERS = [...MEMBERS, ...PERMISSION_MEMBERS]

interface Options {
  suspendAlfa?: boolean
  forge?: Record<string, unknown>
  storage?: ReturnType<typeof createMemorySelectionStorage>
  prepare?: (db: ReturnType<typeof createFakeOrganizationsSdk>) => void
}

function renderAs(user: User, { suspendAlfa = false, forge, storage = createMemorySelectionStorage(), prepare }: Options = {}) {
  const fakeAuth = createFakeAuthSdk({ accounts: Object.values(ALL_USERS).map((u) => ({ ...u })), persistedUser: { ...user } })
  const authService = createAuthService(fakeAuth.auth, fakeAuth.sdk)
  const authStore = createAuthStore(authService)
  const fakeDb = createFakeOrganizationsSdk()
  for (const m of PERMISSION_MEMBERS) fakeDb.docs.set(memberPath(m), memberDocument(m))
  if (suspendAlfa) fakeDb.docs.set('oscs/osc-alfa', { ...fakeDb.docs.get('oscs/osc-alfa'), commercialStatus: 'suspended' })
  if (forge) fakeDb.docs.set(memberPath({ oscId: OSCS.ALFA.id, uid: user.uid }), { ...fakeDb.docs.get(memberPath({ oscId: OSCS.ALFA.id, uid: user.uid })), ...forge })
  prepare?.(fakeDb)
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
  const organizationStore = createOrganizationStore({ authStore, service: createOrganizationService(fakeDb.db, fakeDb.sdk), selectionStorage: storage })
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
  return { server, fakeDb, storage, organizationStore }
}

const sidebar = () => screen.findByRole('navigation', { name: 'Navegação da Gestão da OSC' })
const title = () => screen.getByRole('heading', { level: 1 }).textContent
const contextText = () => screen.queryByLabelText('Contexto atual')?.textContent ?? ''
const selectOsc = async (oscId: string) => {
  fireEvent.change(await screen.findByLabelText('OSC selecionada'), { target: { value: oscId } })
  await waitFor(() => expect((screen.getByLabelText('OSC selecionada') as HTMLSelectElement).value).toBe(oscId))
  await waitFor(() => expect((screen.getByLabelText('OSC selecionada') as HTMLSelectElement).disabled).toBe(false))
}
const goTo = async (label: string) => {
  fireEvent.click(within(await sidebar()).getByRole('button', { name: label }))
  await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Navegação da Gestão da OSC' })).getByRole('button', { name: label }).getAttribute('aria-current')).toBe('page'))
}
const usersTable = () => screen.findByRole('table')
const row = (table: HTMLElement, text: string) => within(table).getByRole('button', { name: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).closest('tr') as HTMLElement

describe('Estrutura e navegação (layout HF-G05)', () => {
  it('U01 — uma OSC: seleção automática, PAG-OSC01 com dados reais e navegação com estado ativo', async () => {
    renderAs(USERS.SINGLE)
    const nav = await sidebar()
    await waitFor(() => expect(within(nav).getByText(OSCS.GAMA.name)).toBeTruthy())
    expect(within(nav).getByText('Vínculo único: selecionada automaticamente.')).toBeTruthy()
    expect(title()).toBe('Identificação da OSC')
    expect(within(nav).getByRole('button', { name: 'Identificação da OSC' }).getAttribute('aria-current')).toBe('page')
    expect(contextText()).toContain(`Contexto: ${OSCS.GAMA.name}`)
    expect(screen.getByText('OSC · Regular')).toBeTruthy()
    expect(screen.getByText('Ativa')).toBeTruthy()
    // Administrador único vem de administratorUid (SINGLE é o administrador da GAMA).
    expect(screen.getAllByText('Administrador único').length).toBeGreaterThan(0)
    expect(screen.getByText('Você')).toBeTruthy()
    expect(screen.getByText(USERS.SINGLE.email)).toBeTruthy()
    expect(within(nav).getByText(/Ambiente: Testes/)).toBeTruthy()
    // Nenhum dado fictício fixo de protótipo.
    expect(document.body.textContent).not.toMatch(/OSC Exemplo|00\.000\.000|parcerias cadastradas|Estrutura ilustrativa|WF-OSC/)
  })

  it('navegação: rota por fragmento, foco no título e ação "Consultar parcerias"', async () => {
    renderAs(USERS.SINGLE)
    await screen.findByText('OSC · Regular')
    fireEvent.click(screen.getByRole('button', { name: 'Consultar parcerias' }))
    await waitFor(() => expect(title()).toBe('Parcerias'))
    expect(window.location.hash).toBe('#/parcerias')
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H1'))
    await goTo('Identificação da OSC')
    expect(title()).toBe('Identificação da OSC')
  })

  it('U02/U04 — várias OSCs: escolha explícita apenas entre selecionáveis; inativos não aparecem como opção', async () => {
    renderAs(USERS.MULTI)
    const select = (await screen.findByLabelText('OSC selecionada')) as HTMLSelectElement
    const options = [...select.options].map((o) => o.textContent)
    expect(options).toEqual(['Selecione uma OSC', OSCS.ALFA.name, OSCS.BETA.name])
    expect(screen.getByText(/Vínculo com 2 OSCs: a escolha é explícita\. 2 vínculos sem acesso/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Selecione uma OSC para continuar' })).toBeTruthy()
    expect(title()).toBe('Gestão da OSC')
    expect(screen.queryByRole('button', { name: 'Parcerias' })).toBeNull()
    expect(document.body.textContent).not.toContain(OSCS.GAMA.name)
  })

  it('U05 — troca de OSC atualiza o contexto, revalida e descarta a OSC anterior', async () => {
    const { fakeDb } = renderAs(USERS.MULTI)
    await selectOsc(OSCS.ALFA.id)
    await goTo('Usuários e permissões')
    await usersTable()
    await selectOsc(OSCS.BETA.id)
    expect(fakeDb.calls).toContain(`getMembership:osc-beta/${USERS.MULTI.uid}`)
    // BETA (fictícia) está comercialmente suspensa e o MULTI é operacional nela:
    // nada da ALFA permanece; gestão e navegação somem; acesso bloqueado (HF-G05).
    await waitFor(() => expect(screen.queryByRole('table')).toBeNull())
    expect((await screen.findByRole('alert')).textContent).toContain('Acesso bloqueado: assinatura suspensa')
    expect(document.body.textContent).not.toContain(PERMISSION_USERS.OPERATOR.email)
    expect(within(await sidebar()).queryByRole('button', { name: 'Usuários e permissões' })).toBeNull()
    expect(contextText()).not.toContain(OSCS.ALFA.name)
  })

  it('U03 — sem vínculos: orientação institucional, sem cadastro público', async () => {
    renderAs(USERS.NONE)
    expect(await screen.findByRole('heading', { name: 'Nenhum vínculo organizacional autorizado' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/cadastrar osc|criar conta|solicitar acesso/i)
    for (const osc of Object.values(OSCS)) expect(document.body.textContent).not.toContain(osc.name)
  })

  it('vínculo inativo e OSC indisponível: nenhum selecionável → estado sem acesso com motivos', async () => {
    renderAs(USERS.MULTI, {
      prepare: (db) => {
        for (const id of ['osc-alfa', 'osc-beta']) {
          const path = `oscs/${id}/members/${USERS.MULTI.uid}`
          db.docs.set(path, { ...db.docs.get(path), status: 'inactive' })
        }
      },
    })
    expect(await screen.findByRole('heading', { name: 'Nenhuma OSC disponível para seleção' })).toBeTruthy()
    const list = screen.getByRole('list', { name: 'Vínculos sem acesso' })
    expect(list.textContent).toContain('Vínculo inativo — não pode ser selecionada.')
    expect(list.textContent).toContain('OSC ainda não ativada pela administração da plataforma.')
    expect(document.body.textContent).not.toContain(OSCS.GAMA.name)
  })

  it('U06 — logout limpa contexto, seleção guardada e retorna ao login', async () => {
    const { storage, organizationStore } = renderAs(USERS.SINGLE)
    await screen.findByText('OSC · Regular')
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
    const { fakeDb } = renderAs(USERS.MULTI, { storage })
    await waitFor(() => expect((screen.getByLabelText('OSC selecionada') as HTMLSelectElement).value).toBe(OSCS.BETA.id))
    expect((await screen.findByRole('alert')).textContent).toContain('Acesso bloqueado') // BETA suspensa (fictícia)
    expect(fakeDb.calls[0]).toBe(`listMembershipsByUid:${USERS.MULTI.uid}`)
    cleanup()
    const forged = createMemorySelectionStorage()
    forged.write(USERS.MULTI.uid, OSCS.GAMA.id)
    renderAs(USERS.MULTI, { storage: forged })
    expect(await screen.findByRole('heading', { name: 'Selecione uma OSC para continuar' })).toBeTruthy()
  })
})

describe('PAG-OSC02 — Parcerias (estrutura, sem funcionalidade)', () => {
  it('apresenta estado indisponível, controles desabilitados e nenhuma parceria inventada', async () => {
    renderAs(USERS.SINGLE)
    await screen.findByText('OSC · Regular')
    await goTo('Parcerias')
    expect(screen.getByRole('heading', { name: 'Gestão de Parcerias ainda não disponível' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Cadastrar parceria' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Localizar parcerias') as HTMLInputElement).disabled).toBe(true)
    expect(document.body.textContent).not.toMatch(/Termo de (Colaboração|Fomento)|Acordo de Cooperação|Em execução|Selecionar/)
    expect(contextText()).toContain('Parceria: não selecionada')
  })
})

describe('PAG-OSC03 — Usuários e Permissões (operações reais da DEV-01.3)', () => {
  it('administrador: passos 1→2→3, confirmação em linha e resultado vindo do servidor', async () => {
    const { server } = renderAs(USERS.MULTI)
    await selectOsc(OSCS.ALFA.id)
    await goTo('Usuários e permissões')
    const table = await usersTable()
    expect(within(table).getAllByRole('row')).toHaveLength(5)
    expect(contextText()).toContain('Usuário atual: Administrador único')
    expect(row(table, `${USERS.MULTI.email} (você)`).textContent).toContain('Administrador único')
    expect(row(table, PERMISSION_USERS.DELEGATE.email).textContent).toContain('Delegado')
    expect(row(table, PERMISSION_USERS.OPERATOR.email).textContent).toContain('Individuais (1)')
    expect(row(table, PERMISSION_USERS.FORMER.email).textContent).toContain('Vínculo inativo')
    expect(screen.getByText('Consulte um usuário na lista para continuar.')).toBeTruthy()

    fireEvent.click(within(table).getByRole('button', { name: PERMISSION_USERS.OPERATOR.email }))
    expect(screen.getByRole('heading', { name: `Usuário consultado: ${PERMISSION_USERS.OPERATOR.email} · Operacional` })).toBeTruthy()
    expect(screen.getByText(/Passo 1 de 3 concluído/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Conceder permissão' }))
    expect(screen.getByRole('button', { name: 'Conceder permissão' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Passo 2 de 3: escolha a permissão a conceder.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `Conceder Consultar documentos — ${PERMISSION_USERS.OPERATOR.email}` }))
    const dialog = screen.getByRole('alertdialog', { name: 'Confirmar operação' })
    expect(dialog.textContent).toContain(`Conceder a permissão “Consultar documentos” a ${PERMISSION_USERS.OPERATOR.email}, com efeito em todas as parcerias da ${OSCS.ALFA.name}?`)
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Confirmar'))
    expect(server.calls.some((c) => c.startsWith('grant-permission'))).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText(`Permissão “Consultar documentos” concedida a ${PERMISSION_USERS.OPERATOR.email}. Vale para todas as parcerias desta OSC.`)).toBeTruthy()
    await waitFor(() => expect(server.truth.get('osc-alfa')?.get(PERMISSION_USERS.OPERATOR.uid)?.permissions).toContain('documents.view'))
    await waitFor(() => expect(row(screen.getByRole('table'), PERMISSION_USERS.OPERATOR.email).textContent).toContain('Individuais (2)'))

    fireEvent.click(screen.getByRole('button', { name: 'Revogar permissão' }))
    fireEvent.click(screen.getByRole('button', { name: `Revogar Consultar documentos — ${PERMISSION_USERS.OPERATOR.email}` }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(server.truth.get('osc-alfa')?.get(PERMISSION_USERS.OPERATOR.uid)?.permissions).not.toContain('documents.view'))
  })

  it('cancelar não envia nada; delegação só pelo administrador; sem controles sobre si; ex-membro só revoga', async () => {
    const { server } = renderAs(USERS.MULTI)
    await selectOsc(OSCS.ALFA.id)
    await goTo('Usuários e permissões')
    const table = await usersTable()
    fireEvent.click(within(table).getByRole('button', { name: PERMISSION_USERS.OPERATOR.email }))
    fireEvent.click(screen.getByRole('button', { name: 'Conceder delegação' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(server.calls.some((c) => c.startsWith('grant-delegation'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Conceder delegação' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(server.truth.get('osc-alfa')?.get(PERMISSION_USERS.OPERATOR.uid)?.canManagePermissions).toBe(true))
    await waitFor(() => expect(row(screen.getByRole('table'), PERMISSION_USERS.OPERATOR.email).textContent).toContain('Delegado'))

    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: `${USERS.MULTI.email} (você)` }))
    expect(screen.getByText('Não é permitido alterar as próprias permissões ou delegação.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Conceder permissão' }))
    expect(screen.queryAllByRole('button', { name: /^Conceder .* — / })).toHaveLength(0)
    expect((screen.getByRole('button', { name: /delegação$/ }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: PERMISSION_USERS.FORMER.email }))
    expect(screen.queryAllByRole('button', { name: /^Conceder .* — / })).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Revogar permissão' }))
    expect(screen.getByRole('button', { name: `Revogar Consultar documentos — ${PERMISSION_USERS.FORMER.email}` })).toBeTruthy()
  })

  it('delegado: gere outros, sem delegação, sem si mesmo e sem o administrador; sem exportação', async () => {
    renderAs(PERMISSION_USERS.DELEGATE)
    await screen.findByText('OSC · Regular')
    await goTo('Usuários e permissões')
    const table = await usersTable()
    expect(contextText()).toContain('Usuário atual: Delegado')
    expect(screen.queryByRole('button', { name: /delegação$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Exportar relação (CSV)' })).toBeNull()
    expect(screen.getByText(/Convidar e desvincular usuários são ações do administrador único/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Conceder permissão' }))
    fireEvent.click(within(table).getByRole('button', { name: USERS.MULTI.email }))
    expect(screen.queryAllByRole('button', { name: /^Conceder .* — / })).toHaveLength(0)
    fireEvent.click(within(table).getByRole('button', { name: `${PERMISSION_USERS.DELEGATE.email} (você)` }))
    expect(screen.queryAllByRole('button', { name: /^Conceder .* — / })).toHaveLength(0)
    fireEvent.click(within(table).getByRole('button', { name: PERMISSION_USERS.OPERATOR.email }))
    expect(screen.getAllByRole('button', { name: /^Conceder .* — / }).length).toBe(5)
  })

  it('usuário operacional: vê as próprias permissões e não acessa a gestão (nem pela rota direta)', async () => {
    window.location.hash = '#/usuarios'
    renderAs(PERMISSION_USERS.OPERATOR)
    expect((await screen.findByRole('alert')).textContent).toContain('Acesso negado')
    expect(within(await sidebar()).queryByRole('button', { name: 'Usuários e permissões' })).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    await goTo('Identificação da OSC')
    expect(screen.getByRole('list', { name: 'Gestão de parcerias' }).textContent).toContain('Consultar parcerias da OSC')
    expect(screen.getAllByText('Operacional').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Usuários e permissões' })).toBeNull()
    expect(document.body.textContent).not.toContain(PERMISSION_USERS.DELEGATE.email)
  })

  it('PER-18 — estado manipulado no navegador não concede autorização (servidor nega)', async () => {
    const { server } = renderAs(PERMISSION_USERS.OPERATOR, { forge: { canManagePermissions: true, permissions: ['admin', 'all', 'financial.view'] } })
    await screen.findByText('OSC · Regular')
    await goTo('Usuários e permissões')
    expect((await screen.findByRole('alert')).textContent).toContain('Acesso negado: Você não tem competência para gerir permissões nesta OSC.')
    expect(server.calls.every((c) => c === 'list:osc-alfa')).toBe(true)
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('Suspensão comercial e falhas', () => {
  it('administrador: aviso de somente consulta, sem alterações, com exportação', async () => {
    renderAs(USERS.MULTI, { suspendAlfa: true })
    await selectOsc(OSCS.ALFA.id)
    expect(screen.getByText('OSC · Suspensa')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Assinatura suspensa.')
    await goTo('Usuários e permissões')
    await usersTable()
    expect(screen.getByText('Somente consulta durante a suspensão comercial.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Conceder permissão' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Exportar relação (CSV)' })).toBeTruthy()
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: PERMISSION_USERS.OPERATOR.email }))
    expect(screen.getByText('Somente consulta.')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: /^(Conceder|Revogar) .* — / })).toHaveLength(0)
  })

  it('delegado: acesso bloqueado e navegação ocultada', async () => {
    renderAs(PERMISSION_USERS.DELEGATE, { suspendAlfa: true })
    expect((await screen.findByRole('alert')).textContent).toContain('Acesso bloqueado: assinatura suspensa')
    expect(within(await sidebar()).queryAllByRole('button')).toHaveLength(0)
    expect(title()).toBe('Gestão da OSC')
  })

  it('operações de servidor não publicadas: indisponível, nada simulado', async () => {
    const { server } = renderAs(USERS.MULTI)
    server.fail('unavailable')
    await selectOsc(OSCS.ALFA.id)
    await goTo('Usuários e permissões')
    expect((await screen.findByRole('alert')).textContent).toMatch(/indisponível neste ambiente.*Nenhuma alteração foi realizada/)
  })

  it('falha de rede na alteração: erro informado e estado preservado', async () => {
    const { server } = renderAs(USERS.MULTI)
    await selectOsc(OSCS.ALFA.id)
    await goTo('Usuários e permissões')
    const table = await usersTable()
    fireEvent.click(within(table).getByRole('button', { name: PERMISSION_USERS.OPERATOR.email }))
    fireEvent.click(screen.getByRole('button', { name: 'Conceder permissão' }))
    server.fail('network')
    fireEvent.click(screen.getByRole('button', { name: `Conceder Consultar documentos — ${PERMISSION_USERS.OPERATOR.email}` }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Falha de conexão')
    expect(row(screen.getByRole('table'), PERMISSION_USERS.OPERATOR.email).textContent).toContain('Individuais (1)')
  })

  it('falha de rede na consulta de vínculos: mensagem segura e nova tentativa', async () => {
    const { fakeDb } = renderAs(USERS.SINGLE, { prepare: (db) => db.fail('listMembershipsByUid', firestoreError('unavailable', 'segredo projeto-x')) })
    expect((await screen.findByRole('alert')).textContent).toMatch(/Falha de conexão/)
    expect(document.body.textContent).not.toContain('projeto-x')
    fakeDb.recover()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => expect(contextText()).toContain(OSCS.GAMA.name))
  })

  it('regras não publicadas (permission-denied): mensagem segura, sem dados', async () => {
    renderAs(USERS.MULTI, { prepare: (db) => db.fail('listMembershipsByUid', firestoreError('permission-denied', 'Missing or insufficient permissions.')) })
    expect((await screen.findByRole('alert')).textContent).toMatch(/acesso foi negado pelas regras de segurança/)
    expect(document.body.textContent).not.toMatch(/Missing or insufficient/)
  })

  it('falha ao revalidar na troca mantém a OSC atual e informa o erro', async () => {
    const { fakeDb } = renderAs(USERS.MULTI)
    await selectOsc(OSCS.ALFA.id)
    fakeDb.fail('getMembership', firestoreError('unavailable'))
    await act(async () => {
      fireEvent.change(screen.getByLabelText('OSC selecionada'), { target: { value: OSCS.BETA.id } })
    })
    expect((await screen.findByRole('alert')).textContent).toMatch(/Falha de conexão/)
    expect(contextText()).toContain(OSCS.ALFA.name)
  })

  it('acessibilidade básica: landmarks, h1 único, aria-current e botões nomeados', async () => {
    renderAs(USERS.SINGLE)
    await screen.findByText('OSC · Regular')
    expect(screen.getByRole('main')).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('button', { current: 'page' })).toHaveLength(1)
    for (const button of screen.getAllByRole('button')) expect(button.textContent?.trim() || button.getAttribute('aria-label')).toBeTruthy()
  })
})

describe('Exportação CSV', () => {
  it('gera a relação e neutraliza fórmulas (injeção de CSV)', () => {
    const csv = directoryToCsv({
      oscId: 'osc-alfa', organizationName: 'x', commercialStatus: 'suspended', readOnly: true, viewerAuthority: 'administrator',
      members: [{ uid: 'u1', email: '=HYPERLINK("http://x")', status: 'active', isAdministrator: true, canManagePermissions: false, permissions: ['documents.view'] }],
    })
    const [header, line] = csv.split('\r\n')
    expect(header).toContain('"documents.view"')
    expect(line).toContain(`"'=HYPERLINK(""http://x"")"`)
  })
})
