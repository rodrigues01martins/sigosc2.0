/**
 * Renderização da aplicação autenticada com Auth, Firestore e servidor de
 * permissões SIMULADOS (dados fictícios, sem rede) — testes de interface.
 */
import { StrictMode } from 'react'
import { render } from '@testing-library/react'
import { AuthGate } from '../../src/components/AuthGate.tsx'
import { AuthProvider } from '../../src/components/AuthProvider.tsx'
import { OrganizationProvider } from '../../src/components/OrganizationProvider.tsx'
import { PartnershipsProvider } from '../../src/components/PartnershipsProvider.tsx'
import { PermissionsApiProvider } from '../../src/components/PermissionsApiProvider.tsx'
import { sanitizePermissions } from '../../src/domain/authorization.ts'
import { createAuthService } from '../../src/services/auth/authService.ts'
import { createAuthStore } from '../../src/services/auth/authStore.ts'
import { createOrganizationService } from '../../src/services/organizations/organizationService.ts'
import { createOrganizationStore } from '../../src/services/organizations/organizationStore.ts'
import { createMemorySelectionStorage } from '../../src/services/organizations/selectionStorage.ts'
import { createPartnershipService } from '../../src/services/partnerships/partnershipService.ts'
import { createFakeAuthSdk } from './fakeAuthSdk.ts'
import { createFakeOrganizationsSdk } from './fakeOrganizationsSdk.ts'
import { createFakePartnerships } from './fakePartnerships.ts'
import { createFakePermissionsServer, type FakeServerMember } from './fakePermissionsServer.ts'
import { MEMBERS, OSCS, USERS, memberDocument, memberPath } from './organizationFixtures.ts'
import type { PartnershipFixture } from './partnershipFixtures.ts'
import { PERMISSION_MEMBERS, PERMISSION_USERS } from './permissionFixtures.ts'

export const ALL_USERS = { ...USERS, ...PERMISSION_USERS }
export type TestUser = (typeof ALL_USERS)[keyof typeof ALL_USERS]
const ALL_MEMBERS = [...MEMBERS, ...PERMISSION_MEMBERS]

export interface RenderOptions {
  suspendAlfa?: boolean
  /** Campos manipulados no vínculo do próprio usuário em ALFA, vistos só pelo navegador. */
  forge?: Record<string, unknown>
  storage?: ReturnType<typeof createMemorySelectionStorage>
  prepare?: (db: ReturnType<typeof createFakeOrganizationsSdk>) => void
  /** DEV-02.1: parcerias simuladas (padrão: fixtures de ALFA e GAMA). */
  partnerships?: PartnershipFixture[]
  /** DEV-02.1: tamanho de página da consulta (padrão do serviço). */
  pageSize?: number
}

export function renderOscApp(user: TestUser, { suspendAlfa = false, forge, storage = createMemorySelectionStorage(), prepare, partnerships, pageSize }: RenderOptions = {}) {
  const fakeAuth = createFakeAuthSdk({ accounts: Object.values(ALL_USERS).map((u) => ({ ...u })), persistedUser: { ...user } })
  const authService = createAuthService(fakeAuth.auth, fakeAuth.sdk)
  const authStore = createAuthStore(authService)
  const fakeDb = createFakeOrganizationsSdk()
  for (const m of PERMISSION_MEMBERS) fakeDb.docs.set(memberPath(m), memberDocument(m))
  if (suspendAlfa) fakeDb.docs.set('oscs/osc-alfa', { ...fakeDb.docs.get('oscs/osc-alfa'), commercialStatus: 'suspended' })
  if (forge) fakeDb.docs.set(memberPath({ oscId: OSCS.ALFA.id, uid: user.uid }), { ...fakeDb.docs.get(memberPath({ oscId: OSCS.ALFA.id, uid: user.uid })), ...forge })
  prepare?.(fakeDb)
  const server = createFakePermissionsServer(
    Object.values(OSCS).map((o) => ({ ...o, commercialStatus: suspendAlfa && o.id === 'osc-alfa' ? 'suspended' : o.commercialStatus })),
    Object.fromEntries(
      Object.values(OSCS).map((o) => [
        o.id,
        ALL_MEMBERS.filter((m) => m.oscId === o.id).map(
          (m): FakeServerMember => ({
            uid: m.uid,
            status: m.status,
            email: Object.values(ALL_USERS).find((u) => u.uid === m.uid)?.email ?? null,
            permissions: sanitizePermissions('permissions' in m ? m.permissions : []),
            canManagePermissions: 'canManagePermissions' in m && m.canManagePermissions === true,
          }),
        ),
      ]),
    ),
  )
  const organizationStore = createOrganizationStore({ authStore, service: createOrganizationService(fakeDb.db, fakeDb.sdk), selectionStorage: storage })
  const api = server.apiFor(() => {
    const state = authStore.getSnapshot()
    return state.status === 'authenticated' ? state.user.uid : null
  })
  const fakePartnerships = createFakePartnerships(partnerships)
  const partnershipDependencies = {
    service: createPartnershipService(fakePartnerships.db, fakePartnerships.sdk, pageSize),
    api: fakePartnerships.api,
  }
  render(
    <StrictMode>
      <AuthProvider value={{ store: authStore, service: authService }}>
        <OrganizationProvider store={organizationStore}>
          <PermissionsApiProvider api={api}>
            <PartnershipsProvider value={partnershipDependencies}>
              <AuthGate environment="test" />
            </PartnershipsProvider>
          </PermissionsApiProvider>
        </OrganizationProvider>
      </AuthProvider>
    </StrictMode>,
  )
  return { server, fakeDb, storage, organizationStore, partnerships: fakePartnerships }
}
