import { AuthGate } from './components/AuthGate.tsx'
import { AuthProvider } from './components/AuthProvider.tsx'
import { OrganizationProvider } from './components/OrganizationProvider.tsx'
import { PartnershipsProvider } from './components/PartnershipsProvider.tsx'
import { PermissionsApiProvider } from './components/PermissionsApiProvider.tsx'
import { environmentValidation } from './config/environment.ts'
import type { AuthContextValue } from './hooks/authContext.ts'
import { getAuthService, getAuthStore } from './services/auth/index.ts'
import { getOrganizationStore } from './services/organizations/index.ts'
import { getPartnershipDependencies } from './services/partnerships/index.ts'
import { getPermissionsApi } from './services/permissions/index.ts'

/** Dependências reais (criadas uma única vez por carregamento). */
const authDependencies: AuthContextValue = { store: getAuthStore(), service: getAuthService() }
const organizationStore = getOrganizationStore()
const permissionsApi = getPermissionsApi()
const partnerships = getPartnershipDependencies()

function App() {
  return (
    <AuthProvider value={authDependencies}>
      <OrganizationProvider store={organizationStore}>
        <PermissionsApiProvider api={permissionsApi}>
          <PartnershipsProvider value={partnerships}>
            <AuthGate environment={environmentValidation.environment} />
          </PartnershipsProvider>
        </PermissionsApiProvider>
      </OrganizationProvider>
    </AuthProvider>
  )
}

export default App
