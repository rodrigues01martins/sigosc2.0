import { useState } from 'react'
import { ENVIRONMENT_LABEL } from '../config/environmentLabels.ts'
import type { AppEnvironment } from '../config/environmentValidation.ts'
import { useAuthState } from '../hooks/useAuth.ts'
import { AuthenticatedPage } from '../pages/Auth/AuthenticatedPage.tsx'
import { LoginPage } from '../pages/Auth/LoginPage.tsx'
import { PasswordResetPage } from '../pages/Auth/PasswordResetPage.tsx'
import { HomePage } from '../pages/Home/HomePage.tsx'
import { LoadingState } from './LoadingState.tsx'

interface AuthGateProps {
  environment: AppEnvironment | null
}

/**
 * Controle de acesso às páginas técnicas conforme o estado da sessão (DEV-01.1).
 *
 * ATENÇÃO: isto controla apenas o que a INTERFACE exibe. Não é mecanismo de
 * autorização — a proteção dos dados depende das Security Rules no servidor.
 */
export function AuthGate({ environment }: AuthGateProps) {
  const state = useAuthState()

  switch (state.status) {
    case 'loading':
      return <LoadingState label="Verificando sessão…" />
    case 'unavailable':
      return (
        <HomePage
          notice={
            <>
              Autenticação indisponível: a configuração do Firebase deste ambiente não é válida.
              Consulte o diagnóstico abaixo.
            </>
          }
        />
      )
    case 'unauthenticated':
      return <PublicArea />
    case 'authenticated':
      return (
        <AuthenticatedPage
          user={state.user}
          environmentLabel={environment ? ENVIRONMENT_LABEL[environment] : 'Não identificado'}
        />
      )
  }
}

/** Login e recuperação de senha — únicas páginas acessíveis sem sessão. */
function PublicArea() {
  const [view, setView] = useState<{ name: 'login' | 'reset'; email: string; switched: boolean }>({
    name: 'login',
    email: '',
    switched: false,
  })

  if (view.name === 'reset') {
    return (
      <PasswordResetPage
        initialEmail={view.email}
        onBack={(email) => setView({ name: 'login', email, switched: true })}
      />
    )
  }
  return (
    <LoginPage
      initialEmail={view.email}
      autoFocus={view.switched}
      onForgotPassword={(email) => setView({ name: 'reset', email, switched: true })}
    />
  )
}
