/**
 * Ponto único de acesso aos serviços Firebase (DEV-00.7).
 *
 * A inicialização ocorre uma única vez por carregamento da página (memoização em
 * módulo), independentemente de quantas vezes for chamada — inclusive com a
 * renderização dupla do React StrictMode. Componentes React não devem chamar o
 * SDK diretamente: usam `getFirebaseDiagnostics()` (somente estados) ou, em
 * etapas futuras, `getFirebaseServices()`.
 */
import type { FirebaseApp } from 'firebase/app'
import type { Auth } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import type { FirebaseStorage } from 'firebase/storage'
import { environmentValidation } from '../../config/environment.ts'
import { getFirebaseConfig } from '../../config/firebase.ts'
import {
  initializeFirebaseServices,
  type FirebaseDiagnostics,
  type FirebaseInitResult,
} from './initialization.ts'
import { firebaseWebSdk } from './sdk.ts'

export type FirebaseServices = FirebaseInitResult<FirebaseApp, Auth, Firestore, FirebaseStorage>

let cached: FirebaseServices | null = null

/** Instâncias tipadas (ou `null` quando não inicializadas). */
export function getFirebaseServices(): FirebaseServices {
  cached ??= initializeFirebaseServices(environmentValidation.status, getFirebaseConfig(), firebaseWebSdk)
  return cached
}

/** Apenas os estados dos serviços — sem instâncias, chaves ou IDs. */
export function getFirebaseDiagnostics(): FirebaseDiagnostics {
  return getFirebaseServices().diagnostics
}
