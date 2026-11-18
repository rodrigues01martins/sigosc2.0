/**
 * Ponto único da Gestão de Parcerias (DEV-02.1): consulta (Firestore, sob as Security
 * Rules) e cliente do cadastro e da correção cadastral (servidor, DEV-02.1-C01).
 */
import { getFirebaseServices } from '../firebase/index.ts'
import { createPartnershipService } from './partnershipService.ts'
import { createPartnershipsApi } from './partnershipsApi.ts'
import { firestorePartnershipsSdk } from './sdk.ts'
import type { PartnershipService } from './types.ts'
import type { PartnershipsApi } from './partnershipsApi.ts'

let dependencies: { service: PartnershipService; api: PartnershipsApi } | null = null

export function getPartnershipDependencies() {
  dependencies ??= {
    service: createPartnershipService(getFirebaseServices().firestore, firestorePartnershipsSdk),
    api: createPartnershipsApi({
      fetch: (...args) => globalThis.fetch(...args),
      getIdToken: async () => (await getFirebaseServices().auth?.currentUser?.getIdToken()) ?? null,
    }),
  }
  return dependencies
}

export type * from './types.ts'
export type * from './partnershipsApi.ts'
