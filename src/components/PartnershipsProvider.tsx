import type { ReactNode } from 'react'
import { PartnershipsContext, type PartnershipDependencies } from '../hooks/partnershipsContext.ts'

/** Disponibiliza consulta e cadastro de parcerias (substituíveis em testes). */
export function PartnershipsProvider({ value, children }: { value: PartnershipDependencies; children: ReactNode }) {
  return <PartnershipsContext value={value}>{children}</PartnershipsContext>
}
