/**
 * Testes da inicialização Firebase (DEV-00.7) — `npm test`.
 * Usa SDK simulado (mock): nenhuma comunicação externa. Valores fictícios.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { FirebaseOptions } from 'firebase/app'
import { validateEnvironmentConfig } from '../../config/environmentValidation.ts'
import {
  initializeFirebaseServices,
  toSafeErrorCode,
  type FirebaseSdk,
} from './initialization.ts'

const options: FirebaseOptions = {
  apiKey: 'fake-api-key',
  authDomain: 'fake.firebaseapp.com',
  projectId: 'projeto-testes',
  storageBucket: 'fake.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:fake',
}

interface FakeApp { id: number }

/** SDK simulado que registra cada chamada e mantém uma lista de apps. */
function createMockSdk(failures: Partial<Record<'initializeApp' | 'getAuth' | 'getFirestore' | 'getStorage', unknown>> = {}) {
  const calls: string[] = []
  const apps: FakeApp[] = []
  const maybeFail = (name: keyof typeof failures) => {
    if (name in failures) throw failures[name]
  }
  const sdk: FirebaseSdk<FakeApp, { kind: 'auth' }, { kind: 'firestore' }, { kind: 'storage' }> = {
    getApps: () => { calls.push('getApps'); return [...apps] },
    getApp: () => {
      calls.push('getApp')
      const app = apps[0]
      if (!app) throw Object.assign(new Error('no app'), { code: 'app/no-app' })
      return app
    },
    initializeApp: () => {
      calls.push('initializeApp')
      maybeFail('initializeApp')
      if (apps.length > 0) throw Object.assign(new Error('dup'), { code: 'app/duplicate-app' })
      const app = { id: apps.length + 1 }
      apps.push(app)
      return app
    },
    getAuth: () => { calls.push('getAuth'); maybeFail('getAuth'); return { kind: 'auth' } },
    getFirestore: () => { calls.push('getFirestore'); maybeFail('getFirestore'); return { kind: 'firestore' } },
    getStorage: () => { calls.push('getStorage'); maybeFail('getStorage'); return { kind: 'storage' } },
  }
  return { sdk, calls, apps }
}

const allNotInitialized = {
  app: { state: 'not-initialized', reason: 'config-not-valid' },
  auth: { state: 'not-initialized', reason: 'config-not-valid' },
  firestore: { state: 'not-initialized', reason: 'config-not-valid' },
  storage: { state: 'not-initialized', reason: 'config-not-valid' },
}

test('F01 — configuração incompleta: nenhum serviço inicializado e SDK não chamado', () => {
  const validation = validateEnvironmentConfig({ VITE_APP_ENV: 'test' })
  assert.equal(validation.status, 'incomplete')
  const { sdk, calls } = createMockSdk()
  const r = initializeFirebaseServices(validation.status, options, sdk)
  assert.deepEqual(r.diagnostics, allNotInitialized)
  assert.equal(r.app, null)
  assert.deepEqual(calls, [])
})

test('F02 — configuração incompatível: nenhum serviço inicializado e SDK não chamado', () => {
  const validation = validateEnvironmentConfig({
    VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_AUTH_DOMAIN: 'd', VITE_FIREBASE_STORAGE_BUCKET: 'b',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '1', VITE_FIREBASE_APP_ID: 'a',
    VITE_FIREBASE_PROJECT_ID: 'projeto-producao', VITE_EXPECTED_FIREBASE_PROJECT_ID: 'projeto-testes',
    VITE_APP_ENV: 'test',
  })
  assert.equal(validation.status, 'incompatible')
  const { sdk, calls } = createMockSdk()
  const r = initializeFirebaseServices(validation.status, options, sdk)
  assert.deepEqual(r.diagnostics, allNotInitialized)
  assert.deepEqual(calls, [])
})

test('F01b — status válido sem objeto de configuração também bloqueia', () => {
  const { sdk, calls } = createMockSdk()
  const r = initializeFirebaseServices('valid', null, sdk)
  assert.deepEqual(r.diagnostics, allNotInitialized)
  assert.deepEqual(calls, [])
})

test('F03 — configuração válida: quatro instâncias criadas', () => {
  const { sdk, calls } = createMockSdk()
  const r = initializeFirebaseServices('valid', options, sdk)
  for (const key of ['app', 'auth', 'firestore', 'storage'] as const) {
    assert.deepEqual(r.diagnostics[key], { state: 'initialized' }, key)
  }
  assert.deepEqual(r.app, { id: 1 })
  assert.deepEqual(r.auth, { kind: 'auth' })
  assert.deepEqual(r.firestore, { kind: 'firestore' })
  assert.deepEqual(r.storage, { kind: 'storage' })
  assert.deepEqual(calls, ['getApps', 'initializeApp', 'getAuth', 'getFirestore', 'getStorage'])
})

test('F04 — falha do App: estado de falha seguro e demais serviços não inicializados', () => {
  const secret = 'AIzaSy-CHAVE-SECRETA'
  const { sdk } = createMockSdk({
    initializeApp: Object.assign(new Error(`Erro com ${secret}`), { code: 'app/invalid-api-key' }),
  })
  const r = initializeFirebaseServices('valid', options, sdk)
  assert.deepEqual(r.diagnostics.app, { state: 'failed', errorCode: 'app/invalid-api-key' })
  assert.deepEqual(r.diagnostics.auth, { state: 'not-initialized', reason: 'app-unavailable' })
  assert.equal(r.app, null)
  assert.ok(!JSON.stringify(r.diagnostics).includes(secret), 'mensagem do erro não pode vazar')
})

test('F04b — falha de um serviço não afeta os demais', () => {
  const { sdk } = createMockSdk({ getStorage: Object.assign(new Error('x'), { code: 'storage/no-default-bucket' }) })
  const r = initializeFirebaseServices('valid', options, sdk)
  assert.deepEqual(r.diagnostics.storage, { state: 'failed', errorCode: 'storage/no-default-bucket' })
  assert.equal(r.storage, null)
  assert.deepEqual(r.diagnostics.auth, { state: 'initialized' })
  assert.deepEqual(r.diagnostics.firestore, { state: 'initialized' })
})

test('F04c — erros sem código seguro não expõem detalhes', () => {
  assert.equal(toSafeErrorCode(new Error('stack e mensagem')), undefined)
  assert.equal(toSafeErrorCode('texto'), undefined)
  assert.equal(toSafeErrorCode({ code: 'Erro com chave AIza 123' }), undefined)
  assert.equal(toSafeErrorCode({ code: 'auth/invalid-api-key' }), 'auth/invalid-api-key')
  const { sdk } = createMockSdk({ getAuth: new Error('detalhe interno') })
  assert.deepEqual(initializeFirebaseServices('valid', options, sdk).diagnostics.auth, { state: 'failed' })
})

test('F05 — inicialização repetida reutiliza o App existente, sem duplicação', () => {
  const { sdk, calls, apps } = createMockSdk()
  const first = initializeFirebaseServices('valid', options, sdk)
  const second = initializeFirebaseServices('valid', options, sdk)
  assert.equal(apps.length, 1)
  assert.equal(second.app, first.app)
  assert.equal(calls.filter((c) => c === 'initializeApp').length, 1)
  assert.equal(calls.filter((c) => c === 'getApp').length, 1)
  assert.deepEqual(second.diagnostics.app, { state: 'initialized' })
})

test('Sem leitura/gravação — módulos de inicialização usam só funções de criação de instância', () => {
  const forbidden = [
    'collection', 'doc(', 'getDoc', 'getDocs', 'setDoc', 'addDoc', 'updateDoc', 'deleteDoc', 'query(',
    'onSnapshot', 'runTransaction', 'writeBatch', 'ref(', 'uploadBytes', 'getDownloadURL', 'listAll',
    'deleteObject', 'signIn', 'createUser', 'signOut', 'onAuthStateChanged', 'sendPasswordReset',
    'setPersistence', 'firebase-admin',
  ]
  for (const file of ['initialization.ts', 'sdk.ts', 'index.ts']) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    for (const term of forbidden) assert.ok(!source.includes(term), `${file} contém "${term}"`)
  }
})
