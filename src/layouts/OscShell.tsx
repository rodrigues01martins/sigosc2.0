import { useEffect, useRef, type ReactNode } from 'react'
import { BrandMark, LayersIcon } from '../components/ds/icons.tsx'
import styles from './OscShell.module.css'

interface OscShellProps {
  /** Título da página (h1). */
  title: string
  /** Identifica a página exibida; ao mudar, o foco vai para o título. */
  pageKey: string
  description?: ReactNode
  oscSelector: ReactNode
  navigation: ReactNode
  userArea: ReactNode
  footer: ReactNode
  children: ReactNode
}

/**
 * Estrutura da Gestão da OSC (HF-G05): sidebar verde-petróleo, cabeçalho com título
 * e selo de contexto, área principal. A sidebar desce para cima do conteúdo em telas
 * estreitas (quebra natural do flex, como no protótipo).
 */
export function OscShell({ title, pageKey, description, oscSelector, navigation, userArea, footer, children }: OscShellProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    titleRef.current?.focus()
  }, [pageKey])

  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar} aria-label="Navegação da Gestão da OSC">
        <div className={styles.brand}>
          <BrandMark />
          <span>SIGOSC 2.0</span>
        </div>
        <div className={styles.blockRow}>
          <LayersIcon />
          <div>
            <div className={styles.blockLabel}>Contexto</div>
            <div className={styles.blockValue}>Gestão da OSC</div>
          </div>
        </div>
        {oscSelector}
        {navigation}
        <div className={styles.sidebarFooter}>{footer}</div>
      </nav>

      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 ref={titleRef} className={styles.title} tabIndex={-1}>
              {title}
            </h1>
            <span className={styles.chip}>Gestão da OSC</span>
          </div>
          {userArea}
        </header>
        {description ? <p className={styles.description}>{description}</p> : null}
        {children}
      </main>
    </div>
  )
}
