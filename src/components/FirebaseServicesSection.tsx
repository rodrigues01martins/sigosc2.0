import type {
  FirebaseDiagnostics,
  ServiceKey,
  ServiceStatus,
} from '../services/firebase/initialization.ts'
import { SERVICE_KEYS } from '../services/firebase/initialization.ts'
import type { StatusItem } from '../types/status.ts'
import { StatusCard } from './StatusCard.tsx'
import styles from './FirebaseServicesSection.module.css'

const SERVICE_LABEL: Record<ServiceKey, string> = {
  app: 'Firebase App',
  auth: 'Firebase Authentication',
  firestore: 'Cloud Firestore',
  storage: 'Firebase Cloud Storage',
}

const REASON_LABEL = {
  'config-not-valid': 'configuração não válida',
  'app-unavailable': 'Firebase App indisponível',
} as const

/** Converte o estado técnico em texto exibível. Nunca usa o termo "Conectado". */
function toStatusItem(key: ServiceKey, status: ServiceStatus): StatusItem {
  const label = SERVICE_LABEL[key]
  switch (status.state) {
    case 'initialized':
      return { label, value: 'Inicializado', level: 'ok' }
    case 'not-initialized':
      return {
        label,
        value: status.reason ? `Não inicializado — ${REASON_LABEL[status.reason]}` : 'Não inicializado',
        level: 'pending',
      }
    case 'failed':
      return {
        label,
        value: status.errorCode ? `Falha de inicialização — código ${status.errorCode}` : 'Falha de inicialização',
        level: 'error',
      }
  }
}

interface Props {
  diagnostics: FirebaseDiagnostics
}

/** Seção "Serviços Firebase" da página técnica. Recebe apenas estados, nunca instâncias. */
export function FirebaseServicesSection({ diagnostics }: Props) {
  return (
    <section className={styles.section} aria-labelledby="firebase-services-title">
      <h2 id="firebase-services-title" className={styles.title}>
        Serviços Firebase
      </h2>
      <ul className={styles.list}>
        {SERVICE_KEYS.map((key) => {
          const item = toStatusItem(key, diagnostics[key])
          return <StatusCard key={key} {...item} />
        })}
      </ul>
      <p className={styles.note}>
        A inicialização dos SDKs não comprova conectividade com os serviços Firebase,
        autenticação de usuários ou autorização de acesso aos dados.
      </p>
    </section>
  )
}
