import { createContext } from 'react'
import type { OrganizationStore } from '../services/organizations/organizationStore.ts'
import type { OrganizationState } from '../services/organizations/types.ts'

export interface OrganizationContextValue {
  readonly state: OrganizationState
  readonly store: OrganizationStore
}

export const OrganizationContext = createContext<OrganizationContextValue | null>(null)
