import type { ReactNode } from 'react'
import styles from './BaseLayout.module.css'

interface BaseLayoutProps {
  children: ReactNode
}

/** Layout base: estrutura mínima que centraliza o conteúdo da página. */
export function BaseLayout({ children }: BaseLayoutProps) {
  return (
    <div className={styles.shell}>
      <main className={styles.main}>{children}</main>
    </div>
  )
}
