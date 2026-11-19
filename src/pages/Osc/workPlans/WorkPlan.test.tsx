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

afterEach(() => {
  cleanup()
  window.location.hash = ''
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
    expect(within(screen.getByRole('list', { name: 'Pendências' })).getAllByRole('listitem')).toHaveLength(3)
    expect((screen.getByRole('button', { name: 'Finalizar cadastro' }) as HTMLButtonElement).disabled).toBe(true)
    fill(/Data da aprovação pelo órgão público/, '2026-02-10')
    fill(/Início do período de execução/, '2026-03-01')
    fill(/Término do período de execução/, '2028-02-28')
    expect(screen.getByText('Salve as alterações antes de finalizar.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await screen.findByText('Os requisitos para a finalização estão atendidos.')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Finalizar cadastro' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar cadastro' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Confirmar finalização interna' })
    expect(dialog.textContent).toMatch(/será preservado.*não representa aprovação jurídica/)
    expect(workPlans.calls.filter((c) => c.kind === 'finalize')).toHaveLength(0) // nada antes da confirmação
    fireEvent.click(within(dialog).getByRole('button', { name: 'Finalizar cadastro' }))
    expect((await screen.findByText(/Cadastro finalizado internamente e preservado/)).getAttribute('role')).toBe('status')
    await screen.findByText('Cadastro no SIGOSC: Estruturado e finalizado internamente')
    expect(workPlans.calls.find((c) => c.kind === 'finalize')?.request).toMatchObject({ expectedRevision: 2 })
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
    expect(items[1]?.textContent).toMatch(/Versão 2.*Vigência não definida: aguarda decisão administrativa.*Em cadastramento/)
    // Cópia integral editável; a original continua finalizada e preservada.
    expect((screen.getByRole('textbox', { name: /^Público atendido/ }) as HTMLTextAreaElement).value).toBe('Crianças')
    expect(workPlans.docs.get(`oscs/${ALFA}/partnerships/${RUNNING}/workPlans/original`)).toMatchObject({ registrationStatus: 'finalized', revision: 3 })
    // Só uma versão pendente: nova alteração formal indisponível, com o motivo.
    expect(screen.queryByRole('button', { name: 'Registrar alteração formal' })).toBeNull()
    expect(screen.getByText(/Já existe uma versão posterior registrada cuja vigência aguarda decisão administrativa/)).toBeTruthy()
  })

  it('DEV-02.3-T05/T09 — editar a nova versão não altera a original; dados do ato editáveis em cadastramento', async () => {
    const { workPlans } = openPlan({ prepare: withPermissions(ALL), workPlans: [ORIGINAL, { ...ORIGINAL, status: 'in-registration', sequence: 2, revision: 1 }] })
    expect(await screen.findByRole('heading', { name: 'Versão 2' })).toBeTruthy()
    // T08: ato gravado (com autoria do servidor) válido → requisitos de finalização atendidos.
    expect(screen.getByText('Os requisitos para a finalização estão atendidos.')).toBeTruthy()
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
    // Versão posterior finalizada sem ativação: a original continua sendo exibida como vigente.
    expect(await screen.findByRole('heading', { name: 'Versão original' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Consultar: Versão 2' }))
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
    expect(screen.getByText(/Metas, indicadores e planejamento financeiro ainda não são estruturados/)).toBeTruthy()
    // T22 (consulta): só view — sem registrar alteração formal.
    expect(screen.queryByRole('button', { name: 'Registrar alteração formal' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar comparação' }))
    expect(screen.queryByRole('table', { name: /Diferenças entre/ })).toBeNull()
  })

  it('DEV-02.3-T20 / bloqueio seguro — arquivada: sem nova versão; versão finalizada não oferece ativação', async () => {
    openPlan({ prepare: withPermissions(ALL), workPlans: [{ ...ORIGINAL, partnershipId: 'pAlfaCooperacao01xx' }] }, 'pAlfaCooperacao01xx')
    await screen.findByRole('heading', { name: 'Versões do Plano de Trabalho' })
    expect(screen.queryByRole('button', { name: 'Registrar alteração formal' })).toBeNull()
    cleanup()
    openPlan({ prepare: withPermissions(ALL), workPlans: [ORIGINAL, { ...ORIGINAL, sequence: 2, revision: 2 }] })
    fireEvent.click(await screen.findByRole('button', { name: 'Consultar: Versão 2' }))
    await screen.findByRole('heading', { name: 'Versão 2' })
    expect(screen.getAllByText('Vigência não definida: aguarda decisão administrativa').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Ativar|Tornar vigente/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Registrar alteração formal' })).toBeNull()
  })
})
