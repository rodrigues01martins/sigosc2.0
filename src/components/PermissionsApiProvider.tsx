import type { ReactNode } from 'react'
import { PermissionsApiContext } from '../hooks/permissionsApiContext.ts'
import type { PermissionsApi } from '../services/permissions/permissionsApi.ts'

/** Disponibiliza o cliente da API de permissões (substituível em testes). */
export function PermissionsApiProvider({ api, children }: { api: PermissionsApi; children: ReactNode }) {
  return <PermissionsApiContext value={api}>{children}</PermissionsApiContext>
}
