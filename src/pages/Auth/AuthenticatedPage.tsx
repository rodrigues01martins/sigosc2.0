import { useId, useState } from 'react'
import { TechnicalPanel } from '../../components/TechnicalPanel.tsx'
import { useAuthActions } from '../../hooks/useAuth.ts'
import type { AuthUser } from '../../services/auth/types.ts'
import styles from './AuthPages.module.css'
import { PROVISIONAL_NOTICE, SIGN_OUT_ERROR_MESSAGE } from './messages.ts'

interface AuthenticatedPageProps {
  user: AuthUser
  environmentLabel: string
}

/**
 * Página técnica temporária de sessão autenticada (DEV-01.1).
 * Estar autenticado NÃO concede permissões: nenhum dado é acessado aqui.
 */
export function AuthenticatedPage({ user, environmentLabel }: AuthenticatedPageProps) {
  const { signOut } = useAuthActions()
  const id = useId()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSignOut() {
    if (signingOut) return
    setError(null)
    setSigningOut(true)
    const result = await signOut()
    // Em caso de sucesso, o observador da sessão retorna ao login.
    if (!result.ok) {
      setSigningOut(false)
      setError(SIGN_OUT_ERROR_MESSAGE)
    }
  }

  return (
    <TechnicalPanel titleId={`${id}-title`} footer={PROVISIONAL_NOTICE}>
      <div className={styles.intro}>
        <p className={styles.success} role="status">
          Autenticação concluída.
        </p>
      </div>

      <dl className={styles.details}>
        <div>
          <dt>Usuário autenticado</dt>
          <dd>{user.email ?? 'E-mail não informado'}</dd>
        </div>
        <div>
          <dt>Ambiente</dt>
          <dd>{environmentLabel}</dd>
        </div>
      </dl>

      <div className={styles.stack}>
        <p className={styles.notice}>
          O acesso às OSCs ainda não foi implementado. A autenticação identifica o usuário,
          mas não concede permissão de acesso a organizações, parcerias ou dados.
        </p>

        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}

        <button
          className={styles.secondaryButton}
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          aria-busy={signingOut}
        >
          {signingOut ? 'Saindo…' : 'Sair'}
        </button>
      </div>
    </TechnicalPanel>
  )
}
