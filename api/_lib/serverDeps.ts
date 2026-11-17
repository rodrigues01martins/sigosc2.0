/**
 * Inicialização do Firebase Admin SDK para as funções de servidor (DEV-01.3).
 *
 * Credenciais NUNCA ficam no repositório: são lidas de variáveis de ambiente
 * configuradas no painel da Vercel (somente no ambiente Preview/testes).
 * Sem configuração completa, retorna `null` e a API responde 503 — nenhuma
 * operação privilegiada é possível.
 *
 * Modos:
 * - Emulador (testes): FIRESTORE_EMULATOR_HOST + FIREBASE_AUTH_EMULATOR_HOST e projeto
 *   com prefixo `demo-` (impede qualquer acesso a projeto real).
 * - Testes reais: SIGOSC_SERVER_ENV=test + SIGOSC_FIREBASE_PROJECT_ID +
 *   SIGOSC_FIREBASE_CLIENT_EMAIL + SIGOSC_FIREBASE_PRIVATE_KEY (conta de serviço dedicada).
 *   Qualquer outro valor de SIGOSC_SERVER_ENV mantém a API desativada (produção bloqueada).
 */
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import type { ServerDeps } from './permissionsService.ts'

const APP_NAME = 'sigosc-server'
let cached: ServerDeps | null | undefined

function createApp(env: NodeJS.ProcessEnv): App | null {
  const existing = getApps().find((app) => app.name === APP_NAME)
  if (existing) return existing

  const emulated = Boolean(env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST)
  if (emulated) {
    const projectId = env.GCLOUD_PROJECT ?? env.SIGOSC_FIREBASE_PROJECT_ID ?? ''
    // Emulador apenas com projeto fictício e ambos os emuladores ativos.
    if (!projectId.startsWith('demo-') || !env.FIRESTORE_EMULATOR_HOST || !env.FIREBASE_AUTH_EMULATOR_HOST) return null
    return initializeApp({ projectId }, APP_NAME)
  }

  const { SIGOSC_SERVER_ENV, SIGOSC_FIREBASE_PROJECT_ID, SIGOSC_FIREBASE_CLIENT_EMAIL, SIGOSC_FIREBASE_PRIVATE_KEY } = env
  if (SIGOSC_SERVER_ENV !== 'test') return null
  if (!SIGOSC_FIREBASE_PROJECT_ID || !SIGOSC_FIREBASE_CLIENT_EMAIL || !SIGOSC_FIREBASE_PRIVATE_KEY) return null
  return initializeApp(
    {
      credential: cert({
        projectId: SIGOSC_FIREBASE_PROJECT_ID,
        clientEmail: SIGOSC_FIREBASE_CLIENT_EMAIL,
        privateKey: SIGOSC_FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      projectId: SIGOSC_FIREBASE_PROJECT_ID,
    },
    APP_NAME,
  )
}

export function getServerDeps(env: NodeJS.ProcessEnv = process.env): ServerDeps | null {
  if (cached !== undefined) return cached
  const app = createApp(env)
  if (!app) {
    cached = null
    return cached
  }
  const auth = getAuth(app)
  cached = {
    db: getFirestore(app),
    // checkRevoked=true: sessões revogadas ou contas desativadas são recusadas.
    verifyIdToken: async (token) => ({ uid: (await auth.verifyIdToken(token, true)).uid }),
    async lookupEmails(uids) {
      const emails = new Map<string, string | null>()
      for (let i = 0; i < uids.length; i += 100) {
        const result = await auth.getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })))
        for (const user of result.users) emails.set(user.uid, user.email ?? null)
      }
      return emails
    },
  }
  return cached
}

/** Somente para testes: descarta a instância memorizada. */
export function resetServerDepsForTests(): void {
  cached = undefined
}
