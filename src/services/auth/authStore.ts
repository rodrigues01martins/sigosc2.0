/**
 * Store da sessão para o React (DEV-01.1), compatível com `useSyncExternalStore`.
 *
 * Existe NO MÁXIMO um observador `onAuthStateChanged` ativo, independentemente do
 * número de componentes inscritos: ele é criado com o primeiro inscrito e
 * encerrado com o último. Isso evita observadores duplicados e vazamentos no
 * React StrictMode (que monta, desmonta e remonta os efeitos em desenvolvimento).
 */
import type { AuthState, AuthService } from './types.ts'

export interface AuthStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): AuthState
  /** Quantidade de observadores do SDK ativos (0 ou 1). Usado em diagnóstico e testes. */
  activeObservers(): number
}

const LOADING: AuthState = { status: 'loading' }
const UNAUTHENTICATED: AuthState = { status: 'unauthenticated' }
const UNAVAILABLE: AuthState = { status: 'unavailable' }

function sameState(a: AuthState, b: AuthState): boolean {
  if (a.status === 'authenticated' && b.status === 'authenticated') {
    return a.user.uid === b.user.uid && a.user.email === b.user.email
  }
  return a.status === b.status
}

export function createAuthStore(service: AuthService): AuthStore {
  let state: AuthState = service.available ? LOADING : UNAVAILABLE
  let stopObserving: (() => void) | null = null
  const listeners = new Set<() => void>()

  function setState(next: AuthState) {
    if (sameState(state, next)) return
    state = next
    for (const listener of listeners) listener()
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      if (service.available && stopObserving === null) {
        stopObserving = service.observe((user) => {
          setState(user ? { status: 'authenticated', user } : UNAUTHENTICATED)
        })
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && stopObserving !== null) {
          stopObserving()
          stopObserving = null
        }
      }
    },
    getSnapshot: () => state,
    activeObservers: () => (stopObserving === null ? 0 : 1),
  }
}
