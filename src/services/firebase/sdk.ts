/**
 * Adaptador do Firebase Web SDK modular (oficial).
 * Expõe SOMENTE funções de criação/obtenção de instâncias — nenhuma operação
 * de dados, autenticação de usuários ou acesso a arquivos.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getStorage, type FirebaseStorage } from 'firebase/storage'
import type { FirebaseSdk } from './initialization.ts'

export const firebaseWebSdk: FirebaseSdk<FirebaseApp, Auth, Firestore, FirebaseStorage> = {
  getApps,
  getApp: () => getApp(),
  initializeApp: (options) => initializeApp(options),
  getAuth,
  getFirestore: (app) => getFirestore(app),
  getStorage: (app) => getStorage(app),
}
