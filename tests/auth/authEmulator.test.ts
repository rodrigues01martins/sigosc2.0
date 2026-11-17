/**
 * Integração com o Firebase Auth SDK REAL contra o EMULADOR local (DEV-01.1).
 *
 * Executado somente via `npm run test:auth`, que inicia o emulador do Auth com o
 * projeto fictício `demo-sigosc-auth` (prefixo `demo-` impede acesso a projetos
 * reais). A conta de teste é criada APENAS no emulador, pela API administrativa
 * do próprio emulador — nunca pelo código da aplicação, que não cria usuários.
 * Valida o adaptador real (`firebaseAuthSdk`), não a conectividade com a nuvem.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import { createAuthService } from '../../src/services/auth/authService.ts'
import { createAuthStore } from '../../src/services/auth/authStore.ts'
import { firebaseAuthSdk } from '../../src/services/auth/sdk.ts'
import type { AuthService, AuthState } from '../../src/services/auth/types.ts'

const PROJECT_ID = 'demo-sigosc-auth'
const ACCOUNT = { email: 'conta.emulador@exemplo.invalid', password: 'senha-ficticia-emulador' }

const host = process.env.FIREBASE_AUTH_EMULATOR_HOST
if (!host) throw new Error('FIREBASE_AUTH_EMULATOR_HOST não definido: execute com "npm run test:auth".')
const base = `http://${host}`

/** API administrativa do EMULADOR (token fixo "owner", inexistente fora do emulador). */
async function emulatorAdmin(path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
  })
  assert.ok(response.ok, `${path}: HTTP ${response.status}`)
  return response.json() as Promise<Record<string, unknown>>
}

async function countAccounts(): Promise<number> {
  const result = await emulatorAdmin(`/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:query`, {
    method: 'POST',
    body: JSON.stringify({ returnUserInfo: false }),
  })
  return Number(result.recordsCount ?? 0)
}

async function resetCodesFor(email: string): Promise<number> {
  const result = (await emulatorAdmin(`/emulator/v1/projects/${PROJECT_ID}/oobCodes`)) as {
    oobCodes?: { email: string; requestType: string }[]
  }
  return (result.oobCodes ?? []).filter((c) => c.email === email && c.requestType === 'PASSWORD_RESET').length
}

function waitForState(store: ReturnType<typeof createAuthStore>, status: AuthState['status']) {
  return new Promise<AuthState>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout aguardando ${status}`)), 5000)
    const check = () => {
      const state = store.getSnapshot()
      if (state.status === status) {
        clearTimeout(timer)
        unsubscribe()
        resolve(state)
      }
    }
    const unsubscribe = store.subscribe(check)
    check()
  })
}

let app: FirebaseApp
let auth: Auth
let service: AuthService

before(async () => {
  await fetch(`${base}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } })
  await emulatorAdmin(`/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`, {
    method: 'POST',
    body: JSON.stringify(ACCOUNT),
  })
  app = initializeApp({ apiKey: 'demo-api-key', authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID }, 'auth-emulator-test')
  auth = getAuth(app)
  connectAuthEmulator(auth, base, { disableWarnings: true })
  service = createAuthService(auth, firebaseAuthSdk)
})

after(async () => {
  await deleteApp(app)
})

test('E01 — login real (emulador) e observação da sessão', async () => {
  const store = createAuthStore(service)
  const keepAlive = store.subscribe(() => {})
  await waitForState(store, 'unauthenticated')
  const result = await service.signIn(ACCOUNT.email, ACCOUNT.password)
  assert.ok(result.ok)
  assert.equal(result.data.email, ACCOUNT.email)
  const state = await waitForState(store, 'authenticated')
  assert.equal(state.status === 'authenticated' && state.user.email, ACCOUNT.email)

  // E03 — logout real
  assert.deepEqual(await service.signOut(), { ok: true, data: undefined })
  await waitForState(store, 'unauthenticated')
  keepAlive()
  assert.equal(store.activeObservers(), 0)
})

test('E02 — credenciais inválidas e conta inexistente: mesma categoria; nenhuma conta criada', async () => {
  const before = await countAccounts()
  assert.deepEqual(await service.signIn(ACCOUNT.email, 'senha-errada'), { ok: false, error: 'invalid-credentials' })
  assert.deepEqual(await service.signIn('nao.existe@exemplo.invalid', 'qualquer-senha'), {
    ok: false,
    error: 'invalid-credentials',
  })
  assert.equal(await countAccounts(), before, 'login nunca cria contas')
})

test('E04 — redefinição de senha real: e-mail enviado pelo Auth; resposta idêntica para e-mail inexistente', async () => {
  assert.deepEqual(await service.requestPasswordReset(ACCOUNT.email), { ok: true, data: undefined })
  assert.equal(await resetCodesFor(ACCOUNT.email), 1)
  assert.deepEqual(await service.requestPasswordReset('nao.existe@exemplo.invalid'), { ok: true, data: undefined })
  assert.equal(await resetCodesFor('nao.existe@exemplo.invalid'), 0)
})
