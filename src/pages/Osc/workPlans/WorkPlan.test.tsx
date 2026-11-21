/**
 * DEV-02.2 — PAG-OSC05 Plano de Trabalho (Vitest + jsdom). Auth, Firestore e API SIMULADOS.
 * A autorização real e a gravação são testadas em tests/server/workPlans.server.test.ts e as
 * regras de leitura em tests/rules; aqui se verifica a interface.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { memberDocument, memberPath, OSCS, USERS } from '../../../../tests/support/organizationFixtures.ts'
import { PERMISSION_USERS } from '../../../../tests/support/permissionFixtures.ts'
import { renderOscApp, type RenderOptions } from '../../../../tests/support/renderOscApp.tsx'
import { categoryData, goalData, indicatorData, itemData } from '../../../../tests/support/workPlanFixtures.ts'

const originalMatchMedia = window.matchMedia
afterEach(() => {
  cleanup()
  window.location.hash = ''
  // Um teste de responsividade simula tela estreita: restaurado para não vazar para os demais.
  window.matchMedia = originalMatchMedia
})

const OP = PERMISSION_USERS.OPERATOR
const ALFA = OSCS.ALFA.id
const RUNNING = 'pAlfaColaboracao06'
const nav = () => screen.getByRole('navigation', { name: 'Navegação da Gestão da OSC' })
const title = () => screen.getByRole('heading', { level: 1 }).textContent
const contextText = () => screen.getByLabelText('Contexto atual').textContent ?? ''
const withPermissions = (permissions: string[], extra?: RenderOptions['prepare']): RenderOptions['prepare'] => (db) => {
  const path = memberPath({ oscId: ALFA, uid: OP.uid })
  db.docs.set(path, { ...db.docs.get(path), permissions })
  extra?.(db)
}
const ALL = ['partnerships.view', 'work-plan.view', 'work-plan.edit'] // DEC-PT-001: edit inclui a finalização
const informed = (value: string | number) => ({ state: 'informed', value }) as const
const REQUIRED = { approvalDate: informed('2026-02-10'), executionStart: informed('2026-03-01'), executionEnd: informed('2028-02-28') }

function openPlan(options: RenderOptions = {}, partnershipId = RUNNING, user: Parameters<typeof renderOscApp>[0] = OP) {
  window.location.hash = `#/parcerias/${partnershipId}/plano`
  return renderOscApp(user, options)
}
const fill = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
/** DEC-PT-007: conferência explícita — escolhe a situação de metas e de indicadores (com justificativa quando exigida). */
async function confer(goals = 'Inexistentes no Plano aprovado', indicators = goals) {
  const groups = await screen.findAllByRole('group', { name: /^(Metas|Indicadores) do Plano aprovado/ })
  groups.forEach((g, n) => {
    const choice = n === 0 ? goals : indicators
    fireEvent.click(within(g).getByRole('radio', { name: choice }))
    const j = within(g).queryByLabelText(/Justificativa/)
    if (j) fireEvent.change(j, { target: { value: 'O Plano aprovado não contém este componente.' } })
  })
}
/** Declaração de correspondência na confirmação e envio. */
function declareAndConfirm(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Declaro que as metas e os indicadores registrados/ }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Finalizar cadastro' }))
}

describe('Consulta e situação do cadastro', () => {
  it('DEV-02.2-T01/T03 — Plano não estruturado: orientação; dados da parceria como fonte autoritativa', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(['partnerships.view', 'work-plan.view']) })
    expect(await screen.findByRole('heading', { name: 'Plano de Trabalho aprovado ainda não registrado' })).toBeTruthy()
    expect(title()).toBe('Plano de Trabalho')
    expect(screen.getByText('Cadastro no SIGOSC: Não estruturado')).toBeTruthy()
    expect(screen.getByText('Oficinas socioeducativas no contraturno escolar.')).toBeTruthy() // objeto vem da parceria
    expect(screen.getByText(/Não armazenado no SIGOSC: o armazenamento documental ainda não está disponível/)).toBeTruthy()
    expect(screen.getByText('Você pode consultar o Plano, mas não possui autorização para registrá-lo.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Iniciar cadastro/ })).toBeNull()
    expect(contextText()).toContain('Parceria: Termo de Colaboração 06/2026 · Em execução')
    expect([...new Set(workPlans.reads)]).toEqual([`${ALFA}/${RUNNING}`])
  })

  it('DEV-02.2-T03 — Plano em cadastramento e finalizado são diferenciados', async () => {
    openPlan({ prepare: withPermissions(['partnerships.view', 'work-plan.view']), workPlans: [{ oscId: ALFA, partnershipId: RUNNING, values: REQUIRED }] })
    expect(await screen.findByText('Cadastro no SIGOSC: Em cadastramento')).toBeTruthy()
    expect(screen.getByText('10/02/2026')).toBeTruthy()
    expect(screen.getAllByText('Não informado').length).toBeGreaterThan(0)
    cleanup()
    openPlan({ prepare: withPermissions(['partnerships.view', 'work-plan.view']), workPlans: [{ oscId: ALFA, partnershipId: RUNNING, values: REQUIRED, status: 'finalized' }] })
    expect(await screen.findByText('Cadastro no SIGOSC: Estruturado e finalizado internamente')).toBeTruthy()
    expect(screen.getByText(/Cadastro finalizado internamente em .* não representa aprovação jurídica/)).toBeTruthy()
  })

  it('Sem work-plan.view: dados da parceria visíveis, Plano não consultado', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(['partnerships.view', 'work-plan.edit']) })
    expect(await screen.findByText(/não possui a permissão “Consultar Planos de Trabalho”/)).toBeTruthy()
    expect(workPlans.reads).toEqual([])
  })

  it('DEV-02.2-T02 — URL com parceria de outra OSC: não encontrada, nenhum Plano lido', async () => {
    const { workPlans, partnerships } = openPlan({ prepare: withPermissions(ALL) }, 'pGamaColaboracao09x')
    await screen.findByRole('heading', { name: 'Parceria não encontrada nesta OSC' })
    expect([...new Set(partnerships.calls)]).toEqual([`get:${ALFA}/pGamaColaboracao09x`])
    expect(workPlans.reads).toEqual([])
    expect(document.body.textContent).not.toMatch(/09\/2026/)
  })
})

describe('Cadastro estruturado', () => {
  it('DEV-02.2-T04/T06/T07/T08 — iniciar, preencher por seções e salvar estados distintos sem repetir dados da parceria', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(ALL) })
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar cadastro estruturado' }))
    await screen.findByRole('heading', { name: 'Cadastro estruturado do Plano aprovado' })
    expect(screen.getByText('Cadastro no SIGOSC: Em cadastramento')).toBeTruthy()
    fill(/Data da aprovação pelo órgão público/, '2026-02-10')
    fill(/Início do período de execução/, '2026-03-01')
    fill(/Término do período de execução/, '2028-02-28')
    fill(/Quantidade estimada de beneficiários/, '0')
    const audience = screen.getByLabelText('Público atendido').closest('div') as HTMLElement
    fireEvent.click(within(audience).getByRole('checkbox', { name: 'Não se aplica' }))
    expect((screen.getByLabelText('Público atendido') as HTMLInputElement).disabled).toBe(true)
    fill(/Justificativa e contextualização/, 'Atendimento a famílias.')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    expect((await screen.findByText('Alterações salvas e confirmadas pelo servidor.')).getAttribute('role')).toBe('status')
    const update = workPlans.calls.find((c) => c.kind === 'update')?.request
    expect(update?.changes).toEqual({ ...REQUIRED, estimatedBeneficiaries: informed(0), targetAudience: { state: 'not-applicable' }, justification: informed('Atendimento a famílias.') })
    expect(Object.keys(update?.changes as object)).not.toContain('object') // T08
    expect(update?.expectedRevision).toBe(1)
  })

  it('DEV-02.2-T05 — validação próxima ao campo: data futura e período incoerente; nada enviado', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(ALL), workPlans: [{ oscId: ALFA, partnershipId: RUNNING }] })
    await screen.findByRole('heading', { name: 'Cadastro estruturado do Plano aprovado' })
    fill(/Data da aprovação pelo órgão público/, '2999-01-01')
    fill(/Início do período de execução/, '2026-03-01')
    fill(/Término do período de execução/, '2026-02-01')
    fill(/Quantidade estimada de beneficiários/, '-3')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Revise os campos indicados/)
    expect(screen.getByText('A data da aprovação não pode ser futura.')).toBeTruthy()
    expect(screen.getByText('O término do período de execução não pode ser anterior ao início.')).toBeTruthy()
    expect(screen.getByText('Informe um número inteiro igual ou maior que zero.')).toBeTruthy()
    expect(screen.getByLabelText(/Data da aprovação/).getAttribute('aria-describedby')).toMatch(/error/)
    expect(workPlans.calls.filter((c) => c.kind === 'update')).toHaveLength(0)
  })

  it('DEV-02.2-T09/T17 — falha de rede mantém os dados; cliques repetidos não duplicam o envio', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(ALL), workPlans: [{ oscId: ALFA, partnershipId: RUNNING }] })
    await screen.findByRole('heading', { name: 'Cadastro estruturado do Plano aprovado' })
    let release!: () => void
    workPlans.respondWith((call) => (call.kind === 'update' ? new Promise((resolve) => (release = () => resolve({ ok: false, error: 'network' }))) : undefined))
    fill(/Justificativa e contextualização/, 'Texto que não pode se perder.')
    const save = screen.getByRole('button', { name: 'Salvar alterações' })
    fireEvent.click(save)
    fireEvent.click(save)
    fireEvent.submit(save.closest('form') as HTMLFormElement)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvando…' })).toBeTruthy())
    expect(workPlans.calls.filter((c) => c.kind === 'update')).toHaveLength(1)
    await act(async () => release())
    expect((await screen.findByRole('alert')).textContent).toMatch(/os dados digitados foram mantidos/)
    expect((screen.getByLabelText(/Justificativa e contextualização/) as HTMLTextAreaElement).value).toBe('Texto que não pode se perder.')
  })

  it('DEV-02.2-T16 — alteração concorrente: aviso, recarga e valores digitados mantidos', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(ALL), workPlans: [{ oscId: ALFA, partnershipId: RUNNING }] })
    await screen.findByRole('heading', { name: 'Cadastro estruturado do Plano aprovado' })
    const path = `oscs/${ALFA}/partnerships/${RUNNING}/workPlans/original`
    workPlans.docs.set(path, { ...workPlans.docs.get(path), revision: 2 })
    fill(/Forma de execução/, 'Minha alteração.')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/alterado por outra pessoa/)
    await waitFor(() => expect((screen.getByLabelText(/Forma de execução/) as HTMLInputElement).value).toBe('Minha alteração.'))
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar alterações' })) // reabilitado após a recarga
    await waitFor(() => expect(workPlans.calls.filter((c) => c.kind === 'update').at(-1)?.request.expectedRevision).toBe(2))
    expect(workPlans.calls.filter((c) => c.kind === 'update' && c.request.expectedRevision === 1)).toHaveLength(1)
  })
})

describe('Finalização interna', () => {
  it('DEV-02.2-T18 — pendências bloqueiam; confirmação proporcional; finaliza e preserva (T19)', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(ALL), workPlans: [{ oscId: ALFA, partnershipId: RUNNING }] })
    await screen.findByRole('heading', { name: 'Conferência para finalização interna' })
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Pendências' })).getAllByRole('listitem')).toHaveLength(5)) // 3 do Plano + conferência de metas e de indicadores
    expect((screen.getByRole('button', { name: 'Finalizar cadastro' }) as HTMLButtonElement).disabled).toBe(true)
    fill(/Data da aprovação pelo órgão público/, '2026-02-10')
    fill(/Início do período de execução/, '2026-03-01')
    fill(/Término do período de execução/, '2028-02-28')
    expect(screen.getByText('Salve as alterações antes de finalizar.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await screen.findByText('Alterações salvas e confirmadas pelo servidor.')
    await confer()
    await screen.findByText('Os requisitos para a finalização estão atendidos.')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Finalizar cadastro' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar cadastro' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Confirmar finalização interna' })
    expect(dialog.textContent).toMatch(/será preservado.*não representa aprovação jurídica/)
    expect((within(dialog).getByRole('button', { name: 'Finalizar cadastro' }) as HTMLButtonElement).disabled).toBe(true) // declaração obrigatória
    expect(workPlans.calls.filter((c) => c.kind === 'finalize')).toHaveLength(0) // nada antes da confirmação
    declareAndConfirm(dialog)
    expect((await screen.findByText(/Cadastro finalizado internamente e preservado/)).getAttribute('role')).toBe('status')
    await screen.findByText('Cadastro no SIGOSC: Estruturado e finalizado internamente')
    expect(workPlans.calls.find((c) => c.kind === 'finalize')?.request).toMatchObject({ expectedRevision: 2, declaration: true, review: { goals: { status: 'none-in-document' }, indicators: { status: 'none-in-document' } } })
    // T19/T20: sem edição nem nova finalização após finalizar.
    expect(screen.queryByRole('button', { name: 'Salvar alterações' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Finalizar cadastro' })).toBeNull()
    expect(screen.getByText('10/02/2026')).toBeTruthy()
  })

  it('DEV-02.2-C01-T04/T05/T07 — work-plan.finalize (descontinuada) ou só view: sem edição nem finalização', async () => {
    openPlan({ prepare: withPermissions(['partnerships.view', 'work-plan.view', 'work-plan.finalize']), workPlans: [{ oscId: ALFA, partnershipId: RUNNING, values: REQUIRED }] })
    await screen.findByRole('heading', { name: 'Conferência para finalização interna' })
    expect(screen.queryByRole('button', { name: 'Finalizar cadastro' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Salvar alterações' })).toBeNull()
    expect(screen.getByText(/A finalização interna exige a permissão “Registrar, finalizar e corrigir o Plano de Trabalho”/)).toBeTruthy()
  })

  it('DEV-02.2-T20 / C01-T09 — registro finalizado: sem edição comum; só a correção de erro material', async () => {
    openPlan({ prepare: withPermissions(ALL), workPlans: [{ oscId: ALFA, partnershipId: RUNNING, values: REQUIRED, status: 'finalized' }] })
    await screen.findByRole('heading', { name: 'Plano de Trabalho estruturado' })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Salvar|Finalizar|Iniciar/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Corrigir erro material' })).toBeTruthy()
  })
})

const FINAL = { oscId: ALFA, partnershipId: RUNNING, values: REQUIRED, status: 'finalized' as const, revision: 3 }
async function openCorrection(options: RenderOptions = {}) {
  const app = openPlan({ prepare: withPermissions(ALL), workPlans: [FINAL], ...options })
  fireEvent.click(await screen.findByRole('button', { name: 'Corrigir erro material' }))
  await screen.findByRole('heading', { name: 'Corrigir erro material' })
  return app
}
const pick = (label: string) => fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(`^${label} — registrado:`) }))
const reason = (text: string) => fireEvent.change(screen.getByLabelText(/Justificativa da correção/), { target: { value: text } })
const declare = () => fireEvent.click(screen.getByRole('checkbox', { name: /Declaro que esta correção corresponde/ }))

describe('Correção de erro material (DEC-PT-002)', () => {
  it('DEV-02.2-C01-T10/T13/T15 — corrige um ou mais campos com revisão anterior → corrigido; Plano continua finalizado; histórico atualizado', async () => {
    const { workPlans } = await openCorrection()
    expect(screen.getByText('Nenhuma correção material registrada.')).toBeTruthy()
    pick('Data da aprovação pelo órgão público')
    fireEvent.change(screen.getByLabelText('Valor correto: Data da aprovação pelo órgão público'), { target: { value: '2026-02-15' } })
    pick('Quantidade estimada de beneficiários')
    fireEvent.change(screen.getByLabelText('Valor correto: Quantidade estimada de beneficiários'), { target: { value: '0' } })
    reason('Data transcrita incorretamente do Plano aprovado.')
    declare()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar correção' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Confirmar correção de erro material' })
    expect(within(dialog).getByRole('list', { name: 'Alterações a confirmar' }).textContent).toMatch(/10\/02\/2026 → 15\/02\/2026.*Não informado → 0/)
    expect(workPlans.calls.filter((c) => c.kind === 'correct')).toHaveLength(0) // nada antes da confirmação
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar correção' }))
    expect((await screen.findByText(/Correção de erro material registrada/)).getAttribute('role')).toBe('status')
    const request = workPlans.calls.find((c) => c.kind === 'correct')?.request
    expect(request).toMatchObject({ expectedRevision: 3, declaration: true, justification: 'Data transcrita incorretamente do Plano aprovado.', changes: { approvalDate: { state: 'informed', value: '2026-02-15' }, estimatedBeneficiaries: { state: 'informed', value: 0 } } })
    const history = await screen.findByRole('list', { name: 'Correções materiais em ordem cronológica' })
    expect(history.textContent).toMatch(/Anterior: 10\/02\/2026 · Corrigido: 15\/02\/2026/)
    expect(history.textContent).toMatch(/Anterior: Não informado · Corrigido: 0/)
    expect(history.textContent).toMatch(/por você/)
    expect(screen.getByText('Cadastro no SIGOSC: Estruturado e finalizado internamente')).toBeTruthy()
    await waitFor(() => expect(screen.getAllByText('15/02/2026').length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: 'Salvar alterações' })).toBeNull()
  })

  it('DEV-02.2-C01-T11/T12 — justificativa, declaração e alteração efetiva exigidas; nada enviado', async () => {
    const { workPlans } = await openCorrection()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar correção' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Selecione ao menos um campo a corrigir.')
    pick('Data da aprovação pelo órgão público') // valor idêntico ao registrado
    reason('   ')
    fireEvent.click(screen.getByRole('button', { name: 'Revisar correção' }))
    await waitFor(() => expect(screen.getByText('Nenhum valor foi efetivamente alterado.')).toBeTruthy())
    expect(screen.getByText('Informe a justificativa da correção.')).toBeTruthy()
    expect(screen.getByText('Confirme a declaração de correspondência ao Plano aprovado.')).toBeTruthy()
    expect(screen.getByLabelText(/Justificativa da correção/).getAttribute('aria-describedby')).toMatch(/error/)
    fireEvent.change(screen.getByLabelText('Valor correto: Data da aprovação pelo órgão público'), { target: { value: '' } })
    reason('Campo obrigatório apagado por engano.')
    declare()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar correção' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/deixaria o Plano sem os requisitos da finalização/)
    expect(workPlans.calls.filter((c) => c.kind === 'correct')).toHaveLength(0)
  })

  it('Falha de rede mantém os dados; conflito de revisão recarrega sem perder o que foi digitado', async () => {
    const { workPlans } = await openCorrection()
    workPlans.respondWith((call) => (call.kind === 'correct' ? { ok: false, error: 'network' } : undefined))
    pick('Forma de execução')
    fireEvent.change(screen.getByLabelText('Valor correto: Forma de execução'), { target: { value: 'Execução direta.' } })
    reason('Campo omitido na transcrição do Plano.')
    declare()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar correção' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar correção' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/os dados informados foram mantidos/)
    expect((screen.getByLabelText('Valor correto: Forma de execução') as HTMLInputElement).value).toBe('Execução direta.')
    workPlans.respondWith(null)
    const path = `oscs/${ALFA}/partnerships/${RUNNING}/workPlans/original`
    workPlans.docs.set(path, { ...workPlans.docs.get(path), revision: 4 })
    fireEvent.click(screen.getByRole('button', { name: 'Revisar correção' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar correção' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/alterado por outra pessoa/)
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar correção' })) // reabilitado após a recarga
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar correção' }))
    await screen.findByText(/Correção de erro material registrada/)
    expect(workPlans.calls.filter((c) => c.kind === 'correct').map((c) => c.request.expectedRevision)).toEqual([3, 3, 4])
  })

  it('DEV-02.2-C01-T05/T18/T19 — só view: histórico sem ação; arquivada: sem correção; erro do histórico com nova tentativa', async () => {
    openPlan({ prepare: withPermissions(['partnerships.view', 'work-plan.view']), workPlans: [FINAL] })
    await screen.findByRole('heading', { name: 'Histórico de correções materiais' })
    expect(screen.queryByRole('button', { name: 'Corrigir erro material' })).toBeNull()
    cleanup()
    openPlan({ prepare: withPermissions(ALL), workPlans: [{ ...FINAL, partnershipId: 'pAlfaCooperacao01xx' }] }, 'pAlfaCooperacao01xx')
    await screen.findByRole('heading', { name: 'Histórico de correções materiais' })
    expect(screen.queryByRole('button', { name: 'Corrigir erro material' })).toBeNull()
    cleanup()
    const app = openPlan({ prepare: withPermissions(ALL), workPlans: [FINAL] })
    app.workPlans.respondWith((call) => (call.kind === 'history' ? { ok: false, error: 'network' } : undefined))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Não foi possível consultar o histórico/)
    app.workPlans.respondWith(null)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText('Nenhuma correção material registrada.')).toBeTruthy()
  })

  it('DEV-02.2-C01-T20 — parceria administrativamente suspensa: correção disponível', async () => {
    openPlan({ prepare: withPermissions(ALL), workPlans: [{ ...FINAL, partnershipId: 'pAlfaFomento02xxxxx' }] }, 'pAlfaFomento02xxxxx')
    expect(await screen.findByRole('button', { name: 'Corrigir erro material' })).toBeTruthy()
  })
})

describe('Restrições, contexto e responsividade', () => {
  it('DEV-02.2-T10 — sem permissão de registro: sem botões de gravação', async () => {
    openPlan({ prepare: withPermissions(['partnerships.view', 'work-plan.view']), workPlans: [{ oscId: ALFA, partnershipId: RUNNING }] })
    await screen.findByRole('heading', { name: 'Plano de Trabalho estruturado' })
    expect(screen.getByText('Você pode consultar o cadastro, mas não possui autorização para alterá-lo.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Salvar|Iniciar/ })).toBeNull()
  })

  it('DEV-02.2-T11 — suspensão comercial: administrador consulta, gravações bloqueadas com mensagem', async () => {
    openPlan(
      {
        suspendAlfa: true,
        prepare: (db) => {
          const path = memberPath({ oscId: ALFA, uid: USERS.MULTI.uid })
          db.docs.set(path, { ...db.docs.get(path), permissions: ALL })
        },
      },
      RUNNING,
      USERS.MULTI,
    )
    fireEvent.change(await screen.findByLabelText('OSC selecionada'), { target: { value: ALFA } })
    expect(await screen.findByText('A OSC está com a situação comercial suspensa. Novos registros estão bloqueados.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Iniciar cadastro estruturado' })).toBeNull()
  })

  it('DEV-02.2-T12 — parceria arquivada: Plano somente para consulta', async () => {
    openPlan({ prepare: withPermissions(ALL), workPlans: [{ oscId: ALFA, partnershipId: 'pAlfaCooperacao01xx' }] }, 'pAlfaCooperacao01xx')
    await screen.findByRole('heading', { name: 'Plano de Trabalho estruturado' })
    expect(screen.getAllByText(/Plano de Trabalho está disponível somente para consulta/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Salvar|Finalizar/ })).toBeNull()
    expect(screen.getByText(/Planejamento financeiro/).closest('div')?.textContent).toMatch(/Não se aplica: Acordo de Cooperação/)
  })

  it('DEV-02.2-T13 — parceria administrativamente suspensa: operações autorizadas disponíveis', async () => {
    openPlan({ prepare: withPermissions(ALL) }, 'pAlfaFomento02xxxxx')
    expect(await screen.findByRole('button', { name: 'Iniciar cadastro estruturado' })).toBeTruthy()
    expect(contextText()).toContain('· Suspensa')
  })

  it('Integração PAG-OSC04 → PAG-OSC05 com um clique e contexto preservado', async () => {
    window.location.hash = `#/parcerias/${RUNNING}`
    renderOscApp(OP, { prepare: withPermissions(ALL) })
    await screen.findByRole('heading', { level: 2, name: 'Termo de Colaboração 06/2026' })
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Páginas da parceria' })).getByRole('button', { name: 'Plano de Trabalho' }))
    await waitFor(() => expect(title()).toBe('Plano de Trabalho'))
    expect(window.location.hash).toBe(`#/parcerias/${RUNNING}/plano`)
    expect(within(nav()).getByRole('button', { name: 'Plano de Trabalho' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(within(nav()).getByRole('button', { name: 'Identificação da parceria' }))
    await screen.findByRole('heading', { level: 2, name: 'Termo de Colaboração 06/2026' })
  })

  it('DEV-02.2-T21 — trocar de OSC limpa a parceria e o Plano, voltando à lista', async () => {
    const prepare: RenderOptions['prepare'] = (db) => {
      const path = memberPath({ oscId: ALFA, uid: USERS.MULTI.uid })
      db.docs.set(path, { ...db.docs.get(path), permissions: ALL })
      db.docs.set(memberPath({ oscId: OSCS.GAMA.id, uid: USERS.MULTI.uid }), { ...memberDocument({ oscId: OSCS.GAMA.id, uid: USERS.MULTI.uid, status: 'active', specialRole: null }), permissions: ALL })
    }
    openPlan({ prepare, workPlans: [{ oscId: ALFA, partnershipId: RUNNING, values: { justification: informed('Dado exclusivo de Alfa.') } }] }, RUNNING, USERS.MULTI)
    fireEvent.change(await screen.findByLabelText('OSC selecionada'), { target: { value: ALFA } })
    await screen.findByRole('table') // a escolha da OSC leva à lista; o Plano é aberto em seguida
    act(() => {
      window.location.hash = `#/parcerias/${RUNNING}/plano`
    })
    await screen.findByRole('heading', { name: 'Cadastro estruturado do Plano aprovado' })
    fireEvent.change(screen.getByLabelText('OSC selecionada'), { target: { value: OSCS.GAMA.id } })
    await waitFor(() => expect(window.location.hash).toBe('#/parcerias'))
    await waitFor(() => expect(contextText()).toContain('Parceria: não selecionada'))
    expect(within(nav()).queryByRole('button', { name: 'Plano de Trabalho' })).toBeNull()
    expect(document.body.textContent).not.toContain('Dado exclusivo de Alfa.')
  })

  it('DEV-02.2-T22 — acessibilidade: grupos com legenda, rótulos, obrigatórios identificados e foco no aviso', async () => {
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    openPlan({ prepare: withPermissions(ALL), workPlans: [{ oscId: ALFA, partnershipId: RUNNING }] })
    await screen.findByRole('heading', { name: 'Cadastro estruturado do Plano aprovado' })
    for (const group of ['Identificação do Plano aprovado', 'Informações gerais de execução', 'Abrangência e público atendido', 'Justificativa e informações complementares']) {
      expect(screen.getByRole('group', { name: group })).toBeTruthy()
    }
    expect(screen.getByText('Data da aprovação pelo órgão público').parentElement?.textContent).toContain('*')
    const save = screen.getByRole('button', { name: 'Salvar alterações' })
    save.focus()
    expect(document.activeElement).toBe(save)
    fireEvent.click(save)
    expect((await screen.findByRole('alert')).textContent).toBe('Nenhuma alteração a salvar.')
  })
})

describe('Versionamento do Plano (DEV-02.3)', () => {
  const ORIGINAL = { oscId: ALFA, partnershipId: RUNNING, values: { ...REQUIRED, targetAudience: informed('Crianças') }, status: 'finalized' as const, revision: 3 }
  const versionsList = () => screen.getByRole('list', { name: 'Versões em ordem cronológica' })

  it('DEV-02.3-T01 — original identificada como vigente; histórico cronológico sem editar, excluir ou restaurar', async () => {
    openPlan({ prepare: withPermissions(ALL), workPlans: [ORIGINAL] })
    await screen.findByRole('heading', { name: 'Versões do Plano de Trabalho' })
    const items = within(versionsList()).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]?.textContent).toMatch(/Versão original.*sequência 1.*Vigente no SIGOSC/)
    expect(screen.queryByRole('button', { name: /Excluir|Restaurar|Ativar/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Registrar alteração formal' })).toBeTruthy()
  })

  it('DEV-02.3-T02/T03/T04/T06/T07 — registra alteração formal: ato validado, nova versão integral; original preservada', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(ALL), workPlans: [ORIGINAL] })
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar alteração formal' }))
    await screen.findByRole('heading', { name: 'Registrar alteração formal do Plano' })
    fireEvent.click(screen.getByRole('button', { name: 'Criar nova versão' }))
    expect((await screen.findByText('Revise os dados do ato formal. Nada foi gravado.')).getAttribute('role')).toBe('alert')
    expect(workPlans.calls.filter((c) => c.kind === 'create-version')).toHaveLength(0)
    fireEvent.click(screen.getByRole('radio', { name: 'Termo aditivo' }))
    fill(/Número ou referência administrativa/, '1º Termo Aditivo')
    fill(/Data do ato ou de sua aprovação/, '2026-09-01')
    fireEvent.click(screen.getByRole('button', { name: 'Criar nova versão' }))
    expect(await screen.findByText(/Nova versão criada a partir da versão original, que permanece preservada/)).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Versão 2' })).toBeTruthy()
    expect(workPlans.calls.find((c) => c.kind === 'create-version')?.request).toMatchObject({ baseWorkPlanId: 'original', baseRevision: 3, formalAct: { type: 'termo-aditivo', actDate: '2026-09-01' } })
    const items = within(versionsList()).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]?.textContent).toMatch(/Versão original.*Vigente no SIGOSC/)
    expect(items[1]?.textContent).toMatch(/Versão 2.*Em cadastramento: ainda não vigente.*Cadastro: Em cadastramento/)
    // Cópia integral editável; a original continua finalizada e preservada.
    expect((screen.getByRole('textbox', { name: /^Público atendido/ }) as HTMLTextAreaElement).value).toBe('Crianças')
    expect(workPlans.docs.get(`oscs/${ALFA}/partnerships/${RUNNING}/workPlans/original`)).toMatchObject({ registrationStatus: 'finalized', revision: 3 })
    // Só uma versão pendente: nova alteração formal indisponível, com o motivo.
    expect(screen.queryByRole('button', { name: 'Registrar alteração formal' })).toBeNull()
    expect(screen.getByText(/Já existe uma versão em cadastramento. Finalize-a/)).toBeTruthy()
  })

  it('DEV-02.3-T05/T09 — editar a nova versão não altera a original; dados do ato editáveis em cadastramento', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(ALL), workPlans: [ORIGINAL, { ...ORIGINAL, status: 'in-registration', sequence: 2, revision: 1 }] })
    expect(await screen.findByRole('heading', { name: 'Versão 2' })).toBeTruthy()
    // T08: ato gravado (com autoria do servidor) válido → requisitos de finalização atendidos.
    expect(screen.queryByText(/Ato formal: tipo e data/)).toBeNull()
    await confer()
    expect(await screen.findByText('Os requisitos para a finalização estão atendidos.')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: /^Público atendido/ }), { target: { value: 'Crianças e adolescentes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await screen.findByText('Alterações salvas e confirmadas pelo servidor.')
    expect(workPlans.calls.find((c) => c.kind === 'update')?.request).toMatchObject({ workPlanId: 'v2' })
    expect((workPlans.docs.get(`oscs/${ALFA}/partnerships/${RUNNING}/workPlans/original`)?.values as Record<string, unknown>).targetAudience).toEqual(informed('Crianças'))
    fireEvent.click(screen.getByRole('button', { name: 'Editar dados do ato formal' }))
    fill(/Número ou referência administrativa/, '1º TA retificado')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar dados do ato' }))
    await screen.findByText('Dados do ato formal salvos e confirmados pelo servidor.')
    expect(workPlans.calls.find((c) => c.kind === 'update-act')?.request).toMatchObject({ workPlanId: 'v2', formalAct: { reference: '1º TA retificado' } })
  })

  it('DEV-02.3-T10/T11/T12/T13 — consulta de versão anterior e comparação estruturada', async () => {
    openPlan({
      prepare: withPermissions(['partnerships.view', 'work-plan.view']),
      workPlans: [ORIGINAL, { ...ORIGINAL, sequence: 2, revision: 2, values: { ...REQUIRED, targetAudience: informed('Crianças e adolescentes'), executionMethod: informed('Oficinas') } }],
    })
    // DEC-PT-003: versão posterior finalizada é a vigente e é exibida por padrão.
    expect(await screen.findByRole('heading', { name: 'Versão 2' })).toBeTruthy()
    expect(screen.getByText('Crianças e adolescentes')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Consultar: Versão original' }))
    expect(await screen.findByRole('heading', { name: 'Versão original' })).toBeTruthy()
    expect(screen.getByText('Crianças')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Comparar com a anterior: Versão 2' }))
    const table = await screen.findByRole('table', { name: 'Diferenças entre Versão original e Versão 2' })
    const rows = within(table).getAllByRole('row').slice(1).map((r) => r.textContent)
    expect(rows).toHaveLength(2)
    expect(rows.some((t) => /Público atendido.*Crianças.*Crianças e adolescentes.*Alterado/.test(t ?? ''))).toBe(true)
    expect(rows.some((t) => /Incluído/.test(t ?? ''))).toBe(true)
    expect(screen.getByText(/2 campos com diferença; 8 mantidos/)).toBeTruthy()
    expect(await screen.findByText('Nenhuma categoria ou item financeiro registrado nas versões selecionadas.')).toBeTruthy()
    // T22 (consulta): só view — sem registrar alteração formal.
    expect(screen.queryByRole('button', { name: 'Registrar alteração formal' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar comparação' }))
    expect(screen.queryByRole('table', { name: /Diferenças entre/ })).toBeNull()
  })

  it('DEV-02.3-T20 — arquivada: sem nova versão nem finalização', async () => {
    openPlan({ prepare: withPermissions(ALL), workPlans: [{ ...ORIGINAL, partnershipId: 'pAlfaCooperacao01xx' }] }, 'pAlfaCooperacao01xx')
    await screen.findByRole('heading', { name: 'Versões do Plano de Trabalho' })
    expect(screen.queryByRole('button', { name: 'Registrar alteração formal' })).toBeNull()
  })
})

describe('Ativação e vigência cadastral (DEV-02.3-C01)', () => {
  const ORIGINAL = { oscId: ALFA, partnershipId: RUNNING, values: { ...REQUIRED, targetAudience: informed('Crianças') }, status: 'finalized' as const, revision: 3 }
  const V2 = { ...ORIGINAL, sequence: 2, revision: 1, values: { ...REQUIRED, targetAudience: informed('Crianças e adolescentes') } }
  const activeChain = (effectiveDate: string | null) => [
    { ...ORIGINAL, activation: 'superseded' },
    { ...V2, status: 'finalized' as const, revision: 2, formalAct: { effectiveDate } },
  ]
  const versionsList = () => screen.getByRole('list', { name: 'Versões em ordem cronológica' })

  it('C01-T01/T02/T07/T08/T11/T19/T21 — finalizar v2 a ativa com uma única confirmação; original substituída; próxima alteração liberada', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(ALL), workPlans: [ORIGINAL, { ...V2, status: 'in-registration' }] })
    await screen.findByRole('heading', { name: 'Versão 2' })
    expect(screen.getByText(/Ao ser finalizada, passará a ser a vigente no SIGOSC/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Ativar|Tornar vigente/ })).toBeNull() // T08
    await confer()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Finalizar cadastro' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar cadastro' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Confirmar finalização interna' })
    expect(dialog.textContent).toMatch(/passará a ser a vigente no SIGOSC.*versão original ficará registrada como substituída.*não representa aprovação jurídica/)
    expect(workPlans.calls.filter((c) => c.kind === 'finalize')).toHaveLength(0) // T07
    declareAndConfirm(dialog)
    const done = await screen.findByText(/Cadastro finalizado e Versão 2 ativada como vigente no SIGOSC; a versão original passa a constar como substituída/)
    expect(done.textContent).toMatch(/Não representa aprovação jurídica/) // T19
    expect(workPlans.calls.filter((c) => c.kind === 'finalize')).toHaveLength(1)
    await waitFor(() => expect(within(versionsList()).getAllByRole('listitem')[0]?.textContent).toMatch(/Versão original.*Substituída no SIGOSC/))
    expect(within(versionsList()).getAllByRole('listitem')[1]?.textContent).toMatch(/Versão 2.*Vigente no SIGOSC/)
    expect(screen.getAllByText('Vigente no SIGOSC').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Registrar alteração formal' })).toBeTruthy() // T11
    fireEvent.click(screen.getByRole('button', { name: 'Comparar com a anterior: Versão 2' })) // T21
    expect(await screen.findByRole('table', { name: 'Diferenças entre Versão original e Versão 2' })).toBeTruthy()
  })

  it('C01-T16 — data futura de efeitos: aviso com a data e selo no histórico', async () => {
    openPlan({ prepare: withPermissions(['partnerships.view', 'work-plan.view']), workPlans: activeChain('2099-03-01') })
    await screen.findByRole('heading', { name: 'Versão 2' })
    expect(screen.getByText('Versão vigente no SIGOSC desde sua finalização interna. A alteração formal possui início de efeitos administrativos previsto para 01/03/2099.')).toBeTruthy()
    expect(within(versionsList()).getByText('Efeitos administrativos a partir de 01/03/2099')).toBeTruthy()
  })

  it('C01-T17/T18 — sem data: "não informada", nada presumido; data alcançada: sem aviso de efeitos futuros', async () => {
    openPlan({ prepare: withPermissions(['partnerships.view', 'work-plan.view']), workPlans: activeChain(null) })
    await screen.findByRole('heading', { name: 'Versão 2' })
    expect(screen.getByText('Versão vigente no SIGOSC. Data de produção de efeitos administrativos não informada.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/produz efeitos|previsto para/)
    cleanup()
    openPlan({ prepare: withPermissions(['partnerships.view', 'work-plan.view']), workPlans: activeChain('2026-01-15') })
    await screen.findByRole('heading', { name: 'Versão 2' })
    expect(screen.getByText(/Data de produção de efeitos informada no ato: 15\/01\/2026/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/previsto para|Efeitos administrativos a partir de/)
  })

  it('C01-T20/T21 — versão substituída consultável, sem afirmar revogação jurídica', async () => {
    openPlan({ prepare: withPermissions(['partnerships.view', 'work-plan.view']), workPlans: activeChain(null) })
    fireEvent.click(await screen.findByRole('button', { name: 'Consultar: Versão original' }))
    await screen.findByRole('heading', { name: 'Versão original' })
    expect(screen.getByText(/Versão substituída no SIGOSC.*Permanece preservada para consulta; a substituição cadastral não significa revogação jurídica/)).toBeTruthy()
    expect(screen.getByText('Crianças')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Excluir|Restaurar|Ativar/ })).toBeNull()
  })

  it('Legado pending-decision finalizado: identificado, nunca vigente; nova alteração bloqueada com o motivo', async () => {
    openPlan({ prepare: withPermissions(ALL), workPlans: [ORIGINAL, { ...V2, status: 'finalized', revision: 2, activation: 'pending-decision' }] })
    await screen.findByRole('heading', { name: 'Versão original' })
    expect(within(versionsList()).getAllByRole('listitem')[0]?.textContent).toMatch(/Vigente no SIGOSC/)
    expect(within(versionsList()).getAllByRole('listitem')[1]?.textContent).toMatch(/Finalizada sem ativação: aguarda regularização/)
    expect(screen.queryByRole('button', { name: 'Registrar alteração formal' })).toBeNull()
    expect(screen.getByText(/Nova alteração formal fica bloqueada até a regularização administrativa/)).toBeTruthy()
  })
})

describe('Metas e indicadores previstos (DEV-02.4)', () => {
  const G1 = 'g_000000000000000000a1'
  const I1 = 'i_000000000000000000b1'
  const DRAFT = { oscId: ALFA, partnershipId: RUNNING, values: REQUIRED }
  const WITH = {
    ...DRAFT,
    goals: [{ id: G1, data: goalData('Meta 01', { expectedQuantity: { state: 'informed', value: 0 } }) }],
    indicators: [{ id: I1, data: indicatorData('IND-01', [G1], { periodicity: { state: 'informed', value: { kind: 'quarterly', description: null } } }) }],
  }
  const section = () => screen.getByRole('region', { name: 'Metas e indicadores previstos' })

  it('DEV-02.4-T01/T08 — consulta da versão: metas, indicadores vinculados, resultado previsto e zero informado', async () => {
    openPlan({ prepare: withPermissions(['partnerships.view', 'work-plan.view']), workPlans: [{ ...WITH, status: 'finalized' }] })
    await screen.findByText('1 meta · 1 indicador')
    const text = section().textContent ?? ''
    expect(text).toMatch(/Meta 01.*Quantidade prevista0 participantes/)
    expect(text).toMatch(/IND-01 · Indicador fictício IND-01.*Resultado previsto80 %.*PeriodicidadeTrimestral.*Metas vinculadasMeta 01/)
    expect(text).toMatch(/\(concluintes ÷ inscritos\) × 100 — numerador: concluintes; denominador: inscritos; multiplicador: 100/)
    expect(within(section()).getAllByText('Não informado').length).toBeGreaterThan(0)
    expect(within(section()).queryByRole('button')).toBeNull() // só consulta
    expect(screen.queryByRole('button', { name: /Registrar apuração|Registrar avaliação|ajuste manual/i })).toBeNull() // T25
  })

  it('DEV-02.4-T02/T03/T04/T05/T09 — cadastrar meta e indicador vinculado pela interface, com validação local', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(ALL), workPlans: [DRAFT] })
    await screen.findByText(/Nenhuma meta ou indicador registrado nesta versão. Registre-os/)
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar meta' }))
    expect((screen.getByLabelText(/Código da meta/) as HTMLInputElement).value).toBe('Meta 01') // sugerido
    fireEvent.click(within(screen.getByRole('region', { name: 'Adicionar meta' })).getByRole('button', { name: 'Adicionar meta' }))
    expect((await screen.findByText('Revise os campos indicados. Nada foi gravado.')).getAttribute('role')).toBe('alert')
    expect(workPlans.calls.filter((c) => c.kind === 'create-component')).toHaveLength(0) // T05
    fill(/Descrição da meta/, 'Atender 1.200 participantes')
    fireEvent.click(screen.getByRole('radio', { name: 'Quantitativa' }))
    fill(/Quantidade prevista/, '1.200')
    fill(/Unidade de medida/, 'participantes')
    fireEvent.click(within(screen.getByRole('region', { name: 'Adicionar meta' })).getByRole('button', { name: 'Adicionar meta' }))
    await screen.findByText('Meta Meta 01 registrada e confirmada pelo servidor.')
    expect(workPlans.calls.find((c) => c.kind === 'create-component')?.request).toMatchObject({ workPlanId: 'original', kind: 'goal', data: { code: 'Meta 01', expectedQuantity: { state: 'informed', value: 1200 }, nature: 'quantitative' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar indicador à meta Meta 01' }))
    const form = screen.getByRole('region', { name: 'Adicionar indicador' })
    expect((within(form).getByRole('checkbox', { name: 'Meta 01' }) as HTMLInputElement).checked).toBe(true) // vínculo já marcado
    fill(/Nome do indicador/, 'Taxa de conclusão')
    fireEvent.click(within(form).getByRole('radio', { name: 'Quantitativa' }))
    fireEvent.change(within(form).getByLabelText(/Tipo de resultado numérico/), { target: { value: 'rate' } })
    fireEvent.change(within(form).getByLabelText(/Resultado previsto \(valor-alvo\)/), { target: { value: '0' } })
    fireEvent.change(within(form).getByLabelText(/Periodicidade do indicador/), { target: { value: 'semiannual' } })
    fireEvent.change(within(form).getByLabelText(/Fórmula, como consta do Plano/), { target: { value: 'concluintes por mil inscritos' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Adicionar indicador' }))
    await screen.findByText('Indicador IND-01 registrado e confirmado pelo servidor.')
    const created = workPlans.calls.filter((c) => c.kind === 'create-component')[1]?.request as { data: Record<string, unknown> }
    expect(created.data).toMatchObject({ code: 'IND-01', measurementType: 'rate', target: { state: 'informed', value: 0 }, periodicity: { state: 'informed', value: { kind: 'semiannual' } } })
    expect((created.data.goalIds as string[]).length).toBe(1)
    await screen.findByText('1 meta · 1 indicador')
    expect(screen.getByRole('list', { name: 'Indicadores da meta Meta 01' }).textContent).toMatch(/IND-01 · Taxa de conclusão/)
  })

  it('DEV-02.4-T06 — indicador qualitativo: sem valor numérico; categorias transcritas', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(ALL), workPlans: [WITH] })
    await screen.findByText('1 meta · 1 indicador')
    fireEvent.click(screen.getAllByRole('button', { name: 'Adicionar indicador' }).at(-1) as HTMLElement)
    const form = screen.getByRole('region', { name: 'Adicionar indicador' })
    fill(/Nome do indicador/, 'Satisfação das famílias')
    fireEvent.click(within(form).getByRole('radio', { name: 'Qualitativa' }))
    expect(within(form).queryByLabelText(/Resultado previsto \(valor-alvo\)/)).toBeNull()
    fireEvent.change(within(form).getByLabelText(/Regra ou critério qualitativo/), { target: { value: 'Escuta qualificada semestral' } })
    fireEvent.change(within(form).getByLabelText(/Categorias de classificação/), { target: { value: 'Atendido\nNão atendido' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Adicionar indicador' }))
    await screen.findByText('Indicador IND-02 registrado e confirmado pelo servidor.')
    const sent = workPlans.calls.find((c) => c.kind === 'create-component')?.request as { data: Record<string, unknown> }
    expect(sent.data).toMatchObject({ nature: 'qualitative', measurementType: null, target: { state: 'not-informed' }, categories: ['Atendido', 'Não atendido'], goalIds: [] })
  })

  it('DEV-02.4-T14 — conflito de revisão recarrega; edição exibe o componente atual', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(ALL), workPlans: [WITH] })
    fireEvent.click(await screen.findByRole('button', { name: 'Editar meta Meta 01' }))
    workPlans.respondWith((call) => (call.kind === 'update-component' ? { ok: false, error: 'stale' } : undefined))
    fill(/Descrição da meta/, 'Nova descrição')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar meta' }))
    expect(await screen.findByText(/alterado por outra pessoa; os dados foram recarregados/)).toBeTruthy()
  })

  it('Plano finalizado sem componentes: edição comum continua bloqueada; incorporação é o procedimento próprio', async () => {
    openPlan({ prepare: withPermissions(ALL), workPlans: [{ ...DRAFT, status: 'finalized' }] })
    expect(await screen.findByText(/use "Incorporar metas e indicadores do Plano aprovado"/)).toBeTruthy()
    expect(within(section()).queryByRole('button', { name: /Adicionar/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Incorporar metas e indicadores do Plano aprovado' })).toBeTruthy()
  })

  it('DEV-02.4-T16 — somente consulta sem work-plan.edit', async () => {
    openPlan({ prepare: withPermissions(['partnerships.view', 'work-plan.view']), workPlans: [WITH] })
    await screen.findByText('1 meta · 1 indicador')
    expect(within(section()).queryByRole('button')).toBeNull()
    expect(within(section()).getByText(/não possui autorização para alterá-los/)).toBeTruthy()
  })

  it('DEV-02.4-T21/T24 — componentes por versão e comparação entre versões', async () => {
    const changed = { id: G1, data: goalData('Meta 01', { expectedQuantity: { state: 'informed', value: 250 } }), inheritedFrom: 'original' }
    openPlan({
      prepare: withPermissions(['partnerships.view', 'work-plan.view']),
      workPlans: [
        { ...WITH, status: 'finalized', activation: 'superseded' },
        { ...WITH, sequence: 2, status: 'finalized', revision: 2, goals: [changed, { id: 'g_000000000000000000a2', data: goalData('Meta 02') }], indicators: [{ id: I1, data: indicatorData('IND-01', [G1], { status: 'discontinued', periodicity: { state: 'informed', value: { kind: 'quarterly', description: null } } }) }] },
      ],
    })
    await screen.findByText('2 metas · 0 indicadores')
    fireEvent.click(screen.getByRole('button', { name: 'Consultar: Versão original' }))
    await screen.findByText('1 meta · 1 indicador') // versão anterior preservada
    fireEvent.click(screen.getByRole('button', { name: 'Comparar com a anterior: Versão 2' }))
    const table = await screen.findByRole('table', { name: /Metas e indicadores: diferenças entre Versão original e Versão 2/ })
    const rows = within(table).getAllByRole('row').slice(1).map((r) => r.textContent)
    expect(rows).toEqual(['Meta Meta 01AlteradoQuantidade prevista', 'Meta Meta 02Incluído—', 'Indicador IND-01Descontinuado—'])
  })
})

describe('Monitoramento e Avaliação — PAG-OSC08 (DEV-02.4)', () => {
  const G1 = 'g_000000000000000000a1'
  const plan = { oscId: ALFA, partnershipId: RUNNING, values: REQUIRED, status: 'finalized' as const, goals: [{ id: G1, data: goalData('Meta 01') }], indicators: [{ id: 'i_000000000000000000b1', data: indicatorData('IND-01', [G1]) }, { id: 'i_000000000000000000b2', data: indicatorData('IND-02', [], { nature: 'qualitative', measurementType: null, target: { state: 'not-informed' }, unit: { state: 'not-informed' }, expectedParameter: { state: 'informed', value: 'Famílias satisfeitas' }, rule: { method: 'described', description: 'Escuta' }, periodicity: { state: 'not-informed' } }) }] }

  it('Indicadores previstos da versão vigente, sem apuração nem botões de avaliação', async () => {
    window.location.hash = `#/parcerias/${RUNNING}/indicadores`
    renderOscApp(OP, { prepare: withPermissions(['partnerships.view', 'work-plan.view']), workPlans: [plan] })
    const table = await screen.findByRole('table', { name: /Indicadores previstos na versão original/ })
    expect(title()).toBe('Monitoramento e Avaliação')
    const rows = within(table).getAllByRole('row').slice(1).map((r) => r.textContent)
    expect(rows[0]).toMatch(/IND-01Indicador fictício IND-01Quantitativa · PercentualMeta 01Mensal80 %/)
    expect(rows[1]).toMatch(/IND-02.*QualitativaSem meta vinculadaNão informadaFamílias satisfeitas/)
    expect(screen.getByText(/nenhum resultado realizado é exibido/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Registrar apuração|Registrar avaliação|ajuste manual|evidência/i })).toBeNull()
    expect(within(nav()).getByRole('button', { name: 'Monitoramento e Avaliação' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir o Plano de Trabalho' }))
    await waitFor(() => expect(window.location.hash).toBe(`#/parcerias/${RUNNING}/plano`))
  })

  it('Sem versão vigente: orientação, sem indicadores', async () => {
    window.location.hash = `#/parcerias/${RUNNING}/indicadores`
    renderOscApp(OP, { prepare: withPermissions(['partnerships.view', 'work-plan.view']), workPlans: [{ ...plan, status: 'in-registration' }] })
    expect(await screen.findByText(/Não há indicadores: o Plano de Trabalho aprovado ainda não foi registrado e finalizado/)).toBeTruthy()
  })
})

describe('Consolidação de metas e indicadores (DEV-02.4-C01)', () => {
  const G1 = 'g_000000000000000000c1'
  const section = () => screen.getByRole('region', { name: 'Metas e indicadores previstos' })
  const DRAFT = { oscId: ALFA, partnershipId: RUNNING, values: REQUIRED }
  const FINAL = { ...DRAFT, status: 'finalized' as const, revision: 3 }

  it('C01-T01/T02/T04/T06/T07/T12/T13/T14 — incorporação complementar: abrir com declaração, transcrever, conferir e encerrar', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(ALL), workPlans: [FINAL] })
    fireEvent.click(await screen.findByRole('button', { name: 'Incorporar metas e indicadores do Plano aprovado' })) // T01
    expect(within(screen.getByRole('region', { name: 'Metas e indicadores do Plano aprovado' })).getByText(/não altera juridicamente o Plano e não cria versão formal/)).toBeTruthy()
    const start = screen.getByRole('button', { name: 'Iniciar incorporação' })
    expect((start as HTMLButtonElement).disabled).toBe(true) // T04: declaração obrigatória
    fireEvent.click(screen.getByRole('checkbox', { name: /Declaro que as metas e os indicadores que serão incorporados/ }))
    fireEvent.click(start)
    await screen.findByRole('heading', { name: 'Incorporação complementar em andamento' })
    expect(workPlans.calls.find((c) => c.kind === 'open-transcription')?.request).toMatchObject({ workPlanId: 'original', declaration: true })
    expect(screen.getByText('Cadastro no SIGOSC: Estruturado e finalizado internamente')).toBeTruthy() // T05: continua finalizado
    // T06/T07: componentes durante a incorporação.
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar meta' }))
    fill(/Descrição da meta/, 'Atender 200 participantes')
    fireEvent.click(screen.getByRole('radio', { name: 'Quantitativa' }))
    fireEvent.click(within(screen.getByRole('region', { name: 'Adicionar meta' })).getByRole('button', { name: 'Adicionar meta' }))
    await screen.findByText('Meta Meta 01 registrada e confirmada pelo servidor.')
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar indicador à meta Meta 01' }))
    const form = screen.getByRole('region', { name: 'Adicionar indicador' })
    fill(/Nome do indicador/, 'Oficinas realizadas')
    fireEvent.click(within(form).getByRole('radio', { name: 'Quantitativa' }))
    fireEvent.change(within(form).getByLabelText(/Tipo de resultado numérico/), { target: { value: 'quantity' } })
    fireEvent.change(within(form).getByLabelText(/Fórmula, como consta do Plano/), { target: { value: 'soma das oficinas realizadas' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Adicionar indicador' }))
    await screen.findByText('Indicador IND-01 registrado e confirmado pelo servidor.')
    // Encerramento: conferência + periodicidade pendente bloqueia (DEC-PT-009).
    await screen.findByText('1 meta · 1 indicador')
    await confer('Transcritos conforme o Plano aprovado')
    const panel = screen.getByRole('region', { name: 'Incorporação complementar em andamento' })
    expect(within(panel).getByText(/Periodicidade pendente: IND-01/)).toBeTruthy()
    fireEvent.click(within(panel).getByRole('checkbox', { name: /Declaro que as metas e os indicadores registrados/ }))
    expect((within(panel).getByRole('button', { name: 'Encerrar incorporação' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Editar indicador IND-01' }))
    fireEvent.change(screen.getByLabelText(/Periodicidade do indicador/), { target: { value: 'not-applicable' } })
    fireEvent.change(screen.getByLabelText(/Justificativa da inaplicabilidade/), { target: { value: 'Indicador apurado uma única vez no encerramento.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar indicador' }))
    await screen.findByText('Indicador IND-01 atualizado e confirmado pelo servidor.')
    await waitFor(() => expect(within(panel).queryByText(/Periodicidade pendente/)).toBeNull())
    fireEvent.click(within(panel).getByRole('button', { name: 'Encerrar incorporação' }))
    expect(await screen.findByText(/Incorporação complementar encerrada. Metas e indicadores preservados; nenhuma versão formal foi criada/)).toBeTruthy()
    expect(workPlans.calls.find((c) => c.kind === 'close-transcription')?.request).toMatchObject({ declaration: true, review: { goals: { status: 'transcribed' }, indicators: { status: 'transcribed' } } })
    await screen.findByText(/Incorporação complementar de metas e indicadores encerrada em/)
    expect(within(section()).queryByRole('button')).toBeNull() // T13
    expect(within(screen.getByRole('list', { name: 'Versões em ordem cronológica' })).getAllByRole('listitem')).toHaveLength(1) // T14
  })

  it('C01-T08 — incorporação em andamento é retomada com os componentes já salvos', async () => {
    openPlan({ prepare: withPermissions(ALL), workPlans: [{ ...FINAL, transcription: { status: 'open' }, goals: [{ id: G1, data: goalData('Meta 01') }] }] })
    await screen.findByRole('heading', { name: 'Incorporação complementar em andamento' })
    expect(await screen.findByText('1 meta · 0 indicadores')).toBeTruthy()
    // 3.7: nova alteração formal indisponível enquanto a incorporação estiver aberta (sem botão inoperante).
    expect(screen.queryByRole('button', { name: 'Registrar alteração formal' })).toBeNull()
    expect(screen.getByText(/Há incorporação complementar de metas e indicadores em andamento/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Editar meta Meta 01' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Incorporar metas e indicadores do Plano aprovado' })).toBeNull() // T09
  })

  it('C01-T10/T11/T03 — sem incorporação: versão substituída, versão já estruturada ou sem work-plan.edit', async () => {
    openPlan({ prepare: withPermissions(ALL), workPlans: [{ ...FINAL, activation: 'superseded' }, { ...FINAL, sequence: 2, revision: 2 }] })
    await screen.findByRole('heading', { name: 'Versão 2' })
    fireEvent.click(screen.getByRole('button', { name: 'Consultar: Versão original' }))
    await screen.findByRole('heading', { name: 'Versão original' })
    expect(screen.queryByRole('button', { name: 'Incorporar metas e indicadores do Plano aprovado' })).toBeNull() // T10
    cleanup()
    openPlan({ prepare: withPermissions(ALL), workPlans: [{ ...FINAL, goals: [{ id: G1, data: goalData('Meta 01') }] }] })
    await screen.findByText('1 meta · 0 indicadores')
    expect(screen.queryByRole('button', { name: 'Incorporar metas e indicadores do Plano aprovado' })).toBeNull() // T11
    cleanup()
    openPlan({ prepare: withPermissions(['partnerships.view', 'work-plan.view']), workPlans: [FINAL] })
    await screen.findByRole('heading', { name: 'Metas e indicadores previstos' })
    expect(screen.queryByRole('button', { name: 'Incorporar metas e indicadores do Plano aprovado' })).toBeNull() // T03
  })

  it('C01-T15/T17/T18/T19/T27 — conferência na finalização: sem mínimo universal; justificativa; pendências bloqueiam', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(ALL), workPlans: [{ ...DRAFT, goals: [{ id: G1, data: goalData('Meta 01') }], indicators: [{ id: 'i_000000000000000000c1', data: indicatorData('IND-01', [G1], { periodicity: { state: 'not-informed' } }) }] }] })
    await screen.findByText('1 meta · 1 indicador')
    const pend = () => within(screen.getByRole('list', { name: 'Pendências' })).getAllByRole('listitem').map((li) => li.textContent).join(' ')
    expect(pend()).toMatch(/Metas: há componentes pendentes de transcrição.*Indicadores: há componentes pendentes.*Periodicidade pendente: IND-01/) // T15/T18/T27
    await confer('Inexistentes no Plano aprovado', 'Transcritos conforme o Plano aprovado')
    expect(pend()).toMatch(/Metas: há componentes ativos registrados; a categoria não pode ser declarada inexistente/) // T17
    await confer('Transcritos conforme o Plano aprovado')
    expect(pend()).toMatch(/^Periodicidade pendente: IND-01/)
    expect((screen.getByRole('button', { name: 'Finalizar cadastro' }) as HTMLButtonElement).disabled).toBe(true)
    expect(workPlans.calls.filter((c) => c.kind === 'finalize')).toHaveLength(0)
  })

  it('C01-T26/T28 — periodicidade "não se aplica" exige justificativa; troca de natureza informa o impacto', async () => {
    openPlan({ prepare: withPermissions(ALL), workPlans: [{ ...DRAFT, goals: [{ id: G1, data: goalData('Meta 01') }], indicators: [{ id: 'i_000000000000000000c1', data: indicatorData('IND-01', [G1]) }] }] })
    fireEvent.click(await screen.findByRole('button', { name: 'Editar indicador IND-01' }))
    fireEvent.change(screen.getByLabelText(/Periodicidade do indicador/), { target: { value: 'not-applicable' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar indicador' }))
    expect(await screen.findByText('Informe a justificativa (mínimo de 10 caracteres).')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Qualitativa' }))
    expect(screen.getByText(/Ao salvar como qualitativo, deixarão de valer: Tipo de resultado numérico; Resultado previsto \(valor-alvo\); Unidade de medida; Método/)).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Quantitativa' }))
    expect((screen.getByLabelText(/Resultado previsto \(valor-alvo\)/) as HTMLInputElement).value).toBe('80') // nada descartado em silêncio
  })
})

describe('Planejamento financeiro previsto (DEV-02.5)', () => {
  const C1 = 'c_000000000000000000d1'
  const DRAFT = { oscId: ALFA, partnershipId: RUNNING, values: REQUIRED }
  const WITH = {
    ...DRAFT,
    financialCategories: [{ id: C1, data: categoryData('C1', 'Recursos Humanos', 'recursos-humanos') }],
    financialItems: [
      { id: 'f_000000000000000000e1', data: itemData('F1', C1, 32_000_000) },
      { id: 'f_000000000000000000e2', data: itemData('F2', C1, 1_700_000, { quantity: { state: 'informed', value: '12' }, unit: { state: 'informed', value: 'meses' }, unitValue: { state: 'informed', cents: 150_000 } }) },
      { id: 'f_000000000000000000e3', data: itemData('F3', C1, null) },
    ],
  }
  const fin = () => screen.getByRole('region', { name: 'Planejamento financeiro previsto' })

  it('DEV-02.5-T01/T10/T12/T28 — consulta: itens por categoria, valores em R$, totais previstos e pendências; sem realizado', async () => {
    openPlan({ prepare: withPermissions(['partnerships.view', 'work-plan.view']), workPlans: [{ ...WITH, status: 'finalized' }] })
    await screen.findByText('Total previsto: R$ 337.000,00 (parcial: 1 item sem valor informado)')
    const table = within(fin()).getByRole('table', { name: 'Itens previstos da categoria Recursos Humanos' })
    const rows = within(table).getAllByRole('row').slice(1).map((r) => r.textContent)
    expect(rows[0]).toMatch(/F1Item fictício F1Valor globalR\$ 320\.000,00/)
    expect(rows[1]).toMatch(/F212 meses × R\$ 1\.500,00R\$ 17\.000,00/)
    expect(rows[2]).toMatch(/F3.*Não informado/)
    expect(rows[3]).toMatch(/Subtotal previsto da categoriaR\$ 337\.000,00 \(parcial/)
    expect(within(fin()).getByText(/F2: Quantidade × valor unitário \(R\$ 18\.000,00\) difere do valor previsto informado/)).toBeTruthy()
    expect(fin().textContent).not.toMatch(/Saldo|Despesas|Receitas registradas|Realizado/)
    expect(within(fin()).queryByRole('button')).toBeNull()
  })

  it('DEV-02.5 — tela estreita: itens em cartões legíveis (sem tabela espremida), com subtotal', async () => {
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    openPlan({ prepare: withPermissions(['partnerships.view', 'work-plan.view']), workPlans: [{ ...WITH, status: 'finalized' }] })
    const list = await screen.findByRole('list', { name: 'Itens previstos da categoria Recursos Humanos' })
    expect(within(fin()).queryByRole('table')).toBeNull()
    const cards = within(list).getAllByRole('listitem').map((li) => li.textContent)
    expect(cards[0]).toMatch(/F1R\$ 320\.000,00Item fictício F1Valor global/)
    expect(cards.at(-1)).toMatch(/Subtotal previsto da categoria: R\$ 337\.000,00/)
  })

  it('DEV-02.5-T04/T05/T07/T08/T09/T11 — cadastrar categoria e item pela interface, com moeda brasileira e valor derivado explícito', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(ALL), workPlans: [DRAFT] })
    await screen.findByText(/Nenhuma categoria ou item registrado nesta versão. Registre o planejamento/)
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar categoria' }))
    fireEvent.change(screen.getByLabelText(/Categoria padronizada correspondente/), { target: { value: 'servicos-terceiros' } })
    expect((screen.getByLabelText(/Nome da categoria/) as HTMLInputElement).value).toBe('Serviços de Terceiros')
    fireEvent.click(within(screen.getByRole('region', { name: 'Adicionar categoria' })).getByRole('button', { name: 'Adicionar categoria' }))
    await screen.findByText('Categoria C1 registrada e confirmada pelo servidor.')
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar item à categoria C1' }))
    const form = screen.getByRole('region', { name: 'Adicionar item previsto' })
    expect((within(form).getByLabelText(/^Categoria/) as HTMLSelectElement).value).toMatch(/^c_/)
    fill(/Descrição do item/, 'Contratação de oficineiros')
    fireEvent.change(within(form).getByLabelText(/Quantidade prevista/), { target: { value: '1.200' } })
    fireEvent.change(within(form).getByLabelText(/Valor unitário previsto/), { target: { value: '15,50' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Usar R$ 18.600,00 como valor previsto' }))
    expect((within(form).getByLabelText(/^Valor previsto/) as HTMLInputElement).value).toBe('18.600,00')
    fireEvent.click(within(form).getByRole('button', { name: 'Adicionar item' }))
    await screen.findByText('Item F1 registrado e confirmado pelo servidor.')
    const sent = workPlans.calls.filter((c) => c.kind === 'create-financial')[1]?.request as { data: Record<string, unknown> }
    expect(sent.data).toMatchObject({ code: 'F1', quantity: { state: 'informed', value: '1200' }, unitValue: { state: 'informed', cents: 1550 }, plannedValue: { state: 'informed', cents: 1_860_000 } })
    await screen.findByText('Total previsto: R$ 18.600,00')
  })

  it('DEV-02.5-T06 — validação local: descrição obrigatória e moeda inválida; nada enviado', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(ALL), workPlans: [WITH] })
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar item à categoria C1' }))
    const form = screen.getByRole('region', { name: 'Adicionar item previsto' })
    fireEvent.change(within(form).getByLabelText(/^Valor previsto/), { target: { value: '12,345' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Adicionar item' }))
    expect(await within(form).findByText('Revise os campos indicados. Nada foi gravado.')).toBeTruthy()
    expect(workPlans.calls.filter((c) => c.kind === 'create-financial')).toHaveLength(0)
  })

  it('DEV-02.5-T02/T03 — Acordo de Cooperação: "não se aplica", sem valor zero e sem botões', async () => {
    openPlan({ prepare: withPermissions(ALL), workPlans: [{ oscId: ALFA, partnershipId: 'pAlfaCooperacao01xx' }] }, 'pAlfaCooperacao01xx')
    await screen.findByText(/Não se aplica: Acordo de Cooperação, sem transferência de recursos financeiros. Nenhum valor é registrado/)
    expect(within(fin()).queryByText(/R\$ 0,00/)).toBeNull()
    expect(within(fin()).queryByRole('button')).toBeNull()
  })

  it('DEV-02.5-T27 / C01 — Plano finalizado sem planejamento: edição comum bloqueada; inclusão só pela incorporação financeira', async () => {
    openPlan({ prepare: withPermissions(ALL), workPlans: [{ ...DRAFT, status: 'finalized' }] })
    expect(await within(await screen.findByRole('region', { name: 'Planejamento financeiro previsto' })).findByText(/use "Incorporar planejamento financeiro do Plano aprovado" \(DEC-PT-011\)/)).toBeTruthy()
    expect(within(fin()).queryByRole('button')).toBeNull()
    expect(await screen.findByRole('button', { name: 'Incorporar planejamento financeiro do Plano aprovado' })).toBeTruthy()
  })

  it('DEV-02.5-T21/T24/T25 — versão anterior preservada; comparação distingue valor e descrição', async () => {
    const v2Items = [
      { id: 'f_000000000000000000e1', data: itemData('F1', C1, 35_000_000), inheritedFrom: 'original' },
      { id: 'f_000000000000000000e2', data: { ...itemData('F2', C1, 1_700_000, { quantity: { state: 'informed', value: '12' }, unit: { state: 'informed', value: 'meses' }, unitValue: { state: 'informed', cents: 150_000 } }), description: 'Nova redação' }, inheritedFrom: 'original' },
      { id: 'f_000000000000000000e3', data: itemData('F3', C1, null, { status: 'discontinued' }), inheritedFrom: 'original' },
      { id: 'f_000000000000000000e4', data: itemData('F4', C1, 5_000) },
    ]
    openPlan({ prepare: withPermissions(['partnerships.view', 'work-plan.view']), workPlans: [{ ...WITH, status: 'finalized', activation: 'superseded' }, { ...WITH, sequence: 2, status: 'finalized', revision: 2, financialItems: v2Items }] })
    await screen.findByText('Total previsto: R$ 367.050,00')
    fireEvent.click(screen.getByRole('button', { name: 'Comparar com a anterior: Versão 2' }))
    const table = await screen.findByRole('table', { name: /Planejamento financeiro: diferenças entre Versão original e Versão 2/ })
    const rows = within(table).getAllByRole('row').slice(1).map((r) => r.textContent)
    expect(rows).toEqual(['Item F1AlteradoValor previstoR$ 320.000,00 → R$ 350.000,00', 'Item F2AlteradoDescriçãoR$ 17.000,00', 'Item F3Descontinuado—Não informado', 'Item F4Incluído—R$ 50,00'])
    fireEvent.click(screen.getByRole('button', { name: 'Consultar: Versão original' }))
    await screen.findByText('Total previsto: R$ 337.000,00 (parcial: 1 item sem valor informado)')
  })
})

describe('Consolidação do planejamento financeiro (DEV-02.5-C01)', () => {
  const C1 = 'c_000000000000000000f1'
  const DRAFT = { oscId: ALFA, partnershipId: RUNNING, values: REQUIRED }
  const FINAL = { ...DRAFT, status: 'finalized' as const, revision: 3 }
  const fin = () => screen.getByRole('region', { name: 'Planejamento financeiro previsto' })
  const cat = { id: C1, data: categoryData('C1', 'Pessoal do projeto') }

  it('C01-T01/T03/T09/T10/T11/T15/T16/T17 — incorporação financeira: abrir com declaração, transcrever, pendência de valor, encerrar', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(ALL), workPlans: [FINAL] })
    fireEvent.click(await screen.findByRole('button', { name: 'Incorporar planejamento financeiro do Plano aprovado' }))
    const start = screen.getByRole('button', { name: 'Iniciar incorporação financeira' })
    expect((start as HTMLButtonElement).disabled).toBe(true) // T03
    fireEvent.click(screen.getByRole('checkbox', { name: /Declaro que as categorias, os itens e os valores financeiros a serem incorporados/ }))
    fireEvent.click(start)
    await screen.findByRole('heading', { name: 'Incorporação financeira em andamento' })
    expect(workPlans.calls.find((c) => c.kind === 'open-financial-transcription')?.request).toMatchObject({ workPlanId: 'original', declaration: true })
    expect(screen.getByText('Cadastro no SIGOSC: Estruturado e finalizado internamente')).toBeTruthy()
    fireEvent.click(await within(fin()).findByRole('button', { name: 'Adicionar categoria' })) // T09
    fill(/Nome da categoria/, 'Pessoal do projeto')
    fireEvent.click(within(screen.getByRole('region', { name: 'Adicionar categoria' })).getByRole('button', { name: 'Adicionar categoria' }))
    await screen.findByText('Categoria C1 registrada e confirmada pelo servidor.')
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar item à categoria C1' })) // T10
    fill(/Descrição do item/, 'Coordenação pedagógica')
    fireEvent.click(within(screen.getByRole('region', { name: 'Adicionar item previsto' })).getByRole('button', { name: 'Adicionar item' }))
    await screen.findByText('Item F1 registrado e confirmado pelo servidor.') // incompleto é salvo
    const panel = screen.getByRole('region', { name: 'Incorporação financeira em andamento' })
    expect(await within(panel).findByText(/Item financeiro F1: valor previsto não informado/)).toBeTruthy() // T15
    fireEvent.click(within(panel).getByRole('checkbox', { name: /Declaro que as categorias, os itens e os valores financeiros incorporados/ }))
    expect((within(panel).getByRole('button', { name: 'Encerrar incorporação financeira' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Editar item F1' }))
    fireEvent.change(screen.getByLabelText(/^Valor previsto/), { target: { value: '0,00' } }) // T25: zero informado
    fireEvent.click(screen.getByRole('button', { name: 'Salvar item' }))
    await screen.findByText('Item F1 atualizado e confirmado pelo servidor.')
    await within(panel).findByText('Todos os itens ativos têm valor previsto informado.')
    fireEvent.click(within(panel).getByRole('button', { name: 'Encerrar incorporação financeira' })) // T16
    expect(await screen.findByText(/Incorporação financeira concluída. Planejamento preservado; nenhuma versão formal foi criada/)).toBeTruthy()
    expect(workPlans.calls.find((c) => c.kind === 'close-financial-transcription')?.request).toMatchObject({ declaration: true, expectedTranscriptionRevision: 1 })
    await screen.findByText(/Incorporação financeira concluída em/)
    expect(within(fin()).queryByRole('button')).toBeNull() // T17
  })

  it('C01-T11/T19/T20 — retomada; nova versão indisponível; procedimentos independentes', async () => {
    openPlan({ prepare: withPermissions(ALL), workPlans: [{ ...FINAL, financialTranscription: { status: 'open' }, financialCategories: [cat] }] })
    await screen.findByRole('heading', { name: 'Incorporação financeira em andamento' })
    expect(await within(fin()).findByRole('button', { name: 'Editar categoria C1' })).toBeTruthy() // T11
    expect(screen.queryByRole('button', { name: 'Registrar alteração formal' })).toBeNull() // T19
    expect(screen.getByText(/Há incorporação financeira em andamento na versão vigente/)).toBeTruthy()
    // T20: a incorporação financeira não habilita metas e indicadores.
    expect(within(screen.getByRole('region', { name: 'Metas e indicadores previstos' })).queryByRole('button', { name: 'Adicionar meta' })).toBeNull()
    cleanup()
    openPlan({ prepare: withPermissions(ALL), workPlans: [{ ...FINAL, transcription: { status: 'open' } }] })
    await screen.findByRole('heading', { name: 'Incorporação complementar em andamento' })
    expect(await within(fin()).findByText(/use "Incorporar planejamento financeiro do Plano aprovado"/)).toBeTruthy()
    expect(within(fin()).queryByRole('button')).toBeNull() // a de metas não habilita o financeiro
  })

  it('C01-T21/T22/T24/T25/T26 — finalização: valor previsto obrigatório nos ativos; zero aceito; descontinuado dispensado; sem declaração financeira', async () => {
    const items = [
      { id: 'f_0000000000000000f0a1', data: itemData('F1', C1, null) },
      { id: 'f_0000000000000000f0a2', data: itemData('F2', C1, 0) },
      { id: 'f_0000000000000000f0a3', data: itemData('F3', C1, null, { status: 'discontinued' }) },
    ]
    const { workPlans } = openPlan({ prepare: withPermissions(ALL), workPlans: [{ ...DRAFT, financialCategories: [cat], financialItems: items }] })
    await screen.findByText(/2 itens ativos · 1 com valor previsto informado · 1 pendente\. A conferência documental do financeiro é opcional\./)
    const pend = () => within(screen.getByRole('list', { name: 'Pendências' })).getAllByRole('listitem').map((li) => li.textContent).join(' ')
    expect(pend()).toMatch(/Item financeiro F1: valor previsto não informado/)
    expect(pend()).not.toMatch(/F2|F3/) // T25/T26
    fireEvent.click(screen.getByRole('button', { name: 'Ir para o item F1' }))
    expect(document.activeElement?.id).toBe('fin-item-f_0000000000000000f0a1')
    fireEvent.click(screen.getByRole('button', { name: 'Editar item F1' }))
    fireEvent.change(screen.getByLabelText(/^Valor previsto/), { target: { value: '1.500,00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar item' }))
    await screen.findByText('Item F1 atualizado e confirmado pelo servidor.')
    await confer() // T22: conferência de metas e indicadores continua obrigatória
    await screen.findByText('Os requisitos para a finalização estão atendidos.')
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar cadastro' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Confirmar finalização interna' })
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(1) // T21: nenhuma declaração financeira adicional
    declareAndConfirm(dialog)
    await screen.findByText('Cadastro no SIGOSC: Estruturado e finalizado internamente')
    expect(Object.keys(workPlans.calls.find((c) => c.kind === 'finalize')?.request ?? {}).sort()).toEqual(['componentsToken', 'declaration', 'expectedRevision', 'oscId', 'partnershipId', 'requestId', 'review', 'workPlanId'])
  })

  it('C01-T28/T29/T30 — divergência e fração de centavo: alertas informativos exatos; total usa o valor previsto', async () => {
    const items = [
      { id: 'f_0000000000000000f0b1', data: itemData('F1', C1, 1_700_000, { quantity: { state: 'informed', value: '12' }, unitValue: { state: 'informed', cents: 150_000 } }) },
      { id: 'f_0000000000000000f0b2', data: itemData('F2', C1, 833, { quantity: { state: 'informed', value: '2.5' }, unitValue: { state: 'informed', cents: 333 } }) },
    ]
    openPlan({ prepare: withPermissions(['partnerships.view', 'work-plan.view']), workPlans: [{ ...DRAFT, financialCategories: [cat], financialItems: items }] })
    await screen.findByText('Total previsto: R$ 17.008,33')
    expect(within(fin()).getByText(/F1: Quantidade × valor unitário \(R\$ 18\.000,00\) difere do valor previsto informado \(R\$ 17\.000,00\); diferença de R\$ 1\.000,00\. Prevalece o valor previsto\./)).toBeTruthy()
    expect(within(fin()).getByText(/F2: Quantidade × valor unitário = R\$ 8,325, que não corresponde a centavos exatos/)).toBeTruthy()
  })

  it('C01-T31/T32/T33/T34 — categoria própria; referência sem reclassificação; outra fonte exige descrição; não informada', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(ALL), workPlans: [{ ...DRAFT, financialCategories: [cat] }] })
    await within(await screen.findByRole('region', { name: 'Planejamento financeiro previsto' })).findByText('Classificação própria do Plano') // T31
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar item à categoria C1' }))
    const form = screen.getByRole('region', { name: 'Adicionar item previsto' })
    fill(/Descrição do item/, 'Material didático')
    fireEvent.change(within(form).getByLabelText(/^Valor previsto/), { target: { value: '100,00' } })
    fireEvent.change(within(form).getByLabelText(/Fonte prevista do recurso/), { target: { value: 'other' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Adicionar item' }))
    expect(await within(form).findByText('Revise os campos indicados. Nada foi gravado.')).toBeTruthy() // T33
    fireEvent.change(within(form).getByLabelText(/Descrição da outra fonte/), { target: { value: 'Doação de empresa parceira' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Adicionar item' }))
    await screen.findByText('Item F1 registrado e confirmado pelo servidor.')
    expect(workPlans.calls.find((c) => c.kind === 'create-financial')?.request).toMatchObject({ data: { fundingSource: 'other', fundingSourceDescription: 'Doação de empresa parceira' } })
    expect(await within(fin()).findByText(/Fonte prevista: Outra fonte — Doação de empresa parceira/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar item à categoria C1' }))
    const second = screen.getByRole('region', { name: 'Adicionar item previsto' })
    fill(/Descrição do item/, 'Lanches')
    fireEvent.change(within(second).getByLabelText(/^Valor previsto/), { target: { value: '50,00' } })
    fireEvent.click(within(second).getByRole('button', { name: 'Adicionar item' }))
    await screen.findByText('Item F2 registrado e confirmado pelo servidor.')
    expect(workPlans.calls.filter((c) => c.kind === 'create-financial')[1]?.request).toMatchObject({ data: { fundingSource: null, fundingSourceDescription: null } }) // T34
    expect(within(fin()).getAllByText(/Fonte prevista/)).toHaveLength(1)
  })
})
