/**
 * Ponto único da API de permissões (DEV-01.3). Usa o usuário atual do Firebase
 * Authentication (instância da DEV-00.7) apenas para obter o token de ID.
 */
import { getFirebaseServices } from '../firebase/index.ts'
import { createPermissionsApi, type PermissionsApi } from './permissionsApi.ts'

let api: PermissionsApi | null = null

export function getPermissionsApi(): PermissionsApi {
  api ??= createPermissionsApi({
    fetch: (...args) => globalThis.fetch(...args),
    getIdToken: async () => (await getFirebaseServices().auth?.currentUser?.getIdToken()) ?? null,
  })
  return api
}

export type * from './permissionsApi.ts'
