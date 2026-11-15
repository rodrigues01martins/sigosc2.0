import type { StatusItem } from '../types/status.ts'
import styles from './StatusCard.module.css'

/** Cartão que exibe um item de status técnico. */
export function StatusCard({ label, value, level }: StatusItem) {
  return (
    <li className={`${styles.card} ${styles[level]}`}>
      <span className={styles.dot} aria-hidden="true" />
      <div>
        <p className={styles.label}>{label}</p>
        <p className={styles.value}>{value}</p>
      </div>
    </li>
  )
}
