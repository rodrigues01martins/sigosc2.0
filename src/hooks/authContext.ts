import { createContext } from 'react'
import type { AuthStore } from '../services/auth/authStore.ts'
import type { AuthService } from '../services/auth/types.ts'

/** Dependências de autenticação injetadas na árvore React (substituíveis em testes). */
export interface AuthContextValue {
  readonly store: AuthStore
  readonly service: AuthService
}

export const AuthContext = createContext<AuthContextValue | null>(null)
