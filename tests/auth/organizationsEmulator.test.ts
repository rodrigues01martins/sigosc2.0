/**
 * Integração Multi-Tenant com SDKs REAIS (Auth + Firestore) contra os EMULADORES (DEV-01.2).
 *
 * Executado via `npm run test:auth` (emuladores de Auth e Firestore, projeto fictício
 * `demo-sigosc-auth`). O emulador do Firestore aplica o `firestore.rules` do repositório.
 * Contas, OSCs e vínculos são criados SOMENTE nos emuladores, pela API administrativa
 * deles (token fixo "owner", inexistente fora do emulador). Não acessa a nuvem.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore'
import { createAuthService } from '../../src/services/auth/authService.ts'
import { createAuthStore } from '../../src/services/auth/authStore.ts'
import { firebaseAuthSdk } from '../../src/services/auth/sdk.ts'
import { mapFirestoreError } from '../../src/services/organizations/errors.ts'
import { createOrganizationService } from '../../src/services/organizations/organizationService.ts'
import { createOrganizationStore } from '../../src/services/organizations/organizationStore.ts'
import { firestoreOrganizationsSdk } from '../../src/services/organizations/sdk.ts'
import { createMemorySelectionStorage } from '../../src/services/organizations/selectionStorage.ts'
import type { OrganizationState } from '../../src/services/organizations/types.ts'
import { MEMBERS, OSCS, USERS, memberDocument, memberPath, oscDocument, oscPath } from '../support/organizationFixtures.ts'

const PROJECT_ID = 'demo-sigosc-auth'
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST
if (!authHost || !firestoreHost) throw new Error('Emuladores ausentes: execute com "npm run test:auth".')

const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }

/** Converte valores simples para o formato REST do Firestore. */
function toValue(value: unknown): Record<string, unknown> {
  if (value === null) return { nullValue: null }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (typeof value === 'string') return { stringValue: value }
  throw new Error(`tipo não suportado: ${typeof value}`)
}

async function seedDocument(path: string, data: Record<string, unknown>) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)]))
  const url = `http://${firestoreHost}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`
  const response = await fetch(url, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) })
  assert.ok(response.ok, `seed ${path}: HTTP ${response.status}`)
}

let app: FirebaseApp
let auth: Auth
let db: Firestore

before(async () => {
  await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE', headers: OWNER })
  await fetch(`http://${firestoreHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE', headers: OWNER })
  for (const user of Object.values(USERS)) {
    const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`, {
      method: 'POST', headers: OWNER, body: JSON.stringify({ localId: user.uid, email: user.email, password: user.password }),
    })
    assert.ok(response.ok)
  }
  for (const osc of Object.values(OSCS)) await seedDocument(oscPath(osc), oscDocument(osc))
  for (const member of MEMBERS) await seedDocument(memberPath(member), memberDocument(member))

  app = initializeApp({ apiKey: 'demo-api-key', authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID }, 'organizations-emulator-test')
  auth = getAuth(app)
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true })
  db = getFirestore(app)
  const [host = '127.0.0.1', port = '8080'] = firestoreHost.split(':')
  connectFirestoreEmulator(db, host, Number(port))
})

after(async () => {
  await deleteApp(app)
})

function waitFor(store: { subscribe(l: () => void): () => void; getSnapshot(): OrganizationState }, predicate: (s: OrganizationState) => boolean) {
  return new Promise<OrganizationState>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${JSON.stringify(store.getSnapshot())}`)), 8000)
    const check = () => {
      const state = store.getSnapshot()
      if (predicate(state)) { clearTimeout(timer); stop(); resolve(state) }
    }
    const stop = store.subscribe(check)
    check()
  })
}

test('I01 — consulta real por grupo de coleções é autorizada pelas regras e retorna só vínculos próprios', async () => {
  const authService = createAuthService(auth, firebaseAuthSdk)
  const service = createOrganizationService(db, firestoreOrganizationsSdk)
  assert.ok((await authService.signIn(USERS.MULTI.email, USERS.MULTI.password)).ok)

  const result = await service.loadMemberships(USERS.MULTI.uid)
  assert.ok(result.ok, JSON.stringify(result))
  const byId = Object.fromEntries(result.data.map((m) => [m.oscId, m]))
  assert.deepEqual(Object.keys(byId).sort(), ['osc-alfa', 'osc-beta', 'osc-delta', 'osc-gama'])
  assert.equal(byId['osc-alfa']?.isAdministrator, true)
  assert.equal(byId['osc-alfa']?.organization?.name, OSCS.ALFA.name)
  assert.equal(byId['osc-gama']?.organization, null)
  assert.equal(byId['osc-delta']?.selectable, false)

  // Tentativas diretas além do autorizado são NEGADAS pelas regras reais.
  for (const attempt of [
    () => firestoreOrganizationsSdk.getOrganization(db, OSCS.GAMA.id), // vínculo inativo
    () => firestoreOrganizationsSdk.listMembershipsByUid(db, USERS.SINGLE.uid), // vínculos de terceiro
    () => firestoreOrganizationsSdk.getMembership(db, OSCS.GAMA.id, USERS.SINGLE.uid),
  ]) {
    await assert.rejects(attempt(), (error) => mapFirestoreError(error) === 'permission-denied')
  }
  await authService.signOut()
})

test('I02 — contexto completo com SDKs reais: U01, U03, U06 e revalidação na troca', async () => {
  const authService = createAuthService(auth, firebaseAuthSdk)
  const authStore = createAuthStore(authService)
  const storage = createMemorySelectionStorage()
  const store = createOrganizationStore({
    authStore,
    service: createOrganizationService(db, firestoreOrganizationsSdk),
    selectionStorage: storage,
  })
  const keep = store.subscribe(() => {})
  await waitFor(store, (s) => s.status === 'signed-out')

  // U01
  await authService.signIn(USERS.SINGLE.email, USERS.SINGLE.password)
  const single = await waitFor(store, (s) => s.status === 'ready' && s.uid === USERS.SINGLE.uid)
  assert.equal(single.status === 'ready' && single.activeOscId, OSCS.GAMA.id)

  // U06
  await authService.signOut()
  await waitFor(store, (s) => s.status === 'signed-out')
  assert.deepEqual(storage.entries(), {})

  // U03
  await authService.signIn(USERS.NONE.email, USERS.NONE.password)
  const none = await waitFor(store, (s) => s.status === 'ready' && s.uid === USERS.NONE.uid)
  assert.equal(none.status === 'ready' && none.memberships.length, 0)
  await authService.signOut()
  await waitFor(store, (s) => s.status === 'signed-out')

  // U02/U05 com revalidação real
  await authService.signIn(USERS.MULTI.email, USERS.MULTI.password)
  await waitFor(store, (s) => s.status === 'ready' && s.uid === USERS.MULTI.uid)
  await store.select(OSCS.ALFA.id)
  await store.select(OSCS.BETA.id)
  const multi = store.getSnapshot()
  assert.equal(multi.status === 'ready' && multi.activeOscId, OSCS.BETA.id)
  await store.select(OSCS.GAMA.id) // inativo
  const after = store.getSnapshot()
  assert.equal(after.status === 'ready' && after.activeOscId, OSCS.BETA.id)
  await authService.signOut()
  await waitFor(store, (s) => s.status === 'signed-out')
  keep()
})
