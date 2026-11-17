import { useContext, useMemo } from 'react'
import {
  evaluate,
  type AuthorizationContext,
  type Decision,
  type Operation,
} from '../domain/authorization.ts'
import type { Membership } from '../services/organizations/types.ts'
import type { PermissionsApi } from '../services/permissions/permissionsApi.ts'
import { PermissionsApiContext } from './permissionsApiContext.ts'
import { useAuthState } from './useAuth.ts'

/**
 * Contexto de autorização da OSC ativa, montado a partir do vínculo validado no
 * servidor (DEV-01.2). Serve SOMENTE para decidir o que a interface exibe:
 * cada operação é autorizada novamente pelo servidor e pelas Security Rules.
 */
export function useAuthorizationContext(membership: Membership): AuthorizationContext {
  const auth = useAuthState()
  const uid = auth.status === 'authenticated' ? auth.user.uid : null
  return useMemo(() => {
    const organization = membership.organization
    return {
      uid,
      oscId: membership.oscId,
      organization: organization
        ? {
            id: organization.id,
            registrationStatus: organization.registrationStatus,
            commercialStatus: organization.commercialStatus,
            administratorUid: organization.administratorUid,
          }
        : null,
      membership: uid
        ? { uid, status: membership.status, permissions: membership.permissions, canManagePermissions: membership.canManagePermissions }
        : null,
    }
  }, [membership, uid])
}

/** Avalia uma operação com o avaliador de domínio compartilhado. */
export function decide(context: AuthorizationContext, operation: Operation): Decision {
  return evaluate(context, operation)
}

export function usePermissionsApi(): PermissionsApi {
  const api = useContext(PermissionsApiContext)
  if (api === null) throw new Error('usePermissionsApi deve ser usado dentro de <PermissionsApiProvider>.')
  return api
}
