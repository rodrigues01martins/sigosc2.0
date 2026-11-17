/**
 * Testes de interface da autenticação (DEV-01.1) — `npm run test:ui` (Vitest + jsdom).
 *
 * Usam o serviço REAL (`createAuthService` + `createAuthStore`) sobre o Firebase
 * Auth SDK SIMULADO. Não são testes de conectividade com o Firebase.
 */
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeAuthSdk, firebaseError, TEST_ACCOUNT, type FakeAuthOptions } from '../../tests/support/fakeAuthSdk.ts'
import { createAuthService } from '../services/auth/authService.ts'
import { createAuthStore } from '../services/auth/authStore.ts'
import { AuthGate } from './AuthGate.tsx'
import { AuthProvider } from './AuthProvider.tsx'

afterEach(cleanup)

function renderApp(options: FakeAuthOptions = { accounts: [TEST_ACCOUNT] }, { available = true, strict = false } = {}) {
  const fake = createFakeAuthSdk(options)
  const service = createAuthService(available ? fake.auth : null, fake.sdk)
  const store = createAuthStore(service)
  const tree = (
    <AuthProvider value={{ store, service }}>
      <AuthGate environment="test" />
    </AuthProvider>
  )
  const view = render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  return { fake, store, service, view }
}

const emailInput = () => screen.getByLabelText('E-mail')
const passwordInput = () => screen.getByLabelText('Senha')

function fillLogin(email: string, password: string) {
  fireEvent.change(emailInput(), { target: { value: email } })
  fireEvent.change(passwordInput(), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
}

describe('Sessão em carregamento', () => {
  it('exibe indicador acessível enquanto o estado não é conhecido', () => {
    renderApp({ accounts: [TEST_ACCOUNT], deferInitialNotification: true })
    expect(screen.getByRole('status').textContent).toContain('Verificando sessão')
    expect(screen.queryByLabelText('E-mail')).toBeNull()
  })
})

describe('A05 — usuário não autenticado recebe a interface de login', () => {
  it('mostra identificação, campos acessíveis e opções, sem cadastro público (A11)', async () => {
    renderApp()
    expect(await screen.findByRole('heading', { level: 1, name: 'SIGOSC 2.0' })).toBeTruthy()
    expect(screen.getByText('Sistema de Gestão de Parcerias com Organizações da Sociedade Civil')).toBeTruthy()
    expect(emailInput().getAttribute('type')).toBe('email')
    expect(emailInput().getAttribute('autocomplete')).toBe('username')
    expect(passwordInput().getAttribute('type')).toBe('password')
    expect(passwordInput().getAttribute('autocomplete')).toBe('current-password')
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Esqueci minha senha' })).toBeTruthy()
    expect(screen.getByText(/Interface técnica provisória/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/cadastr|criar conta|registr/i)
  })

  it('valida campos antes de chamar o serviço e associa mensagens aos campos', async () => {
    const { fake } = renderApp()
    await screen.findByLabelText('E-mail')
    fillLogin('email-invalido', '')
    expect(emailInput().getAttribute('aria-invalid')).toBe('true')
    expect(passwordInput().getAttribute('aria-invalid')).toBe('true')
    const describedBy = emailInput().getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(describedBy)?.textContent).toBe('Informe um e-mail em formato válido.')
    expect(document.activeElement).toBe(emailInput())
    expect(fake.calls).not.toContain('signInWithEmailAndPassword')
  })
})

describe('A01/A06 — login e página técnica protegida', () => {
  it('após login válido exibe somente a página autenticada', async () => {
    const { fake } = renderApp()
    await screen.findByLabelText('E-mail')
    fillLogin(TEST_ACCOUNT.email, TEST_ACCOUNT.password)

    expect(await screen.findByText('Autenticação concluída.')).toBeTruthy()
    expect(screen.getByText(TEST_ACCOUNT.email)).toBeTruthy()
    expect(screen.getByText('Testes')).toBeTruthy()
    expect(screen.getByText(/O acesso às OSCs ainda não foi implementado/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy()
    expect(screen.queryByLabelText('Senha')).toBeNull()
    expect(document.body.textContent).not.toContain(TEST_ACCOUNT.password)
    expect(fake.calls).toEqual(['onAuthStateChanged', 'setLocalPersistence', 'signInWithEmailAndPassword'])
  })

  it('sessão persistida é restaurada diretamente na página autenticada (A04)', async () => {
    const { fake } = renderApp({ accounts: [TEST_ACCOUNT], persistedUser: TEST_ACCOUNT })
    expect(await screen.findByText('Autenticação concluída.')).toBeTruthy()
    expect(fake.calls).not.toContain('signInWithEmailAndPassword')
  })
})

describe('A02/A09 — login rejeitado', () => {
  it('exibe mensagem genérica, limpa a senha e não expõe dados sensíveis', async () => {
    const errorSpy = vi.spyOn(console, 'error')
    renderApp()
    await screen.findByLabelText('E-mail')
    fillLogin(TEST_ACCOUNT.email, 'senha-errada-XYZ')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('E-mail ou senha incorretos.')
    expect((passwordInput() as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(passwordInput())
    expect(document.body.textContent).not.toMatch(/senha-errada-XYZ|auth\/|Firebase/)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('indica carregamento e bloqueia reenvio durante a tentativa', async () => {
    let release: () => void = () => {}
    const { fake } = renderApp({ accounts: [TEST_ACCOUNT] })
    const original = fake.sdk.signInWithEmailAndPassword
    fake.sdk.signInWithEmailAndPassword = (...args) =>
      new Promise((resolve, reject) => {
        release = () => original(...args).then(resolve, reject)
      })
    await screen.findByLabelText('E-mail')
    fillLogin(TEST_ACCOUNT.email, 'senha-errada')
    const button = await screen.findByRole('button', { name: 'Entrando…' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(button.closest('form')?.getAttribute('aria-busy')).toBe('true')
    await act(async () => release())
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})

describe('A03 — logout', () => {
  it('encerra a sessão e retorna ao login', async () => {
    const { fake } = renderApp({ accounts: [TEST_ACCOUNT], persistedUser: TEST_ACCOUNT })
    fireEvent.click(await screen.findByRole('button', { name: 'Sair' }))
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeTruthy()
    expect(fake.calls).toContain('signOut')
  })

  it('falha no logout mantém a sessão e mostra erro genérico', async () => {
    renderApp({
      accounts: [TEST_ACCOUNT],
      persistedUser: TEST_ACCOUNT,
      failures: { signOut: firebaseError('auth/network-request-failed') },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Sair' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível encerrar a sessão. Tente novamente.')
    expect(screen.getByText('Autenticação concluída.')).toBeTruthy()
  })
})

describe('A07 — recuperação de senha', () => {
  async function openReset() {
    await screen.findByLabelText('E-mail')
    fireEvent.change(emailInput(), { target: { value: TEST_ACCOUNT.email } })
    fireEvent.click(screen.getByRole('button', { name: 'Esqueci minha senha' }))
    await screen.findByRole('heading', { name: 'Recuperação de senha' })
  }

  it('envia a solicitação, mostra confirmação genérica e permite voltar ao login', async () => {
    const { fake } = renderApp()
    await openReset()
    expect((emailInput() as HTMLInputElement).value).toBe(TEST_ACCOUNT.email)
    fireEvent.click(screen.getByRole('button', { name: 'Enviar instruções' }))
    const confirmation = await screen.findByText(/Se o e-mail informado estiver cadastrado/)
    expect(fake.resetRequests).toEqual([TEST_ACCOUNT.email])
    await waitFor(() => expect(document.activeElement).toBe(confirmation))
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao login' }))
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeTruthy()
  })

  it('e-mail não cadastrado recebe a MESMA confirmação (sem enumeração)', async () => {
    const { fake } = renderApp()
    await openReset()
    fireEvent.change(emailInput(), { target: { value: 'nao.existe@exemplo.invalid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar instruções' }))
    expect(await screen.findByText(/Se o e-mail informado estiver cadastrado/)).toBeTruthy()
    expect(fake.resetRequests).toEqual([])
  })

  it('valida o formato do e-mail antes de enviar', async () => {
    const { fake } = renderApp()
    await openReset()
    fireEvent.change(emailInput(), { target: { value: 'invalido' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar instruções' }))
    expect(screen.getByText('Informe um e-mail em formato válido.')).toBeTruthy()
    expect(fake.calls).not.toContain('sendPasswordResetEmail')
  })
})

describe('A08 — configuração inválida', () => {
  it('não exibe login, mostra mensagem técnica segura e diagnóstico, sem chamar o SDK', () => {
    const { fake } = renderApp({ accounts: [TEST_ACCOUNT] }, { available: false })
    expect(screen.getByRole('alert').textContent).toContain('Autenticação indisponível')
    expect(screen.getByRole('heading', { name: 'Serviços Firebase' })).toBeTruthy()
    expect(screen.queryByLabelText('Senha')).toBeNull()
    expect(fake.calls).toEqual([])
  })
})

describe('A10 — React StrictMode', () => {
  it('mantém um único observador ativo e o encerra ao desmontar', async () => {
    const { fake, store, view } = renderApp({ accounts: [TEST_ACCOUNT] }, { strict: true })
    await screen.findByRole('button', { name: 'Entrar' })
    expect(fake.activeObservers()).toBe(1)
    expect(store.activeObservers()).toBe(1)
    expect(fake.maxConcurrentObservers()).toBe(1)

    fillLogin(TEST_ACCOUNT.email, TEST_ACCOUNT.password)
    await screen.findByText('Autenticação concluída.')
    expect(fake.activeObservers()).toBe(1)

    view.unmount()
    expect(fake.activeObservers()).toBe(0)
    expect(store.activeObservers()).toBe(0)
  })
})
