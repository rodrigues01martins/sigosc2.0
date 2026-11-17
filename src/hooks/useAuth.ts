import { useContext, useSyncExternalStore } from 'react'
import type { AuthService, AuthState } from '../services/auth/types.ts'
import { AuthContext, type AuthContextValue } from './authContext.ts'

function useAuthContext(): AuthContextValue {
  const value = useContext(AuthContext)
  if (value === null) throw new Error('useAuth deve ser usado dentro de <AuthProvider>.')
  return value
}

/** Estado atual da sessão (loading, unauthenticated, authenticated ou unavailable). */
export function useAuthState(): AuthState {
  const { store } = useAuthContext()
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

/** Operações de autenticação. Componentes não chamam o SDK diretamente. */
export function useAuthActions(): Pick<AuthService, 'signIn' | 'signOut' | 'requestPasswordReset'> {
  return useAuthContext().service
}
