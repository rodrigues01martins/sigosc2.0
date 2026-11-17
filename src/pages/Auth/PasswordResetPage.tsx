import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { TechnicalPanel } from '../../components/TechnicalPanel.tsx'
import { useAuthActions } from '../../hooks/useAuth.ts'
import { isValidEmail } from '../../utils/validation.ts'
import styles from './AuthPages.module.css'
import {
  PASSWORD_RESET_CONFIRMATION,
  PASSWORD_RESET_ERROR_MESSAGE,
  PROVISIONAL_NOTICE,
} from './messages.ts'

interface PasswordResetPageProps {
  initialEmail?: string
  onBack(email: string): void
}

/**
 * Solicitação de redefinição de senha por e-mail (envio feito pelo próprio
 * Firebase Authentication). A confirmação é sempre genérica.
 */
export function PasswordResetPage({ initialEmail = '', onBack }: PasswordResetPageProps) {
  const { requestPasswordReset } = useAuthActions()
  const id = useId()
  const emailRef = useRef<HTMLInputElement>(null)
  const confirmationRef = useRef<HTMLParagraphElement>(null)
  const [email, setEmail] = useState(initialEmail)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (sent) confirmationRef.current?.focus()
  }, [sent])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setFormError(null)

    if (!isValidEmail(email)) {
      setFieldError(PASSWORD_RESET_ERROR_MESSAGE['invalid-email'])
      emailRef.current?.focus()
      return
    }
    setFieldError(null)

    setSubmitting(true)
    const result = await requestPasswordReset(email)
    setSubmitting(false)
    if (result.ok) {
      setSent(true)
    } else if (result.error === 'invalid-email') {
      setFieldError(PASSWORD_RESET_ERROR_MESSAGE['invalid-email'])
      emailRef.current?.focus()
    } else {
      setFormError(PASSWORD_RESET_ERROR_MESSAGE[result.error])
    }
  }

  const emailErrorId = `${id}-email-error`

  return (
    <TechnicalPanel titleId={`${id}-title`} footer={PROVISIONAL_NOTICE}>
      <div className={styles.intro}>
        <h2 className={styles.heading}>Recuperação de senha</h2>
        {sent ? null : (
          <p className={styles.lead}>Informe seu e-mail para receber as instruções de redefinição.</p>
        )}
      </div>

      {sent ? (
        <div className={styles.stack}>
          <p ref={confirmationRef} className={styles.success} role="status" tabIndex={-1}>
            {PASSWORD_RESET_CONFIRMATION}
          </p>
          <button className={styles.button} type="button" onClick={() => onBack(email)}>
            Voltar ao login
          </button>
        </div>
      ) : (
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
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? emailErrorId : undefined}
              readOnly={submitting}
              required
            />
            {fieldError ? (
              <p id={emailErrorId} className={styles.fieldError}>
                {fieldError}
              </p>
            ) : null}
          </div>

          <button className={styles.button} type="submit" disabled={submitting}>
            {submitting ? 'Enviando…' : 'Enviar instruções'}
          </button>

          <button
            className={styles.linkButton}
            type="button"
            onClick={() => onBack(email)}
            disabled={submitting}
          >
            Voltar ao login
          </button>
        </form>
      )}
    </TechnicalPanel>
  )
}
