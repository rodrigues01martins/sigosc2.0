/**
 * Conversão de erros do Firebase Authentication em categorias seguras (DEV-01.1).
 *
 * Apenas o CÓDIGO do erro (ex.: `auth/invalid-credential`) é considerado.
 * Mensagens e stack traces do SDK são descartados, pois podem conter e-mail,
 * identificadores do projeto ou detalhes internos.
 */
import { toSafeErrorCode } from '../firebase/initialization.ts'
import type { AuthErrorKind } from './types.ts'

/**
 * Códigos que indicam credenciais rejeitadas. São unificados para não revelar
 * se o e-mail existe, se a senha está errada ou se a conta está desativada.
 */
const INVALID_CREDENTIAL_CODES = new Set([
  'auth/invalid-credential',
  'auth/invalid-login-credentials',
  'auth/wrong-password',
  'auth/user-not-found',
  'auth/user-disabled',
])

/** Problemas de configuração do projeto: não são culpa do usuário. */
const UNAVAILABLE_CODES = new Set([
  'auth/operation-not-allowed',
  'auth/invalid-api-key',
  'auth/api-key-not-valid',
  'auth/configuration-not-found',
  'auth/unauthorized-domain',
  'auth/app-not-authorized',
])

function commonKind(code: string | undefined): AuthErrorKind | null {
  switch (code) {
    case 'auth/invalid-email':
      return 'invalid-email'
    case 'auth/too-many-requests':
      return 'too-many-requests'
    case 'auth/network-request-failed':
      return 'network'
  }
  if (code && UNAVAILABLE_CODES.has(code)) return 'unavailable'
  return null
}

/** Erros do login com e-mail e senha. */
export function mapSignInError(error: unknown): AuthErrorKind {
  const code = toSafeErrorCode(error)
  if (code && INVALID_CREDENTIAL_CODES.has(code)) return 'invalid-credentials'
  if (code === 'auth/missing-password') return 'missing-password'
  return commonKind(code) ?? 'unknown'
}

/**
 * Erros da recuperação de senha. Retorna `null` quando o erro NÃO deve ser
 * revelado ao usuário (e-mail não cadastrado): a interface mostra a mesma
 * confirmação genérica de uma solicitação bem-sucedida.
 */
export function mapPasswordResetError(error: unknown): AuthErrorKind | null {
  const code = toSafeErrorCode(error)
  if (code === 'auth/user-not-found' || code === 'auth/user-disabled') return null
  return commonKind(code) ?? 'unknown'
}

/** Erros do encerramento de sessão. */
export function mapSignOutError(error: unknown): AuthErrorKind {
  return commonKind(toSafeErrorCode(error)) ?? 'unknown'
}
