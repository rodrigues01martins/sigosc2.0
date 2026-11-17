import type { ReactNode } from 'react'
import { FirebaseServicesSection } from '../../components/FirebaseServicesSection.tsx'
import { StatusCard } from '../../components/StatusCard.tsx'
import { TechnicalPanel } from '../../components/TechnicalPanel.tsx'
import { APP_INFO } from '../../config/app.ts'
import { environmentValidation } from '../../config/environment.ts'
import { ENVIRONMENT_LABEL } from '../../config/environmentLabels.ts'
import type { ConfigStatus, EnvironmentValidationResult } from '../../config/environmentValidation.ts'
import { getFirebaseDiagnostics } from '../../services/firebase/index.ts'
import type { StatusItem, StatusLevel } from '../../types/status.ts'
import styles from './HomePage.module.css'

const CONFIG_STATUS: Record<ConfigStatus, { value: string; level: StatusLevel }> = {
  valid: { value: 'Válida', level: 'ok' },
  incomplete: { value: 'Incompleta', level: 'pending' },
  incompatible: { value: 'Incompatível', level: 'error' },
}

/** Monta os itens exibidos. Nunca expõe valores de chaves ou IDs — apenas nomes de variáveis. */
function buildStatusItems(result: EnvironmentValidationResult): StatusItem[] {
  const config = CONFIG_STATUS[result.status]
  const details: string[] = []
  if (result.issues.includes('invalid-app-env')) details.push('valor de VITE_APP_ENV não permitido')
  if (result.issues.includes('project-id-mismatch')) details.push('projeto Firebase diferente do esperado')
  if (result.missingKeys.length > 0) details.push(`ausentes: ${result.missingKeys.join(', ')}`)

  return [
    { label: 'Frontend React + TypeScript', value: 'Inicializado', level: 'ok' },
    {
      label: 'Ambiente identificado',
      value: result.environment ? ENVIRONMENT_LABEL[result.environment] : 'Não identificado',
      level: result.environment ? 'info' : 'pending',
    },
    {
      label: 'Configuração Firebase',
      value: details.length > 0 ? `${config.value} — ${details.join('; ')}` : config.value,
      level: config.level,
    },
  ]
}

const statusItems = buildStatusItems(environmentValidation)
const firebaseDiagnostics = getFirebaseDiagnostics()

interface HomePageProps {
  /** Aviso exibido no lugar da mensagem de sucesso (ex.: autenticação indisponível). */
  notice?: ReactNode
}

/**
 * Página técnica de diagnóstico do ambiente (DEV-00.5, atualizada em DEV-00.6.2 e DEV-00.7).
 * Desde a DEV-01.1, é exibida quando a configuração impede a autenticação.
 */
export function HomePage({ notice }: HomePageProps) {
  return (
    <TechnicalPanel titleId="page-title" footer={<>Versão técnica — {APP_INFO.technicalVersion}</>}>
      {notice ? (
        <p className={styles.alert} role="alert">
          {notice}
        </p>
      ) : (
        <p className={styles.message} role="status">
          Ambiente técnico inicializado com sucesso.
        </p>
      )}

      <ul className={styles.list}>
        {statusItems.map((item) => (
          <StatusCard key={item.label} {...item} />
        ))}
      </ul>

      <FirebaseServicesSection diagnostics={firebaseDiagnostics} />
    </TechnicalPanel>
  )
}
