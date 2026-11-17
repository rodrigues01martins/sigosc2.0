/**
 * Tipos da autenticação (DEV-01.1).
 *
 * A autenticação IDENTIFICA o usuário. Ela NÃO autoriza acesso a OSCs, parcerias
 * ou dados: a autorização depende das Security Rules (hoje em negação integral)
 * e de vínculos organizacionais ainda não implementados.
 */

/** Dados mínimos do usuário autenticado expostos à interface (sem tokens). */
export interface AuthUser {
  readonly uid: string
  readonly email: string | null
}

/** Estado da sessão observado pela interface. */
export type AuthState =
  | { readonly status: 'loading' }
  | { readonly status: 'unauthenticated' }
  | { readonly status: 'authenticated'; readonly user: AuthUser }
  /** Configuração Firebase não válida: a autenticação não é executada. */
  | { readonly status: 'unavailable' }

export type AuthStatus = AuthState['status']

/**
 * Categorias de erro seguras para exibição. Nunca carregam mensagens do SDK,
 * e-mails, senhas, tokens ou detalhes internos.
 */
export type AuthErrorKind =
  | 'invalid-email'
  | 'missing-password'
  | 'invalid-credentials'
  | 'too-many-requests'
  | 'network'
  | 'unavailable'
  | 'unknown'

/** Resultado de uma operação de autenticação. */
export type AuthResult<T = undefined> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: AuthErrorKind }

/** Operações de autenticação disponíveis para a interface. */
export interface AuthService {
  /** `false` quando a configuração Firebase não é válida (nenhuma chamada ao SDK é feita). */
  readonly available: boolean
  signIn(email: string, password: string): Promise<AuthResult<AuthUser>>
  signOut(): Promise<AuthResult>
  requestPasswordReset(email: string): Promise<AuthResult>
  /** Observa a sessão; retorna a função que encerra a observação. */
  observe(next: (user: AuthUser | null) => void): () => void
}
