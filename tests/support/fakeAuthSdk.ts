/**
 * Firebase Auth SDK SIMULADO (DEV-01.1) — usado por `npm test`.
 *
 * Mantém um "diretório" de contas em memória, com valores fictícios. NÃO é um
 * teste de conectividade: nenhuma requisição de rede é feita e nenhum projeto
 * Firebase real é acessado. Registra cada chamada para as verificações.
 */
import type { AuthSdk, SdkUser } from '../../src/services/auth/authService.ts'

export interface FakeAuth {
  readonly kind: 'fake-auth'
}

export interface FakeAccount {
  uid: string
  email: string
  password: string
}

/** Erro no formato do Firebase, com mensagem contendo dados sensíveis (para A09). */
export function firebaseError(code: string, message = 'detalhe interno'): Error {
  return Object.assign(new Error(message), { code, customData: { appName: '[DEFAULT]' } })
}

export interface FakeAuthOptions {
  accounts?: FakeAccount[]
  /** Usuário já presente na persistência (simula sessão restaurada). */
  persistedUser?: FakeAccount
  /** Erros forçados por operação. */
  failures?: Partial<Record<keyof AuthSdk<FakeAuth>, unknown>>
  /** Se `true`, o observador NÃO notifica imediatamente (sessão em carregamento). */
  deferInitialNotification?: boolean
}

export function createFakeAuthSdk(options: FakeAuthOptions = {}) {
  const auth: FakeAuth = { kind: 'fake-auth' }
  const accounts = new Map((options.accounts ?? []).map((a) => [a.email, a]))
  const calls: string[] = []
  const resetRequests: string[] = []
  const observers = new Set<(user: SdkUser | null) => void>()
  let maxConcurrentObservers = 0
  let currentUser: SdkUser | null = options.persistedUser
    ? { uid: options.persistedUser.uid, email: options.persistedUser.email }
    : null
  let persistence: 'none' | 'local' = 'none'

  const fail = (name: keyof AuthSdk<FakeAuth>) => {
    if (options.failures && name in options.failures) throw options.failures[name]
  }
  const notify = () => {
    for (const observer of observers) observer(currentUser)
  }

  const sdk: AuthSdk<FakeAuth> = {
    async setLocalPersistence() {
      calls.push('setLocalPersistence')
      fail('setLocalPersistence')
      persistence = 'local'
    },
    async signInWithEmailAndPassword(_auth, email, password) {
      calls.push('signInWithEmailAndPassword')
      fail('signInWithEmailAndPassword')
      const account = accounts.get(email)
      if (!account || account.password !== password) {
        throw firebaseError(
          'auth/invalid-credential',
          `Firebase: login falhou para ${email} com senha ${password} (auth/invalid-credential).`,
        )
      }
      // Usuário do SDK real possui muitos campos; o serviço deve copiar só uid/email.
      const user = Object.assign({ uid: account.uid, email: account.email }, {
        accessToken: 'token-ficticio-nao-expor',
        refreshToken: 'refresh-ficticio-nao-expor',
      })
      currentUser = user
      notify()
      return { user }
    },
    async signOut() {
      calls.push('signOut')
      fail('signOut')
      currentUser = null
      notify()
    },
    async sendPasswordResetEmail(_auth, email) {
      calls.push('sendPasswordResetEmail')
      fail('sendPasswordResetEmail')
      if (!accounts.has(email)) throw firebaseError('auth/user-not-found', `Sem conta para ${email}`)
      resetRequests.push(email)
    },
    onAuthStateChanged(_auth, next) {
      calls.push('onAuthStateChanged')
      observers.add(next)
      maxConcurrentObservers = Math.max(maxConcurrentObservers, observers.size)
      if (!options.deferInitialNotification) queueMicrotask(() => observers.has(next) && next(currentUser))
      return () => {
        observers.delete(next)
      }
    },
  }

  return {
    auth,
    sdk,
    calls,
    resetRequests,
    /** Emite manualmente o estado atual (usado quando a notificação inicial é adiada). */
    emitCurrentUser: notify,
    activeObservers: () => observers.size,
    maxConcurrentObservers: () => maxConcurrentObservers,
    persistence: () => persistence,
  }
}

/** Contas FICTÍCIAS usadas nos testes (nenhuma existe em projeto real). */
export const TEST_ACCOUNT: FakeAccount = {
  uid: 'uid-ficticio-001',
  email: 'usuario.teste@exemplo.invalid',
  password: 'senha-ficticia-123',
}
