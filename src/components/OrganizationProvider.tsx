import { useSyncExternalStore, type ReactNode } from 'react'
import { OrganizationContext } from '../hooks/organizationContext.ts'
import type { OrganizationStore } from '../services/organizations/organizationStore.ts'

interface OrganizationProviderProps {
  store: OrganizationStore
  children: ReactNode
}

/**
 * Mantém o contexto organizacional inscrito durante toda a vida da aplicação,
 * para que o logout sempre limpe o contexto (U06), mesmo sem telas montadas.
 */
export function OrganizationProvider({ store, children }: OrganizationProviderProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return <OrganizationContext value={{ state, store }}>{children}</OrganizationContext>
}
