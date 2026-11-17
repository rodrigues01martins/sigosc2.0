import styles from './LoadingState.module.css'

interface LoadingStateProps {
  label: string
}

/** Indicador de carregamento acessível (anunciado por leitores de tela). */
export function LoadingState({ label }: LoadingStateProps) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}
