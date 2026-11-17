import type { ReactNode } from 'react'
import { APP_INFO } from '../config/app.ts'
import styles from './TechnicalPanel.module.css'

interface TechnicalPanelProps {
  /** Id do título, para `aria-labelledby`. */
  titleId: string
  children: ReactNode
  footer?: ReactNode
}

/** Painel com a identificação SIGOSC 2.0, usado pelas páginas técnicas. */
export function TechnicalPanel({ titleId, children, footer }: TechnicalPanelProps) {
  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <header className={styles.header}>
        <h1 id={titleId} className={styles.title}>
          {APP_INFO.name}
        </h1>
        <p className={styles.subtitle}>{APP_INFO.fullName}</p>
      </header>
      {children}
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </section>
  )
}
