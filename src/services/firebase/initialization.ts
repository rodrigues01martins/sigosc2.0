/**
 * Núcleo da inicialização dos serviços Firebase (DEV-00.7).
 *
 * Este módulo NÃO importa o SDK diretamente: recebe um adaptador (`FirebaseSdk`)
 * com as funções oficiais do SDK modular. Isso permite testar a lógica com mocks,
 * sem rede, e garante que só as funções de criação de instância sejam usadas —
 * nenhuma leitura, gravação, consulta, upload ou fluxo de login.
 *
 * Inicializar uma instância NÃO comprova conectividade, autenticação de usuários,
 * autorização de acesso aos dados nem isolamento Multi-Tenant.
 */
import type { FirebaseOptions } from 'firebase/app'
import type { ConfigStatus } from '../../config/environmentValidation.ts'

/** Funções mínimas do SDK necessárias para criar as instâncias. */
export interface FirebaseSdk<TApp, TAuth, TFirestore, TStorage> {
  getApps(): TApp[]
  getApp(): TApp
  initializeApp(options: FirebaseOptions): TApp
  getAuth(app: TApp): TAuth
  getFirestore(app: TApp): TFirestore
  getStorage(app: TApp): TStorage
}

export type ServiceKey = 'app' | 'auth' | 'firestore' | 'storage'
export const SERVICE_KEYS = ['app', 'auth', 'firestore', 'storage'] as const satisfies readonly ServiceKey[]

export type ServiceState = 'initialized' | 'not-initialized' | 'failed'

/** Motivo (não sensível) para um serviço não ter sido inicializado. */
export type NotInitializedReason = 'config-not-valid' | 'app-unavailable'

export interface ServiceStatus {
  state: ServiceState
  reason?: NotInitializedReason
  /** Código técnico do erro (ex.: `app/invalid-api-key`), somente se seguro. */
  errorCode?: string
}

export type FirebaseDiagnostics = Record<ServiceKey, ServiceStatus>

export interface FirebaseInitResult<TApp, TAuth, TFirestore, TStorage> {
  diagnostics: FirebaseDiagnostics
  app: TApp | null
  auth: TAuth | null
  firestore: TFirestore | null
  storage: TStorage | null
}

/** Formato de código do Firebase: `servico/descricao-do-erro`. */
const SAFE_ERROR_CODE = /^[a-z0-9-]+\/[a-z0-9-]+$/

/**
 * Extrai apenas o código do erro, se seguir o padrão do Firebase.
 * Mensagens e stack traces são descartados (podem conter dados de configuração).
 */
export function toSafeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const { code } = error
  return typeof code === 'string' && SAFE_ERROR_CODE.test(code) ? code : undefined
}

function attempt<T>(create: () => T): { instance: T | null; status: ServiceStatus } {
  try {
    return { instance: create(), status: { state: 'initialized' } }
  } catch (error) {
    const errorCode = toSafeErrorCode(error)
    return { instance: null, status: errorCode ? { state: 'failed', errorCode } : { state: 'failed' } }
  }
}

function notInitialized(reason: NotInitializedReason): ServiceStatus {
  return { state: 'not-initialized', reason }
}

/**
 * Inicializa App, Authentication, Firestore e Storage.
 *
 * - Só prossegue se a validação de ambiente (DEV-00.6.2) for `valid` e houver configuração.
 * - Reutiliza o App já existente (`getApps`/`getApp`), evitando `app/duplicate-app`.
 * - Cada serviço é isolado em try/catch: a falha de um não derruba a página.
 */
export function initializeFirebaseServices<TApp, TAuth, TFirestore, TStorage>(
  configStatus: ConfigStatus,
  options: FirebaseOptions | null,
  sdk: FirebaseSdk<TApp, TAuth, TFirestore, TStorage>,
): FirebaseInitResult<TApp, TAuth, TFirestore, TStorage> {
  if (configStatus !== 'valid' || options === null) {
    const status = notInitialized('config-not-valid')
    return {
      diagnostics: { app: status, auth: status, firestore: status, storage: status },
      app: null,
      auth: null,
      firestore: null,
      storage: null,
    }
  }

  const app = attempt(() => (sdk.getApps().length > 0 ? sdk.getApp() : sdk.initializeApp(options)))
  if (app.instance === null) {
    const status = notInitialized('app-unavailable')
    return {
      diagnostics: { app: app.status, auth: status, firestore: status, storage: status },
      app: null,
      auth: null,
      firestore: null,
      storage: null,
    }
  }

  const appInstance = app.instance
  const auth = attempt(() => sdk.getAuth(appInstance))
  const firestore = attempt(() => sdk.getFirestore(appInstance))
  const storage = attempt(() => sdk.getStorage(appInstance))

  return {
    diagnostics: { app: app.status, auth: auth.status, firestore: firestore.status, storage: storage.status },
    app: appInstance,
    auth: auth.instance,
    firestore: firestore.instance,
    storage: storage.instance,
  }
}
