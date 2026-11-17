import { useContext } from 'react'
import type { Membership, OrganizationState } from '../services/organizations/types.ts'
import { OrganizationContext, type OrganizationContextValue } from './organizationContext.ts'

function useOrganizationContext(): OrganizationContextValue {
  const value = useContext(OrganizationContext)
  if (value === null) throw new Error('useOrganization deve ser usado dentro de <OrganizationProvider>.')
  return value
}

/** Estado completo do contexto organizacional. */
export function useOrganizationState(): OrganizationState {
  return useOrganizationContext().state
}

/** Ações do contexto (seleção e nova consulta). */
export function useOrganizationActions(): { select(oscId: string): Promise<void>; reload(): Promise<void> } {
  const { store } = useOrganizationContext()
  return { select: store.select, reload: store.reload }
}

/** Vínculo da OSC ativa, ou `null`. Não é autorização: o Firestore revalida cada acesso. */
export function useActiveMembership(): Membership | null {
  const state = useOrganizationState()
  if (state.status !== 'ready' || state.activeOscId === null) return null
  return state.memberships.find((m) => m.oscId === state.activeOscId) ?? null
}
