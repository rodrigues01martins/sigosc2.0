import { AuthGate } from './components/AuthGate.tsx'
import { AuthProvider } from './components/AuthProvider.tsx'
import { OrganizationProvider } from './components/OrganizationProvider.tsx'
import { environmentValidation } from './config/environment.ts'
import type { AuthContextValue } from './hooks/authContext.ts'
import { BaseLayout } from './layouts/BaseLayout.tsx'
import { getAuthService, getAuthStore } from './services/auth/index.ts'
import { getOrganizationStore } from './services/organizations/index.ts'

/** Dependências reais (criadas uma única vez por carregamento). */
const authDependencies: AuthContextValue = { store: getAuthStore(), service: getAuthService() }
const organizationStore = getOrganizationStore()

function App() {
  return (
    <AuthProvider value={authDependencies}>
      <OrganizationProvider store={organizationStore}>
        <BaseLayout>
          <AuthGate environment={environmentValidation.environment} />
        </BaseLayout>
      </OrganizationProvider>
    </AuthProvider>
  )
}

export default App
