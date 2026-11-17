/**
 * Serviço de autenticação (DEV-01.1).
 *
 * Encapsula `signInWithEmailAndPassword`, `signOut`, `sendPasswordResetEmail` e
 * `onAuthStateChanged`. Assim como a DEV-00.7, recebe o SDK por um adaptador
 * (`AuthSdk`), o que permite testar com SDK simulado, sem rede.
 *
 * Garantias:
 * - Sem instância de Auth (configuração não válida) → nenhuma chamada ao SDK.
 * - Nenhuma função de criação de usuários existe no adaptador (sem cadastro público).
 * - Nenhum log: senhas, e-mails, tokens e mensagens do SDK nunca são registrados.
 * - O usuário exposto contém apenas `uid` e `email`.
 */
import { isPasswordProvided, isValidEmail, normalizeEmail } from '../../utils/validation.ts'
import { mapPasswordResetError, mapSignInError, mapSignOutError } from './errors.ts'
import type { AuthResult, AuthService, AuthUser } from './types.ts'

/** Subconjunto do usuário do SDK lido por este serviço. */
export interface SdkUser {
  readonly uid: string
  readonly email: string | null
}

/** Funções do Firebase Auth SDK modular usadas pelo serviço — e somente elas. */
export interface AuthSdk<TAuth> {
  /** Aplica a persistência LOCAL (sessão mantida após recarregar a página). */
  setLocalPersistence(auth: TAuth): Promise<void>
  signInWithEmailAndPassword(auth: TAuth, email: string, password: string): Promise<{ user: SdkUser }>
  signOut(auth: TAuth): Promise<void>
  sendPasswordResetEmail(auth: TAuth, email: string): Promise<void>
  onAuthStateChanged(
    auth: TAuth,
    next: (user: SdkUser | null) => void,
    error: (error: unknown) => void,
  ): () => void
}

const UNAVAILABLE = { ok: false, error: 'unavailable' } as const

/** Copia apenas os campos permitidos (descarta tokens e demais propriedades). */
export function toAuthUser(user: SdkUser): AuthUser {
  return { uid: user.uid, email: user.email }
}

export function createAuthService<TAuth>(auth: TAuth | null, sdk: AuthSdk<TAuth>): AuthService {
  if (auth === null) {
    return {
      available: false,
      signIn: () => Promise.resolve(UNAVAILABLE),
      signOut: () => Promise.resolve(UNAVAILABLE),
      requestPasswordReset: () => Promise.resolve(UNAVAILABLE),
      observe: () => () => {},
    }
  }

  const instance: TAuth = auth
  let persistence: Promise<void> | null = null

  /**
   * Política inicial: persistência LOCAL, aplicada uma vez, antes do primeiro login.
   * Se o navegador bloquear o armazenamento local, o SDK mantém a sessão apenas em
   * memória (perdida ao recarregar); o login continua possível.
   */
  function ensureLocalPersistence(): Promise<void> {
    persistence ??= sdk.setLocalPersistence(instance).catch(() => {
      persistence = null
    })
    return persistence
  }

  return {
    available: true,

    async signIn(email, password): Promise<AuthResult<AuthUser>> {
      const normalized = normalizeEmail(email)
      if (!isValidEmail(normalized)) return { ok: false, error: 'invalid-email' }
      if (!isPasswordProvided(password)) return { ok: false, error: 'missing-password' }
      await ensureLocalPersistence()
      try {
        const credential = await sdk.signInWithEmailAndPassword(instance, normalized, password)
        return { ok: true, data: toAuthUser(credential.user) }
      } catch (error) {
        return { ok: false, error: mapSignInError(error) }
      }
    },

    async signOut(): Promise<AuthResult> {
      try {
        await sdk.signOut(instance)
        return { ok: true, data: undefined }
      } catch (error) {
        return { ok: false, error: mapSignOutError(error) }
      }
    },

    async requestPasswordReset(email): Promise<AuthResult> {
      const normalized = normalizeEmail(email)
      if (!isValidEmail(normalized)) return { ok: false, error: 'invalid-email' }
      try {
        await sdk.sendPasswordResetEmail(instance, normalized)
      } catch (error) {
        const kind = mapPasswordResetError(error)
        if (kind !== null) return { ok: false, error: kind }
      }
      return { ok: true, data: undefined }
    },

    observe(next) {
      return sdk.onAuthStateChanged(
        instance,
        (user) => next(user ? toAuthUser(user) : null),
        () => next(null),
      )
    },
  }
}
