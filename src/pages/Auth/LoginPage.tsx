import { useId, useRef, useState, type FormEvent } from 'react'
import { TechnicalPanel } from '../../components/TechnicalPanel.tsx'
import { useAuthActions } from '../../hooks/useAuth.ts'
import { isPasswordProvided, isValidEmail } from '../../utils/validation.ts'
import styles from './AuthPages.module.css'
import { PROVISIONAL_NOTICE, SIGN_IN_ERROR_MESSAGE } from './messages.ts'

interface LoginPageProps {
  initialEmail?: string
  autoFocus?: boolean
  onForgotPassword(email: string): void
}

interface FieldErrors {
  email?: string
  password?: string
}

/** Login com e-mail e senha (interface técnica provisória). Sem cadastro público. */
export function LoginPage({ initialEmail = '', autoFocus = false, onForgotPassword }: LoginPageProps) {
  const { signIn } = useAuthActions()
  const id = useId()
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setFormError(null)

    const errors: FieldErrors = {}
    if (!isValidEmail(email)) errors.email = SIGN_IN_ERROR_MESSAGE['invalid-email']
    if (!isPasswordProvided(password)) errors.password = SIGN_IN_ERROR_MESSAGE['missing-password']
    setFieldErrors(errors)
    if (errors.email) return emailRef.current?.focus()
    if (errors.password) return passwordRef.current?.focus()

    setSubmitting(true)
    const result = await signIn(email, password)
    // Em caso de sucesso, o observador da sessão substitui esta página.
    if (!result.ok) {
      setSubmitting(false)
      setFormError(SIGN_IN_ERROR_MESSAGE[result.error])
      setPassword('')
      passwordRef.current?.focus()
    }
  }

  const emailErrorId = `${id}-email-error`
  const passwordErrorId = `${id}-password-error`

  return (
    <TechnicalPanel titleId={`${id}-title`} footer={PROVISIONAL_NOTICE}>
      <div className={styles.intro}>
        <h2 className={styles.heading}>Acesso ao sistema</h2>
        <p className={styles.lead}>Entre com seu e-mail e senha.</p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit} noValidate aria-busy={submitting}>
        {formError ? (
          <p className={styles.alert} role="alert">
            {formError}
          </p>
        ) : null}

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-email`}>
            E-mail
          </label>
          <input
            ref={emailRef}
            id={`${id}-email`}
            className={styles.input}
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            autoFocus={autoFocus}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? emailErrorId : undefined}
            readOnly={submitting}
            required
          />
          {fieldErrors.email ? (
            <p id={emailErrorId} className={styles.fieldError}>
              {fieldErrors.email}
            </p>
          ) : null}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-password`}>
            Senha
          </label>
          <input
            ref={passwordRef}
            id={`${id}-password`}
            className={styles.input}
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={fieldErrors.password ? passwordErrorId : undefined}
            readOnly={submitting}
            required
          />
          {fieldErrors.password ? (
            <p id={passwordErrorId} className={styles.fieldError}>
              {fieldErrors.password}
            </p>
          ) : null}
        </div>

        <button className={styles.button} type="submit" disabled={submitting}>
          {submitting ? 'Entrando…' : 'Entrar'}
        </button>

        <button
          className={styles.linkButton}
          type="button"
          onClick={() => onForgotPassword(email)}
          disabled={submitting}
        >
          Esqueci minha senha
        </button>
      </form>
    </TechnicalPanel>
  )
}
