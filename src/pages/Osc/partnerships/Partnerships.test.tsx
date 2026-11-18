/**
 * DEV-02.1 — Gestão de Parcerias (PAG-OSC02 e consulta da PAG-OSC04) — Vitest + jsdom.
 * Auth, Firestore e API SIMULADOS (dados fictícios, sem rede). Regras de acesso reais
 * são verificadas no emulador (tests/rules/partnerships.rules.test.ts) e o cadastro no
 * servidor (tests/server/partnerships.server.test.ts).
 */
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { firestoreError } from '../../../../tests/support/fakeOrganizationsSdk.ts'
import { createFakePartnerships } from '../../../../tests/support/fakePartnerships.ts'
import { OSCS, USERS, memberDocument, memberPath } from '../../../../tests/support/organizationFixtures.ts'
import { PARTNERSHIPS } from '../../../../tests/support/partnershipFixtures.ts'
import { PERMISSION_USERS } from '../../../../tests/support/permissionFixtures.ts'
import { renderOscApp, type RenderOptions } from '../../../../tests/support/renderOscApp.tsx'
import { PartnershipsProvider } from '../../../components/PartnershipsProvider.tsx'
import { createPartnershipService } from '../../../services/partnerships/partnershipService.ts'
import { PartnershipForm, SAVE_FAILURE } from './PartnershipForm.tsx'
import type { ApiFailure } from '../../../services/partnerships/partnershipsApi.ts'

const originalMatchMedia = window.matchMedia
afterEach(() => {
  cleanup()
  window.location.hash = ''
  window.matchMedia = originalMatchMedia
})

const OPERATOR = PERMISSION_USERS.OPERATOR
const nav = () => screen.getByRole('navigation', { name: 'Navegação da Gestão da OSC' })
const title = () => screen.getByRole('heading', { level: 1 }).textContent
const contextText = () => screen.getByLabelText('Contexto atual').textContent ?? ''
const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
const rowNames = () => rows().map((r) => within(r).getByRole('rowheader').querySelector('span')?.textContent)
/** Chamadas distintas ao Firestore simulado (o StrictMode repete efeitos em desenvolvimento). */
const unique = (calls: string[]) => [...new Set(calls)]
const search = (value: string) => fireEvent.change(screen.getByLabelText('Localizar parcerias'), { target: { value } })

/** MULTI com a permissão de consulta em ALFA (administrador) e vínculo ATIVO em GAMA com a permissão. */
const multiWithAccess: RenderOptions['prepare'] = (db) => {
  db.docs.set(memberPath({ oscId: OSCS.ALFA.id, uid: USERS.MULTI.uid }), { ...db.docs.get(memberPath({ oscId: OSCS.ALFA.id, uid: USERS.MULTI.uid })), permissions: ['partnerships.view'] })
  db.docs.set(memberPath({ oscId: OSCS.GAMA.id, uid: USERS.MULTI.uid }), { ...memberDocument({ oscId: OSCS.GAMA.id, uid: USERS.MULTI.uid, status: 'active', specialRole: null }), permissions: ['partnerships.view'] })
}

async function openList(user = OPERATOR as Parameters<typeof renderOscApp>[0], options: RenderOptions = {}) {
  window.location.hash = '#/parcerias'
  const app = renderOscApp(user, options)
  if (user.uid === USERS.MULTI.uid) {
    fireEvent.change(await screen.findByLabelText('OSC selecionada'), { target: { value: OSCS.ALFA.id } })
  }
  return app
}

describe('Consulta e pesquisa (PAG-OSC02)', () => {
  it('DEV-02.1-T01 — lista as parcerias da OSC ativa, com identificação, vigência e situação', async () => {
    const { partnerships } = await openList()
    await screen.findByRole('table')
    expect(title()).toBe('Parcerias')
    expect(rowNames()).toEqual(['Termo de Colaboração 06/2026', 'Termo de Fomento 02/2026', 'Acordo de Cooperação 01/2026'])
    const fomento = rows()[1] as HTMLElement
    expect(within(fomento).getByText('01/03/2026 a 31/12/2027')).toBeTruthy()
    expect(within(fomento).getByText('Suspensa')).toBeTruthy()
    expect(within(rows()[0] as HTMLElement).getByText('Em execução')).toBeTruthy()
    expect(screen.getByRole('status', { name: '' }).textContent).toBe('3 parcerias')
    expect(unique(partnerships.calls)).toEqual(['list:osc-alfa:inicio'])
  })

  it('DEV-02.1-T02 — não lista parcerias de outra OSC (consulta só no caminho da OSC ativa)', async () => {
    const { partnerships } = await openList()
    await screen.findByRole('table')
    expect(document.body.textContent).not.toContain('09/2026')
    expect(document.body.textContent).not.toContain('exclusivo da OSC Gama')
    expect(partnerships.calls.every((c) => c.startsWith('list:osc-alfa:'))).toBe(true)
  })

  it('DEV-02.1-T03 — pesquisa por identificação do instrumento (sem acentos e sem caixa)', async () => {
    await openList()
    await screen.findByRole('table')
    search('fomento 02/2026')
    await waitFor(() => expect(rowNames()).toEqual(['Termo de Fomento 02/2026']))
    search('COLABORACAO')
    await waitFor(() => expect(rowNames()).toEqual(['Termo de Colaboração 06/2026']))
    expect(screen.getByRole('status', { name: '' }).textContent).toBe('1 de 3 parcerias')
  })

  it('DEV-02.1-T04 — pesquisa pelo objeto e pelo órgão público', async () => {
    await openList()
    await screen.findByRole('table')
    search('hortas comunitárias')
    await waitFor(() => expect(rowNames()).toEqual(['Termo de Fomento 02/2026']))
    search('fundação pública')
    await waitFor(() => expect(rowNames()).toEqual(['Acordo de Cooperação 01/2026']))
  })
})

describe('Seleção e contexto da parceria', () => {
  it('DEV-02.1-T05 — um clique seleciona e abre a Identificação da Parceria (PAG-OSC02 → PAG-OSC04)', async () => {
    await openList()
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar: Termo de Fomento 02/2026' }))
    await waitFor(() => expect(title()).toBe('Identificação da Parceria'))
    expect(window.location.hash).toBe('#/parcerias/pAlfaFomento02xxxxx')
    await screen.findByRole('heading', { name: 'Termo de Fomento 02/2026' })
    expect(contextText()).toContain('Parceria: Termo de Fomento 02/2026 · Suspensa')
    expect(screen.getByText('Fomento a hortas comunitárias urbanas.')).toBeTruthy()
    expect(screen.getByText('R$ 150.000,00')).toBeTruthy()
    expect(screen.getByText(/Aprovação declarada no cadastro\. Documento ainda não incorporado/)).toBeTruthy()
    // Sem botões inoperantes das ações não implementadas da PAG-OSC04.
    expect(screen.queryByRole('button', { name: /Registrar prorrogação|Arquivar|Atualizar dados|Consultar histórico/ })).toBeNull()
  })

  it('DEV-02.1-T06 — preserva a parceria selecionada entre as páginas', async () => {
    await openList(USERS.MULTI, { prepare: multiWithAccess })
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar: Acordo de Cooperação 01/2026' }))
    await screen.findByRole('heading', { name: 'Acordo de Cooperação 01/2026' })
    expect(screen.getByText(/Não se aplica: Acordo de Cooperação/)).toBeTruthy()
    fireEvent.click(within(nav()).getByRole('button', { name: 'Identificação da OSC' }))
    await waitFor(() => expect(title()).toBe('Identificação da OSC'))
    expect(contextText()).toContain('Parceria: Acordo de Cooperação 01/2026 · Arquivada')
    fireEvent.click(within(nav()).getByRole('button', { name: 'Usuários e permissões' }))
    await waitFor(() => expect(title()).toBe('Usuários e Permissões'))
    expect(contextText()).toContain('Parceria: Acordo de Cooperação 01/2026')
    fireEvent.click(within(nav()).getByRole('button', { name: 'Parcerias' }))
    await screen.findByRole('table', { name: /Parcerias formalizadas/ })
    const selected = screen.getByRole('button', { name: 'Selecionada: Acordo de Cooperação 01/2026' })
    expect(selected.getAttribute('aria-current')).toBe('true')
    fireEvent.click(within(nav()).getByRole('button', { name: 'Identificação da parceria' }))
    await screen.findByRole('heading', { name: 'Acordo de Cooperação 01/2026' })
  })

  it('DEV-02.1-T07 — trocar de OSC limpa a parceria, revalida e não expõe dados da OSC anterior', async () => {
    const { partnerships } = await openList(USERS.MULTI, { prepare: multiWithAccess })
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar: Termo de Colaboração 06/2026' }))
    await screen.findByRole('heading', { name: 'Termo de Colaboração 06/2026' })
    fireEvent.change(screen.getByLabelText('OSC selecionada'), { target: { value: OSCS.GAMA.id } })
    await waitFor(() => expect(window.location.hash).toBe('#/parcerias'))
    await waitFor(() => expect(rowNames()).toEqual(['Termo de Colaboração 09/2026']))
    expect(contextText()).toContain(OSCS.GAMA.name)
    expect(contextText()).toContain('Parceria: não selecionada')
    expect(within(nav()).queryByRole('button', { name: 'Identificação da parceria' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/06\/2026|Oficinas socioeducativas/)
    expect(partnerships.calls).toContain('list:osc-gama:inicio')
  })

  it('DEV-02.1-T08 — URL com parceria de outra OSC: não encontrada, sem dados e sem contexto', async () => {
    const gama = PARTNERSHIPS.find((p) => p.oscId === OSCS.GAMA.id)
    window.location.hash = `#/parcerias/${gama?.id ?? ''}`
    const { partnerships } = renderOscApp(OPERATOR)
    await screen.findByRole('heading', { name: 'Parceria não encontrada nesta OSC' })
    // Consultada SOMENTE sob a OSC ativa (ALFA): o caminho de GAMA nunca é lido.
    expect(unique(partnerships.calls)).toEqual([`get:osc-alfa/${gama?.id ?? ''}`])
    expect(document.body.textContent).not.toMatch(/09\/2026|exclusivo da OSC Gama/)
    expect(contextText()).toContain('Parceria: não selecionada')
    fireEvent.click(screen.getByRole('button', { name: 'Voltar às parcerias' }))
    await screen.findByRole('table')
  })

  it('DEV-02.1-T08 — identificadores manipulados (caminhos, codificação) não são consultados', async () => {
    window.location.hash = `#/parcerias/${encodeURIComponent('../../osc-gama/partnerships/x')}`
    const { partnerships } = renderOscApp(OPERATOR)
    await screen.findByRole('heading', { name: 'Parceria não encontrada nesta OSC' })
    expect(partnerships.calls).toEqual([])
  })
})

describe('Permissões, suspensão e cadastro bloqueado', () => {
  it('DEV-02.1-C01-T03 — sem partnerships.create: sem botão "Cadastrar parceria" e com orientação', async () => {
    await openList()
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: 'Cadastrar parceria' })).toBeNull()
    expect(screen.getByRole('note').textContent).toBe('Você pode consultar as parcerias desta organização, mas não possui autorização para cadastrá-las.')
  })

  it('DEV-02.1-T13 — administrador sem a permissão de consulta não vê parcerias (sem permissões implícitas)', async () => {
    const { partnerships } = await openList(USERS.MULTI)
    await screen.findByRole('heading', { name: 'Consulta de parcerias não autorizada' })
    expect(screen.getByText(/Solicite-a ao administrador da OSC ou a um delegado/)).toBeTruthy()
    expect(partnerships.calls).toEqual([])
  })

  it('DEV-02.1-T14 — suspensão comercial: administrador consulta; novos registros bloqueados com mensagem', async () => {
    await openList(USERS.MULTI, { suspendAlfa: true, prepare: multiWithAccess })
    await screen.findByRole('table')
    expect(screen.getByRole('note').textContent).toBe('A OSC está com a situação comercial suspensa. Novos registros estão bloqueados.')
    expect(screen.queryByRole('button', { name: 'Cadastrar parceria' })).toBeNull()
    expect(rowNames()).toHaveLength(3)
  })

  it('DEV-02.1-T14 — suspensão comercial: operador fica bloqueado (sem consulta)', async () => {
    const { partnerships } = await openList(OPERATOR, { suspendAlfa: true })
    await screen.findByRole('heading', { name: 'Acesso bloqueado: assinatura suspensa' })
    expect(screen.queryByRole('table')).toBeNull()
    expect(partnerships.calls).toEqual([])
  })
})

describe('Estados vazios, erros, paginação e responsividade', () => {
  it('DEV-02.1-T17 — OSC sem parcerias: estado vazio orientativo, sem botões inoperantes', async () => {
    await openList(OPERATOR, { partnerships: [] })
    expect(await screen.findByRole('heading', { name: 'Nenhuma parceria foi cadastrada para esta OSC.' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Cadastrar|Convidar|Selecionar/ })).toBeNull()
  })

  it('DEV-02.1-T17 — pesquisa sem resultados e falha de rede com nova tentativa', async () => {
    await openList()
    await screen.findByRole('table')
    search('inexistente xyz')
    expect(await screen.findByText('Nenhuma parceria corresponde à pesquisa. Revise os termos utilizados.')).toBeTruthy()
    cleanup()

    window.location.hash = '#/parcerias'
    const app = renderOscApp(OPERATOR)
    app.partnerships.failures.set('list', firestoreError('unavailable', 'detalhe interno projects/x'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Não foi possível comunicar com o servidor. Verifique a conexão e tente novamente.')
    expect(document.body.textContent).not.toContain('projects/x')
    app.partnerships.failures.delete('list')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await screen.findByRole('table')
    const before = app.partnerships.calls.length
    expect(before).toBeGreaterThanOrEqual(2) // falha + nova tentativa, sempre na OSC ativa
    expect(unique(app.partnerships.calls)).toEqual(['list:osc-alfa:inicio'])
  })

  it('DEV-02.1-T17 — negação pelas regras mostra mensagem específica', async () => {
    window.location.hash = '#/parcerias'
    const app = renderOscApp(OPERATOR)
    app.partnerships.failures.set('list', firestoreError('permission-denied'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/negada pelas regras de acesso/)
  })

  it('Paginação: carrega por páginas, sem ler todos os registros de uma vez', async () => {
    const { partnerships } = await openList(OPERATOR, { pageSize: 2 })
    await screen.findByRole('table')
    expect(rowNames()).toHaveLength(2)
    expect(screen.getByRole('status', { name: '' }).textContent).toBe('2 parcerias carregadas')
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais parcerias' }))
    await waitFor(() => expect(rowNames()).toHaveLength(3))
    expect(screen.queryByRole('button', { name: 'Carregar mais parcerias' })).toBeNull()
    expect(unique(partnerships.calls)).toEqual(['list:osc-alfa:inicio', 'list:osc-alfa:pAlfaFomento02xxxxx'])
  })

  it('DEV-02.1-T18 — largura estreita: cartões com seleção acessível; autenticação preservada', async () => {
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    await openList()
    const list = await screen.findByRole('list', { name: 'Parcerias formalizadas' })
    expect(screen.queryByRole('table')).toBeNull()
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    const button = within(list).getByRole('button', { name: 'Selecionar: Acordo de Cooperação 01/2026' })
    button.focus()
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    await screen.findByRole('heading', { name: 'Acordo de Cooperação 01/2026' })
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
    await screen.findByRole('button', { name: 'Entrar' })
  })

  it('DEV-02.1-T18 — tabela acessível: legenda, cabeçalhos de linha e nomes de ação com a parceria', async () => {
    await openList()
    const table = await screen.findByRole('table', { name: /Parcerias formalizadas de Associação Fictícia Alfa/ })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Parceria / instrumento', 'Vigência', 'Situação', 'Acesso'])
    expect(within(table).getAllByRole('rowheader')).toHaveLength(3)
  })
})

/** Concede permissões ao OPERADOR em ALFA no Firestore simulado. */
const operatorWith = (permissions: string[]): RenderOptions['prepare'] => (db) => {
  const path = memberPath({ oscId: OSCS.ALFA.id, uid: OPERATOR.uid })
  db.docs.set(path, { ...db.docs.get(path), permissions })
}

describe('DEV-02.1-C01 — cadastro real na interface (servidor simulado; autorização real em tests/server)', () => {
  it('DEV-02.1-C01-T02 — com create e view: cadastro em uma tela e acesso direto à identificação criada', async () => {
    const { partnerships } = await openList(OPERATOR, { prepare: operatorWith(['partnerships.view', 'partnerships.create']) })
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar parceria' }))
    expect(screen.getByText(/OSC proprietária:/).textContent).toContain(OSCS.ALFA.name)
    fillValid('Termo de Fomento', 'Suspensa')
    fill(/Valor global constante/, '150.000,00')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar parceria' }))
    await screen.findByRole('heading', { level: 2, name: 'Termo de Fomento 77/2026' })
    expect(title()).toBe('Identificação da Parceria')
    expect(contextText()).toContain('Parceria: Termo de Fomento 77/2026 · Suspensa')
    expect(partnerships.requests[0]?.draft).toMatchObject({ globalValueStatus: 'informed', globalValueCents: 15_000_000, administrativeStatus: 'suspensa' })
  })

  it('DEV-02.1-C01 — somente create: formulário disponível, lista oculta e confirmação sem conceder consulta', async () => {
    const { partnerships } = await openList(OPERATOR, { prepare: operatorWith(['partnerships.create']) })
    await screen.findByRole('heading', { name: 'Cadastro de parcerias' })
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar parceria' }))
    fillValid('Acordo de Cooperação', 'Encerrada')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar parceria' }))
    expect((await screen.findByRole('status')).textContent).toMatch(/Parceria cadastrada com sucesso\. Para consultá-la, é necessária a permissão/)
    expect(title()).toBe('Parcerias')
    expect(partnerships.calls).toEqual([]) // nenhuma consulta foi feita
  })

  it('DEV-02.1-C01-T04 — correção cadastral com edit: campos limitados, confirmação do servidor e revisão', async () => {
    window.location.hash = '#/parcerias/pAlfaColaboracao06'
    const { partnerships } = renderOscApp(OPERATOR, { prepare: operatorWith(['partnerships.view', 'partnerships.edit']) })
    await screen.findByRole('heading', { level: 2, name: 'Termo de Colaboração 06/2026' })
    fireEvent.click(screen.getByRole('button', { name: 'Corrigir dados cadastrais' }))
    expect(screen.queryByLabelText(/Término da vigência/)).toBeNull() // campos protegidos fora da correção
    expect(screen.queryByLabelText(/Valor global/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Objeto (descrição resumida)'), { target: { value: 'Objeto corrigido.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar correção' }))
    expect((await screen.findByRole('status')).textContent).toMatch(/Dados cadastrais corrigidos/)
    await screen.findByText('Objeto corrigido.')
    expect(partnerships.updates[0]).toMatchObject({ expectedRevision: 1, changes: { object: 'Objeto corrigido.' } })
  })

  it('DEV-02.1-C01-T05 — somente create (com view): sem correção cadastral', async () => {
    window.location.hash = '#/parcerias/pAlfaColaboracao06'
    renderOscApp(OPERATOR, { prepare: operatorWith(['partnerships.view', 'partnerships.create']) })
    await screen.findByRole('heading', { level: 2, name: 'Termo de Colaboração 06/2026' })
    expect(screen.queryByRole('button', { name: 'Corrigir dados cadastrais' })).toBeNull()
  })

  it('DEV-02.1-C01-T16 — parceria arquivada: identificada, consulta preservada, correção bloqueada', async () => {
    window.location.hash = '#/parcerias/pAlfaCooperacao01xx'
    renderOscApp(OPERATOR, { prepare: operatorWith(['partnerships.view', 'partnerships.edit']) })
    await screen.findByRole('heading', { level: 2, name: 'Acordo de Cooperação 01/2026' })
    expect(screen.getByRole('note', { name: '' }).textContent).toMatch(/Parceria arquivada\..*desarquivamento compete exclusivamente à Administração da Plataforma/)
    expect(screen.queryByRole('button', { name: 'Corrigir dados cadastrais' })).toBeNull()
    expect(screen.getAllByText('Arquivada').length).toBeGreaterThan(0)
  })

  it('Correção concorrente: aviso, dados recarregados e valores digitados mantidos', async () => {
    window.location.hash = '#/parcerias/pAlfaColaboracao06'
    const { partnerships } = renderOscApp(OPERATOR, { prepare: operatorWith(['partnerships.view', 'partnerships.edit']) })
    await screen.findByRole('heading', { level: 2, name: 'Termo de Colaboração 06/2026' })
    fireEvent.click(screen.getByRole('button', { name: 'Corrigir dados cadastrais' }))
    partnerships.docs.set('oscs/osc-alfa/partnerships/pAlfaColaboracao06', { ...partnerships.docs.get('oscs/osc-alfa/partnerships/pAlfaColaboracao06'), revision: 2 })
    fireEvent.change(screen.getByLabelText('Objeto (descrição resumida)'), { target: { value: 'Minha correção.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar correção' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/alterada por outra pessoa/)
    expect((screen.getByLabelText('Objeto (descrição resumida)') as HTMLTextAreaElement).value).toBe('Minha correção.')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar correção' }))
    await waitFor(() => expect(partnerships.updates.at(-1)?.expectedRevision).toBe(2))
  })
})

function fill(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}
function fillValid(instrument: string, status = 'Em execução') {
  fireEvent.click(screen.getByRole('radio', { name: instrument }))
  fill(/Número ou identificação/, '77/2026')
  fill(/Órgão ou entidade pública/, 'Secretaria Fictícia')
  fill(/^Objeto/, 'Oficinas.')
  fill(/Data de formalização/, '2026-02-20')
  fill(/Início da vigência/, '2026-03-01')
  fill(/Término da vigência/, '2028-02-28')
  fireEvent.click(screen.getByRole('radio', { name: status }))
  fireEvent.click(screen.getByRole('checkbox', { name: /Declaro que o instrumento/ }))
}

describe('Formulário de cadastro (DEV-02.1-C01)', () => {
  function renderForm(respond?: Parameters<ReturnType<typeof createFakePartnerships>['respondWith']>[0]) {
    const fake = createFakePartnerships([])
    if (respond) fake.respondWith(respond)
    const created: string[] = []
    render(
      <StrictMode>
        <PartnershipsProvider value={{ service: createPartnershipService(fake.db, fake.sdk), api: fake.api }}>
          <PartnershipForm oscId={OSCS.ALFA.id} oscName={OSCS.ALFA.name} today="2026-11-17" onCancel={() => undefined} onCreated={(id) => created.push(id)} />
        </PartnershipsProvider>
      </StrictMode>,
    )
    return { fake, created }
  }

  it('DEV-02.1-C01-T10/T11/T12 — TC/TF: valor informado ou "não informado" (≠ zero); AC sem campo de valor', async () => {
    const { fake } = renderForm()
    fillValid('Termo de Colaboração')
    fireEvent.click(screen.getByRole('checkbox', { name: /Valor global não informado/ }))
    expect((screen.getByLabelText(/Valor global constante/) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar parceria' }))
    await waitFor(() => expect(fake.requests).toHaveLength(1))
    expect(fake.requests[0]?.draft).toMatchObject({ instrument: 'termo-colaboracao', globalValueStatus: 'not-informed', globalValueCents: null })
    cleanup()
    const second = renderForm()
    fillValid('Acordo de Cooperação')
    expect(screen.queryByLabelText(/Valor global constante/)).toBeNull()
    expect(screen.getByRole('note').textContent).toMatch(/sem transferência de recursos financeiros/)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar parceria' }))
    await waitFor(() => expect(second.fake.requests).toHaveLength(1))
    expect(second.fake.requests[0]?.draft).toMatchObject({ globalValueStatus: 'not-applicable', globalValueCents: null })
  })

  it('DEV-02.1-C01-T13/T17/T18 — vigência encerrada e datas históricas com avisos, sem bloqueio; situação escolhida', async () => {
    const { fake } = renderForm()
    fillValid('Acordo de Cooperação', 'Em execução')
    fill(/Data de formalização/, '2015-10-01')
    fill(/Início da vigência/, '2015-09-01')
    fill(/Término da vigência/, '2017-08-31')
    expect(screen.getByText(/Formalização anterior a 23\/01\/2016/)).toBeTruthy()
    expect(screen.getByText(/Início da vigência anterior à formalização/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar parceria' }))
    await waitFor(() => expect(fake.requests).toHaveLength(1))
    expect(fake.requests[0]?.draft).toMatchObject({ termEnd: '2017-08-31', administrativeStatus: 'em-execucao' })
  })

  it('DEV-02.1-C01-T15/T16 — situação obrigatória e sem padrão; orientação para arquivada', async () => {
    const { fake } = renderForm()
    expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar parceria' }))
    const summary = await screen.findByRole('alert')
    expect(summary.textContent).toMatch(/Selecione a situação administrativa efetiva da parceria/)
    fireEvent.click(screen.getByRole('radio', { name: 'Arquivada' }))
    expect(screen.getByText(/novos registros bloqueados; desarquivar só pela Administração da Plataforma/)).toBeTruthy()
    expect(fake.requests).toHaveLength(0)
  })

  it('DEV-02.1-C01-T19 — possível duplicidade: aviso com dados e confirmação explícita (mesmo pedido)', async () => {
    let calls = 0
    const { fake, created } = renderForm((request) => {
      calls += 1
      if (!request.acknowledgeDuplicates) {
        return {
          ok: false,
          error: 'possible-duplicate',
          duplicates: { count: 1, candidates: [{ id: 'p1', title: 'Termo de Fomento 77/2026', publicPartner: 'Secretaria Fictícia', formalizationDate: '2026-02-20', termStart: '2026-03-01', termEnd: '2028-02-28', administrativeStatus: 'em-execucao', sameDates: true }] },
        } satisfies ApiFailure
      }
      return { ok: true, id: 'nova', created: true, warnings: {} }
    })
    fillValid('Termo de Fomento')
    fireEvent.click(screen.getByRole('checkbox', { name: /Valor global não informado/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar parceria' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Possível duplicidade/)
    expect(alert.textContent).toMatch(/provável recadastramento do mesmo instrumento/)
    expect(created).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cadastro de instrumento distinto' }))
    await waitFor(() => expect(created).toEqual(['nova']))
    expect(calls).toBe(2)
    expect(fake.requests[1]?.acknowledgeDuplicates).toBe(true)
    expect(fake.requests[1]?.requestId).toBe(fake.requests[0]?.requestId)
  })

  it('DEV-02.1-C01-T20 — envio duplicado bloqueado; falha de rede mantém os dados; nova tentativa com o mesmo pedido', async () => {
    let release!: () => void
    const { fake, created } = renderForm(() => new Promise((resolve) => (release = () => resolve({ ok: false, error: 'network' }))))
    fillValid('Termo de Fomento')
    fill(/Valor global constante/, '150.000,00')
    const save = screen.getByRole('button', { name: 'Salvar parceria' })
    fireEvent.click(save)
    fireEvent.click(save)
    fireEvent.submit(save.closest('form') as HTMLFormElement)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvando…' })).toBeTruthy())
    expect(fake.requests).toHaveLength(1)
    await act(async () => release())
    expect((await screen.findByRole('alert')).textContent).toBe(`${SAVE_FAILURE} Verifique a conexão e tente novamente: os dados preenchidos foram mantidos.`)
    expect((screen.getByLabelText(/Número ou identificação/) as HTMLInputElement).value).toBe('77/2026')
    expect(created).toEqual([])
    fake.respondWith(() => ({ ok: true, id: 'nova-parceria', created: true, warnings: {} }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar parceria' }))
    await waitFor(() => expect(created).toEqual(['nova-parceria']))
    expect(fake.requests[1]?.requestId).toBe(fake.requests[0]?.requestId)
  })

  it('DEV-02.1-C01-T21/T22 — negações do servidor nunca são tratadas como sucesso', async () => {
    const { created } = renderForm(() => ({ ok: false, error: 'forbidden', reason: 'commercial-suspension' }))
    fillValid('Acordo de Cooperação')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar parceria' }))
    expect((await screen.findByRole('alert')).textContent).toBe('A OSC está com a situação comercial suspensa. Novos registros estão bloqueados.')
    expect(created).toEqual([])
  })

  it('Formulário inválido: resumo, mensagens associadas aos campos e erros devolvidos pelo servidor', async () => {
    const { fake } = renderForm(() => ({ ok: false, error: 'invalid-draft', fields: { termEnd: 'end-before-start' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar parceria' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Corrija 9 campos antes de salvar/)
    const number = screen.getByLabelText(/Número ou identificação/)
    expect(number.getAttribute('aria-invalid')).toBe('true')
    expect(number.getAttribute('aria-describedby')).toMatch(/error/)
    expect(fake.requests).toHaveLength(0)
    fillValid('Acordo de Cooperação')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar parceria' }))
    expect(await screen.findByText('O término da vigência não pode ser anterior ao início.', { selector: 'p' })).toBeTruthy()
  })
})
