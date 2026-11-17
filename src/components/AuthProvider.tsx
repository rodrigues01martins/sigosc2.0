import type { ReactNode } from 'react'
import { AuthContext, type AuthContextValue } from '../hooks/authContext.ts'

interface AuthProviderProps {
  value: AuthContextValue
  children: ReactNode
}

/** Disponibiliza o store e o serviço de autenticação para a árvore React. */
export function AuthProvider({ value, children }: AuthProviderProps) {
  return <AuthContext value={value}>{children}</AuthContext>
}
