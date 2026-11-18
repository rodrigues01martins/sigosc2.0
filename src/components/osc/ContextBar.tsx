import type { ReactNode } from 'react'
import styles from '../../layouts/OscShell.module.css'

/** DSC-NAV-06 — faixa de contexto: OSC ativa e parceria selecionada (DEV-02.1). */
export function ContextBar({ oscName, extra, partnership = 'Parceria: não selecionada' }: { oscName: string; extra?: ReactNode; partnership?: string }) {
  return (
    <div className={styles.contextBar} aria-label="Contexto atual">
      <div>
        Contexto: <strong>{oscName}</strong>
        {extra}
      </div>
      <div>{partnership}</div>
    </div>
  )
}
