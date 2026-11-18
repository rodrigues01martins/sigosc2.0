/** Ponto único do Plano de Trabalho (DEV-02.2): leitura sob as Security Rules e cliente da API. */
import { getFirebaseServices } from '../firebase/index.ts'
import { firestoreWorkPlansSdk } from './sdk.ts'
import { createWorkPlanService } from './workPlanService.ts'
import { createWorkPlansApi, type WorkPlansApi } from './workPlansApi.ts'
import type { WorkPlanService } from './types.ts'

let dependencies: { service: WorkPlanService; api: WorkPlansApi } | null = null

export function getWorkPlanDependencies() {
  dependencies ??= {
    service: createWorkPlanService(getFirebaseServices().firestore, firestoreWorkPlansSdk),
    api: createWorkPlansApi({
      fetch: (...args) => globalThis.fetch(...args),
      getIdToken: async () => (await getFirebaseServices().auth?.currentUser?.getIdToken()) ?? null,
    }),
  }
  return dependencies
}

export type * from './types.ts'
export type * from './workPlansApi.ts'
