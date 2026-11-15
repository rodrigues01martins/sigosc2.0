/**
 * Validação determinística da configuração de ambiente (DEV-00.6.2).
 *
 * Função PURA: não lê `import.meta.env`, não acessa a rede e não inicializa
 * nenhum serviço Firebase. Recebe as variáveis como parâmetro, o que permite
 * testá-la isoladamente (ver `environmentValidation.test.ts`).
 *
 * IMPORTANTE: um resultado "válido" indica apenas que as variáveis estão
 * presentes e coerentes entre si. NÃO prova conexão real com o Firebase.
 * Variáveis `VITE_` são públicas e nunca devem ser usadas para autorização.
 */

/** Seis variáveis do Firebase Web exigidas em todos os ambientes. */
export const FIREBASE_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const

/** Variáveis de controle de ambiente. */
export const ENVIRONMENT_CONTROL_KEYS = [
  'VITE_APP_ENV',
  'VITE_EXPECTED_FIREBASE_PROJECT_ID',
] as const

export const REQUIRED_ENV_KEYS = [...FIREBASE_ENV_KEYS, ...ENVIRONMENT_CONTROL_KEYS] as const

export type RequiredEnvKey = (typeof REQUIRED_ENV_KEYS)[number]

/** Entrada da validação: subconjunto de variáveis (todas opcionais). */
export type EnvironmentInput = Partial<Record<RequiredEnvKey, string | undefined>>

/** Valores aceitos em `VITE_APP_ENV`. */
export const ALLOWED_APP_ENVS = ['test', 'production'] as const
export type AppEnvironment = (typeof ALLOWED_APP_ENVS)[number]

export type ConfigStatus = 'valid' | 'incomplete' | 'incompatible'

export type ConfigIssue =
  | 'missing-variables'
  | 'invalid-app-env'
  | 'project-id-mismatch'

export interface EnvironmentValidationResult {
  /** Classificação final da configuração. */
  status: ConfigStatus
  /** Ambiente identificado, ou `null` se ausente/inválido. */
  environment: AppEnvironment | null
  /** NOMES das variáveis ausentes (nunca valores). */
  missingKeys: RequiredEnvKey[]
  /** Problemas encontrados, em ordem de verificação. */
  issues: ConfigIssue[]
}

function isPresent(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isAllowedAppEnv(value: string): value is AppEnvironment {
  return (ALLOWED_APP_ENVS as readonly string[]).includes(value)
}

/**
 * Classifica a configuração do ambiente.
 *
 * Regras:
 * 1. Variável vazia ou só com espaços conta como ausente.
 * 2. `VITE_APP_ENV` deve ser exatamente `test` ou `production` (sensível a maiúsculas).
 * 3. `VITE_FIREBASE_PROJECT_ID` deve ser idêntico a `VITE_EXPECTED_FIREBASE_PROJECT_ID`
 *    (comparação exata, sem normalização).
 *
 * Precedência: incompatibilidade detectada (ambiente inválido ou IDs divergentes)
 * prevalece sobre ausência de variáveis, pois indica erro de configuração definitivo.
 */
export function validateEnvironmentConfig(env: EnvironmentInput): EnvironmentValidationResult {
  const missingKeys = REQUIRED_ENV_KEYS.filter((key) => !isPresent(env[key]))
  const issues: ConfigIssue[] = []

  if (missingKeys.length > 0) issues.push('missing-variables')

  const appEnv = env.VITE_APP_ENV
  let environment: AppEnvironment | null = null
  if (isPresent(appEnv)) {
    if (isAllowedAppEnv(appEnv)) environment = appEnv
    else issues.push('invalid-app-env')
  }

  const projectId = env.VITE_FIREBASE_PROJECT_ID
  const expectedProjectId = env.VITE_EXPECTED_FIREBASE_PROJECT_ID
  if (isPresent(projectId) && isPresent(expectedProjectId) && projectId !== expectedProjectId) {
    issues.push('project-id-mismatch')
  }

  let status: ConfigStatus = 'valid'
  if (issues.includes('invalid-app-env') || issues.includes('project-id-mismatch')) {
    status = 'incompatible'
  } else if (issues.includes('missing-variables')) {
    status = 'incomplete'
  }

  return { status, environment, missingKeys, issues }
}
