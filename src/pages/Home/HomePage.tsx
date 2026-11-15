import { StatusCard } from '../../components/StatusCard.tsx'
import { APP_INFO } from '../../config/app.ts'
import { isFirebaseConfigured } from '../../config/firebase.ts'
import type { StatusItem } from '../../types/status.ts'
import styles from './HomePage.module.css'

const statusItems: StatusItem[] = [
  { label: 'Frontend React + TypeScript', value: 'Inicializado', level: 'ok' },
  {
    label: 'Firebase',
    value: isFirebaseConfigured
      ? 'Variáveis detectadas — integração ainda não iniciada'
      : 'Integração pendente de configuração',
    level: 'pending',
  },
  { label: 'Ambiente', value: 'Preparação técnica', level: 'info' },
]

/** Página técnica de verificação do ambiente (DEV-00.5). */
export function HomePage() {
  return (
    <section className={styles.panel} aria-labelledby="page-title">
      <header className={styles.header}>
        <h1 id="page-title" className={styles.title}>
          {APP_INFO.name}
        </h1>
        <p className={styles.subtitle}>{APP_INFO.fullName}</p>
      </header>

      <p className={styles.message} role="status">
        Ambiente técnico inicializado com sucesso.
      </p>

      <ul className={styles.list}>
        {statusItems.map((item) => (
          <StatusCard key={item.label} {...item} />
        ))}
      </ul>

      <footer className={styles.footer}>
        Versão técnica inicial — {APP_INFO.technicalVersion}
      </footer>
    </section>
  )
}
