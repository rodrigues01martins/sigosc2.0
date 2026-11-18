/**
 * UX-001 — Matriz de usuários e permissões (Vitest + jsdom).
 *
 * T01–T15 e acessibilidade. Também cobrem, sobre o novo fluxo, as verificações
 * dos testes da PAG-OSC03 da DEV-01.4 (3 passos), sem afrouxar segurança:
 * concessão/revogação pelo servidor, autoalteração, proteção do administrador,
 * delegação só pelo administrador, PER-18, suspensão, indisponibilidade e rede.
 * Auth, Firestore e servidor SIMULADOS (dados fictícios, sem rede).
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OSCS, USERS } from '../../../../tests/support/organizationFixtures.ts'
import { PERMISSION_USERS } from '../../../../tests/support/permissionFixtures.ts'
import { renderOscApp } from '../../../../tests/support/renderOscApp.tsx'
import { GRANTABLE_PERMISSIONS, permissionLabel } from '../../../domain/authorization.ts'
import { directoryToCsv } from '../../Permissions/exportCsv.ts'

const originalMatchMedia = window.matchMedia
afterEach(() => {
  cleanup()
  window.location.hash = ''
  window.matchMedia = originalMatchMedia
})

const OPERATOR = PERMISSION_USERS.OPERATOR
const DELEGATE = PERMISSION_USERS.DELEGATE
const FORMER = PERMISSION_USERS.FORMER
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Célula pelo nome acessível: "permissão — usuário: estado visível". */
const cell = (permission: string, email: string) => screen.getByRole('button', { name: new RegExp(`^${esc(permission)} — ${esc(email)}: `) })
const truth = (server: ReturnType<typeof renderOscApp>['server'], uid: string) => server.truth.get('osc-alfa')?.get(uid)

async function openMatrix(user: Parameters<typeof renderOscApp>[0], options: Parameters<typeof renderOscApp>[1] = {}) {
  window.location.hash = '#/usuarios'
  const app = renderOscApp(user, options)
  if (user.uid === USERS.MULTI.uid) {
    fireEvent.change(await screen.findByLabelText('OSC selecionada'), { target: { value: OSCS.ALFA.id } })
  }
  await screen.findByRole('heading', { name: 'Usuários e permissões', level: 2 })
  return app
}
const rowOf = (email: string) => screen.getByRole('rowheader', { name: new RegExp(email.replace(/[.]/g, '\\.')) }).closest('tr') as HTMLElement

describe('Estrutura da matriz', () => {
  it('T01 — usuários nas linhas, com nome, vínculo e competência', async () => {
    await openMatrix(USERS.MULTI)
    const table = screen.getByRole('table', { name: /Matriz de usuários e permissões operacionais/ })
    const headers = within(table).getAllByRole('rowheader').map((h) => h.textContent ?? '')
    expect(headers).toHaveLength(4)
    for (const email of [DELEGATE.email, FORMER.email, `${USERS.MULTI.email} (você)`, OPERATOR.email]) {
      expect(headers.some((h) => h.startsWith(email))).toBe(true)
    }
    expect(rowOf(USERS.MULTI.email).textContent).toContain('Administrador único')
    expect(rowOf(DELEGATE.email).textContent).toContain('Delegado')
    expect(rowOf(OPERATOR.email).textContent).toContain('Operacional')
    expect(rowOf(FORMER.email).textContent).toContain('Vínculo inativo')
  })

  it('T02 — permissões do catálogo vigente nas colunas (sem permissões inventadas); delegação separada', async () => {
    await openMatrix(USERS.MULTI)
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '')
    for (const permission of GRANTABLE_PERMISSIONS) expect(headers.some((h) => h.includes(permissionLabel(permission)))).toBe(true)
    // Usuário (com vínculo e competência) + 6 permissões + Delegação
    expect(headers[0]).toBe('Usuário · vínculo e competência')
    expect(headers).toHaveLength(1 + GRANTABLE_PERMISSIONS.length + 1)
    expect(headers.at(-1)).toContain('Delegação')
    // DEC-PAR-001 aprovou o cadastro de parcerias; as demais permissões do protótipo antigo continuam fora.
    expect(headers.join(' ')).not.toMatch(/Editar plano|Registrar e editar receitas|Convidar usuários/)
    expect(headers.filter((h) => h.includes('Gestão de parcerias'))).toHaveLength(3)
  })
})

describe('DEV-02.2-C01 — DEC-PT-001 na matriz', () => {
  it('DEV-02.2-C01-T06/T07 — Plano de Trabalho com view e edit; finalize descontinuada fora da matriz e do CSV, sem conceder nada', async () => {
    const { server } = await openMatrix(USERS.MULTI, {
      prepare: (db) => {
        // Vínculo com o identificador descontinuado gravado (compatibilidade histórica).
        const path = `oscs/osc-alfa/members/${OPERATOR.uid}`
        db.docs.set(path, { ...db.docs.get(path), permissions: ['partnerships.view', 'work-plan.finalize'] })
      },
    })
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '')
    expect(headers.filter((h) => h.includes('Plano de Trabalho'))).toHaveLength(2)
    expect(headers.some((h) => h.includes('Registrar, finalizar e corrigir o Plano de Trabalho'))).toBe(true)
    expect(headers.join(' ')).not.toMatch(/Finalizar internamente/)
    expect(cell('Registrar, finalizar e corrigir o Plano de Trabalho', OPERATOR.email).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(cell('Registrar, finalizar e corrigir o Plano de Trabalho', OPERATOR.email))
    await waitFor(() => expect(cell('Registrar, finalizar e corrigir o Plano de Trabalho', OPERATOR.email).getAttribute('aria-pressed')).toBe('true'))
    expect(truth(server, OPERATOR.uid)?.permissions).toContain('work-plan.edit')
    const directory = await server.apiFor(() => USERS.MULTI.uid).listMembers('osc-alfa')
    expect(directory.ok && directoryToCsv(directory.data).split('\n')[0]).not.toContain('work-plan.finalize')
  })
})

describe('Alteração direta', () => {
  it('DEV-02.1-C01-T09 — cadastro e edição de parcerias: colunas próprias, um clique para conceder e revogar', async () => {
    const { server } = await openMatrix(USERS.MULTI)
    for (const label of ['Cadastrar parcerias formalizadas', 'Alterar dados cadastrais de parcerias']) {
      expect(cell(label, OPERATOR.email).getAttribute('aria-pressed')).toBe('false')
      fireEvent.click(cell(label, OPERATOR.email))
      expect(screen.queryByRole('alertdialog')).toBeNull()
      await waitFor(() => expect(cell(label, OPERATOR.email).getAttribute('aria-pressed')).toBe('true'))
    }
    expect(truth(server, OPERATOR.uid)?.permissions).toEqual(['partnerships.view', 'partnerships.create', 'partnerships.edit'])
    fireEvent.click(cell('Cadastrar parcerias formalizadas', OPERATOR.email))
    await waitFor(() => expect(cell('Cadastrar parcerias formalizadas', OPERATOR.email).getAttribute('aria-pressed')).toBe('false'))
    expect(truth(server, OPERATOR.uid)?.permissions).toEqual(['partnerships.view', 'partnerships.edit'])
    // O administrador não altera as próprias (DEC-PAR-002): células bloqueadas, sem botão.
    expect(within(rowOf(USERS.MULTI.email)).queryByRole('button', { name: /^Cadastrar parcerias formalizadas/ })).toBeNull()
  })

  it('T03/T05 — um clique concede, sem confirmação adicional, e o estado vem do servidor', async () => {
    const { server } = await openMatrix(USERS.MULTI)
    const button = cell('Consultar documentos', OPERATOR.email)
    expect(button.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(cell('Consultar documentos', OPERATOR.email).getAttribute('aria-pressed')).toBe('true'))
    expect(cell('Consultar documentos', OPERATOR.email).textContent).toContain('Concedida')
    expect(truth(server, OPERATOR.uid)?.permissions).toContain('documents.view')
    expect(server.calls.filter((c) => c.startsWith('grant-permission'))).toEqual([`grant-permission:${OPERATOR.uid}:documents.view`])
    expect(screen.getByRole('status').textContent).toBe(`Permissão “Consultar documentos” concedida a ${OPERATOR.email}.`)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('T04/T05 — um clique revoga, sem confirmação adicional', async () => {
    const { server } = await openMatrix(USERS.MULTI)
    expect(cell('Consultar parcerias da OSC', OPERATOR.email).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(cell('Consultar parcerias da OSC', OPERATOR.email))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(cell('Consultar parcerias da OSC', OPERATOR.email).getAttribute('aria-pressed')).toBe('false'))
    expect(truth(server, OPERATOR.uid)?.permissions).not.toContain('partnerships.view')
    expect(screen.getByRole('status').textContent).toContain('revogada de')
  })

  it('T06/T08 — estado só confirmado após resposta positiva; duplicidade bloqueada; resto da matriz livre', async () => {
    const { server } = await openMatrix(USERS.MULTI)
    const release = server.hold()
    fireEvent.click(cell('Consultar documentos', OPERATOR.email))
    const processing = await screen.findByRole('button', { name: `Consultar documentos — ${OPERATOR.email}: Concedendo…` })
    expect(processing.getAttribute('aria-pressed')).toBe('false')
    expect(processing.getAttribute('aria-disabled')).toBe('true')
    expect(processing.getAttribute('aria-busy')).toBe('true')
    expect(processing.textContent).toContain('Concedendo…')
    fireEvent.click(processing)
    fireEvent.click(processing)
    expect(truth(server, OPERATOR.uid)?.permissions).not.toContain('documents.view')
    // Outras células continuam disponíveis.
    expect((cell('Consultar gestão financeira', OPERATOR.email) as HTMLButtonElement).disabled).toBe(false)
    await act(async () => release())
    await waitFor(() => expect(cell('Consultar documentos', OPERATOR.email).getAttribute('aria-pressed')).toBe('true'))
    expect(server.calls.filter((c) => c === `grant-permission:${OPERATOR.uid}:documents.view`)).toHaveLength(1)
  })

  it('T07 — falha de rede preserva o estado confirmado, informa e permite nova tentativa', async () => {
    const { server } = await openMatrix(USERS.MULTI)
    server.fail('network')
    fireEvent.click(cell('Consultar documentos', OPERATOR.email))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não foi possível comunicar com o servidor. A permissão não foi alterada. Tente novamente.',
    )
    expect(cell('Consultar documentos', OPERATOR.email).getAttribute('aria-pressed')).toBe('false')
    expect(within(rowOf(OPERATOR.email)).getByText('Não alterada — tente novamente')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    server.fail(null)
    fireEvent.click(cell('Consultar documentos', OPERATOR.email))
    await waitFor(() => expect(cell('Consultar documentos', OPERATOR.email).getAttribute('aria-pressed')).toBe('true'))
    expect(screen.queryByText('Não alterada — tente novamente')).toBeNull()
  })

  it('sessão expirada e servidor indisponível: mensagens específicas, nada simulado', async () => {
    const { server } = await openMatrix(USERS.MULTI)
    server.fail('session-expired')
    fireEvent.click(cell('Consultar documentos', OPERATOR.email))
    expect((await screen.findByRole('alert')).textContent).toBe('Sua sessão expirou. Entre novamente para continuar.')
    server.fail('unavailable')
    fireEvent.click(cell('Consultar documentos', OPERATOR.email))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/indisponível neste ambiente\. A permissão não foi alterada/))
    expect(screen.getAllByRole('alert')).toHaveLength(1) // sem mensagens duplicadas
    expect(truth(server, OPERATOR.uid)?.permissions).not.toContain('documents.view')
  })
})

describe('Autorização (decidida pelo servidor)', () => {
  it('T09 — usuário comum não altera permissões (rota, menu e servidor); estado manipulado não concede (PER-18)', async () => {
    window.location.hash = '#/usuarios'
    renderOscApp(OPERATOR)
    expect((await screen.findByRole('alert')).textContent).toContain('Acesso negado')
    expect(screen.queryByRole('table')).toBeNull()
    cleanup()
    const { server } = renderOscApp(OPERATOR, { forge: { canManagePermissions: true, permissions: ['admin', 'all'] } })
    window.location.hash = '#/usuarios'
    expect((await screen.findByRole('alert')).textContent).toContain('Você não possui autorização para consultar os usuários e permissões desta OSC.')
    expect(server.calls.every((c) => c === 'list:osc-alfa')).toBe(true)
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0)
  })

  it('autorização revogada durante o uso: servidor nega, estado preservado e relação recarregada', async () => {
    const { server } = await openMatrix(DELEGATE)
    const stored = server.truth.get('osc-alfa')?.get(DELEGATE.uid)
    if (stored) stored.canManagePermissions = false // administrador revogou a delegação em outro lugar
    fireEvent.click(cell('Consultar documentos', OPERATOR.email))
    expect((await screen.findByRole('alert')).textContent).toMatch(/autorização/)
    await waitFor(() => expect(screen.queryByRole('table')).toBeNull())
    expect(server.calls.filter((c) => c === 'list:osc-alfa').length).toBeGreaterThan(1)
  })

  it('T10 — delegado não altera as próprias permissões', async () => {
    await openMatrix(DELEGATE)
    const row = rowOf(DELEGATE.email)
    expect(within(row).queryAllByRole('button')).toHaveLength(0)
    expect(within(row).getAllByText('Próprio usuário')).toHaveLength(GRANTABLE_PERMISSIONS.length)
  })

  it('T11 — delegado não altera o administrador; não vê delegação nem exportação', async () => {
    await openMatrix(DELEGATE)
    const row = rowOf(USERS.MULTI.email)
    expect(within(row).queryAllByRole('button')).toHaveLength(0)
    expect(within(row).getAllByText('Adm. da Plataforma')).toHaveLength(GRANTABLE_PERMISSIONS.length) // DEC-PAR-002
    expect(screen.getAllByRole('columnheader').some((h) => h.textContent?.includes('Delegação'))).toBe(false)
    expect(screen.queryByRole('button', { name: /delegação/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Exportar relação (CSV)' })).toBeNull()
    // Outros usuários continuam alteráveis pelo delegado.
    expect(within(rowOf(OPERATOR.email)).getAllByRole('button')).toHaveLength(GRANTABLE_PERMISSIONS.length)
  })

  it('administrador: próprio vínculo bloqueado; vínculo inativo só admite revogação', async () => {
    await openMatrix(USERS.MULTI)
    expect(within(rowOf(USERS.MULTI.email)).queryAllByRole('button', { pressed: false })).toHaveLength(0)
    const former = rowOf(FORMER.email)
    expect(within(former).getByRole('button', { name: new RegExp(`^Consultar documentos — ${esc(FORMER.email)}: `) }).getAttribute('aria-pressed')).toBe('true')
    expect(within(former).getAllByText('Vínculo inativo').length).toBeGreaterThanOrEqual(GRANTABLE_PERMISSIONS.length - 1)
    expect(within(former).queryByRole('button', { name: /delegação/ })).toBeNull()
  })

  it('T12 — delegação exige confirmação explícita com destinatário, OSC, competência e consequência', async () => {
    const { server } = await openMatrix(USERS.MULTI)
    fireEvent.click(screen.getByRole('button', { name: `Conceder delegação a ${OPERATOR.email}` }))
    const dialog = screen.getByRole('alertdialog', { name: 'Confirmar concessão de delegação' })
    expect(dialog.textContent).toContain(OPERATOR.email)
    expect(dialog.textContent).toContain(OSCS.ALFA.name)
    expect(dialog.textContent).toContain('gerir permissões')
    expect(dialog.textContent).toContain('não poderá criar delegações nem alterar o administrador único')
    expect(server.calls.some((c) => c.startsWith('grant-delegation'))).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(server.calls.some((c) => c.startsWith('grant-delegation'))).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: `Conceder delegação a ${OPERATOR.email}` }))
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Conceder delegação'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Conceder delegação' }))
    await waitFor(() => expect(truth(server, OPERATOR.uid)?.canManagePermissions).toBe(true))
    await waitFor(() => expect(rowOf(OPERATOR.email).textContent).toContain('Delegado'))
    fireEvent.click(screen.getByRole('button', { name: `Revogar delegação de ${OPERATOR.email}` }))
    expect(screen.getByRole('alertdialog', { name: 'Confirmar revogação de delegação' }).textContent).toContain('as permissões operacionais dele não serão alteradas')
  })
})

describe('Suspensão, dispositivos e contexto', () => {
  it('T13 — suspensão comercial: administrador só consulta e exporta; células bloqueadas', async () => {
    await openMatrix(USERS.MULTI, { suspendAlfa: true })
    expect(screen.getByText('Somente consulta e exportação durante a suspensão comercial.')).toBeTruthy()
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0)
    expect(screen.queryAllByRole('button', { pressed: false })).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /delegação/ })).toBeNull()
    expect(screen.getAllByText('Somente consulta').length).toBeGreaterThan(GRANTABLE_PERMISSIONS.length)
    expect(screen.getByRole('button', { name: 'Exportar relação (CSV)' })).toBeTruthy()
  })

  it('T14 — celular: cartões por usuário, módulos agrupados e operação direta em um toque', async () => {
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    const { server } = await openMatrix(USERS.MULTI)
    expect(screen.queryByRole('table')).toBeNull()
    const cards = screen.getByRole('list', { name: 'Usuários e permissões' })
    const operatorCard = within(cards).getByRole('article', { name: OPERATOR.email })
    expect(within(operatorCard).getByRole('group', { name: 'Gestão Financeira' })).toBeTruthy()
    fireEvent.click(within(operatorCard).getByRole('button', { name: new RegExp(`^Consultar gestão financeira — ${esc(OPERATOR.email)}: `) }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(truth(server, OPERATOR.uid)?.permissions).toContain('financial.view'))
    await waitFor(() => expect(within(operatorCard).getByRole('button', { name: new RegExp(`^Consultar gestão financeira — ${esc(OPERATOR.email)}: `) }).getAttribute('aria-pressed')).toBe('true'))
  })

  it('T15 — troca de OSC e logout não preservam dados nem controles do contexto anterior', async () => {
    const { server } = await openMatrix(USERS.MULTI)
    const release = server.hold()
    fireEvent.click(cell('Consultar documentos', OPERATOR.email))
    await screen.findByRole('button', { name: /Concedendo…/ })
    fireEvent.change(screen.getByLabelText('OSC selecionada'), { target: { value: OSCS.BETA.id } })
    await waitFor(() => expect(screen.queryByRole('table')).toBeNull())
    await act(async () => release())
    expect(document.body.textContent).not.toContain(OPERATOR.email)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('button', { name: /Concedendo…/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('OSC selecionada'), { target: { value: OSCS.ALFA.id } })
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: /Concedendo…/ })).toBeNull()
    expect(screen.queryByText('Não alterada — tente novamente')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
    await screen.findByRole('button', { name: 'Entrar' })
    expect(screen.queryByRole('table')).toBeNull()
    expect(document.body.textContent).not.toContain(OPERATOR.email)
  })
})

describe('Estados vazios, pesquisa e acessibilidade', () => {
  it('pesquisa por usuário filtra as linhas e informa quando não há correspondência', async () => {
    await openMatrix(USERS.MULTI)
    fireEvent.change(screen.getByLabelText('Pesquisar usuário'), { target: { value: 'operador' } })
    expect(screen.getAllByRole('rowheader')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Pesquisar usuário'), { target: { value: 'inexistente' } })
    expect(screen.getByText('Nenhum usuário corresponde à pesquisa.')).toBeTruthy()
  })

  it('consulta indisponível: mensagem compreensível e nova tentativa', async () => {
    window.location.hash = '#/usuarios'
    const app = renderOscApp(USERS.SINGLE)
    app.server.fail('network')
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível comunicar com o servidor para consultar os usuários')
    app.server.fail(null)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByRole('table')).toBeTruthy()
  })

  it('acessibilidade: cabeçalhos de linha/coluna, nome acessível com linha e coluna, estado não só por cor', async () => {
    await openMatrix(USERS.MULTI)
    expect(screen.getAllByRole('rowheader')).toHaveLength(4)
    for (const button of screen.getAllByRole('button', { pressed: false }).concat(screen.getAllByRole('button', { pressed: true }))) {
      const name = button.getAttribute('aria-label') ?? ''
      // Linha e coluna no nome + o texto visível incluído no nome (WCAG 2.5.3).
      expect(name).toMatch(/^.+ — .+@exemplo\.invalid: (Concedida|Não concedida)$/)
      expect(name.endsWith(button.textContent ?? '')).toBe(true)
    }
    // DEC-PAR-002: permissões do administrador único só pela Administração da Plataforma; delegação: própria.
    const row = within(rowOf(USERS.MULTI.email))
    expect(row.getAllByText(/bloqueada — as permissões operacionais do administrador único só podem ser alteradas pela Administração da Plataforma/)).toHaveLength(GRANTABLE_PERMISSIONS.length)
    expect(row.getAllByText(/bloqueada — não é permitido alterar as próprias permissões/)).toHaveLength(1)
  })
})
