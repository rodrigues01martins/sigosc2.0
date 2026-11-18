import { createContext, useContext } from 'react'
import type { PartnershipsApi } from '../services/partnerships/partnershipsApi.ts'
import type { PartnershipService } from '../services/partnerships/types.ts'

export interface PartnershipDependencies {
  readonly service: PartnershipService
  readonly api: PartnershipsApi
}

export const PartnershipsContext = createContext<PartnershipDependencies | null>(null)

export function usePartnershipDependencies(): PartnershipDependencies {
  const value = useContext(PartnershipsContext)
  if (value === null) throw new Error('usePartnershipDependencies deve ser usado dentro de <PartnershipsProvider>.')
  return value
}
