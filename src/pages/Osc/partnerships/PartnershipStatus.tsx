import type { AdministrativeStatus } from '../../../domain/partnerships.ts'
import { administrativeStatusLabel } from '../../../domain/partnerships.ts'
import styles from './Partnerships.module.css'

/** status.partnership.* — situação ADMINISTRATIVA da parceria (não a comercial da OSC). */
export function PartnershipStatus({ status }: { status: AdministrativeStatus }) {
  const icon =
    status === 'em-execucao' ? <path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" /> : status === 'suspensa' ? <path d="M6 4v8M10 4v8" /> : <path d="M3 5h10v8H3zM2 3h12v2H2z" />
  return (
    <span className={styles[`status_${status}`]}>
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
        {icon}
      </svg>
      {administrativeStatusLabel(status)}
    </span>
  )
}
