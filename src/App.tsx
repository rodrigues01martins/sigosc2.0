import { AuthGate } from './components/AuthGate.tsx'
import { AuthProvider } from './components/AuthProvider.tsx'
import { environmentValidation } from './config/environment.ts'
import type { AuthContextValue } from './hooks/authContext.ts'
import { BaseLayout } from './layouts/BaseLayout.tsx'
import { getAuthService, getAuthStore } from './services/auth/index.ts'

/** Dependências reais de autenticação (criadas uma única vez por carregamento). */
const authDependencies: AuthContextValue = { store: getAuthStore(), service: getAuthService() }

function App() {
  return (
    <AuthProvider value={authDependencies}>
      <BaseLayout>
        <AuthGate environment={environmentValidation.environment} />
      </BaseLayout>
    </AuthProvider>
  )
}

export default App
