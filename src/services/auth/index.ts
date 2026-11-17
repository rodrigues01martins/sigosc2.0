/**
 * Ponto único de acesso à autenticação (DEV-01.1).
 *
 * Reutiliza a instância de Auth criada pela DEV-00.7 (`getFirebaseServices`):
 * nenhuma instância adicional do Firebase é criada aqui. Se a configuração do
 * ambiente (DEV-00.6.2) não for válida, `auth` é `null` e o serviço fica
 * indisponível, sem chamar o SDK.
 */
import { getFirebaseServices } from '../firebase/index.ts'
import { createAuthService } from './authService.ts'
import { createAuthStore, type AuthStore } from './authStore.ts'
import { firebaseAuthSdk } from './sdk.ts'
import type { AuthService } from './types.ts'

let service: AuthService | null = null
let store: AuthStore | null = null

export function getAuthService(): AuthService {
  service ??= createAuthService(getFirebaseServices().auth, firebaseAuthSdk)
  return service
}

export function getAuthStore(): AuthStore {
  store ??= createAuthStore(getAuthService())
  return store
}

export type { AuthStore } from './authStore.ts'
export type * from './types.ts'
