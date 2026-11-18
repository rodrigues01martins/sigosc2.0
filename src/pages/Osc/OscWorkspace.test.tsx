/**
 * Testes de interface da Gestão da OSC (DEV-01.4) — Vitest + jsdom.
 *
 * Substituem os testes da interface técnica provisória (DEV-01.2 e DEV-01.3),
 * preservando os mesmos cenários (U01–U07, PER-18, suspensão, falhas, CSV) sobre
 * o layout homologado HF-G05 de PAG-OSC01 a 03, e acrescentam a navegação.
 * Auth, Firestore e servidor de permissões SIMULADOS (dados fictícios, sem rede).
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { firestoreError } from '../../../tests/support/fakeOrganizationsSdk.ts'
import { renderOscApp } from '../../../tests/support/renderOscApp.tsx'
import { OSCS, USERS } from '../../../tests/support/organizationFixtures.ts'
import { PERMISSION_USERS } from '../../../tests/support/permissionFixtures.ts'
import { createMemorySelectionStorage } from '../../services/organizations/selectionStorage.ts'
import { directoryToCsv } from '../Permissions/exportCsv.ts'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const renderAs = renderOscApp

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

// DEV-02.1: o teste "PAG-OSC02 — estrutura, sem funcionalidade" (estado indisponível e
// controles desabilitados) foi substituído, pois o módulo passou a funcionar. A intenção
// (nenhuma parceria inventada; nenhum botão inoperante) é verificada abaixo e em
// src/pages/Osc/partnerships/Partnerships.test.tsx.
describe('PAG-OSC02 — Parcerias (sem dados inventados)', () => {
  it('sem a permissão de consulta não há lista nem botão de cadastro; nenhuma parceria inventada', async () => {
    renderAs(USERS.SINGLE)
    await screen.findByText('OSC · Regular')
    await goTo('Parcerias')
    expect(screen.getByRole('heading', { name: 'Consulta de parcerias não autorizada' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cadastrar parceria' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/Termo de (Colaboração|Fomento)|Acordo de Cooperação|Em execução|Selecionar/)
    expect(contextText()).toContain('Parceria: não selecionada')
  })
})

// UX-001: os testes da PAG-OSC03 (fluxo em 3 passos) foram substituídos pelos
// testes da matriz em src/pages/Osc/permissions/PermissionMatrix.test.tsx,
// preservando as mesmas verificações de segurança.

describe('Suspensão comercial e falhas', () => {
  it('delegado: acesso bloqueado e navegação ocultada', async () => {
    renderAs(PERMISSION_USERS.DELEGATE, { suspendAlfa: true })
    expect((await screen.findByRole('alert')).textContent).toContain('Acesso bloqueado: assinatura suspensa')
    expect(within(await sidebar()).queryAllByRole('button')).toHaveLength(0)
    expect(title()).toBe('Gestão da OSC')
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
