/**
 * Ponto único do contexto organizacional (DEV-01.2).
 * Reutiliza a instância do Firestore da DEV-00.7 e o store de autenticação da DEV-01.1.
 */
import { getAuthStore } from '../auth/index.ts'
import { getFirebaseServices } from '../firebase/index.ts'
import { createOrganizationService } from './organizationService.ts'
import { createOrganizationStore, type OrganizationStore } from './organizationStore.ts'
import { firestoreOrganizationsSdk } from './sdk.ts'
import { createBrowserSelectionStorage } from './selectionStorage.ts'

let store: OrganizationStore | null = null

export function getOrganizationStore(): OrganizationStore {
  store ??= createOrganizationStore({
    authStore: getAuthStore(),
    service: createOrganizationService(getFirebaseServices().firestore, firestoreOrganizationsSdk),
    selectionStorage: createBrowserSelectionStorage(),
  })
  return store
}

export type { OrganizationStore } from './organizationStore.ts'
export type * from './types.ts'
