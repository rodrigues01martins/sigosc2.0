/**
 * Testes da autenticação (DEV-01.1) — `npm test`.
 *
 * Usam o Firebase Auth SDK SIMULADO (`tests/support/fakeAuthSdk.ts`), com contas
 * fictícias e sem rede. NÃO são testes de conectividade com o Firebase real.
 * Os testes de interface (A05, A06, A10 no React) estão em `src/components/AuthGate.test.tsx`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createFakeAuthSdk, firebaseError, TEST_ACCOUNT } from '../../../tests/support/fakeAuthSdk.ts'
import { createAuthService } from './authService.ts'
import { createAuthStore } from './authStore.ts'
import { mapPasswordResetError, mapSignInError } from './errors.ts'
import { firebaseAuthSdk } from './sdk.ts'
import type { AuthState } from './types.ts'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(options: Parameters<typeof createFakeAuthSdk>[0] = { accounts: [TEST_ACCOUNT] }) {
  const fake = createFakeAuthSdk(options)
  const service = createAuthService(fake.auth, fake.sdk)
  return { fake, service }
}

/** Arquivos-fonte da aplicação (exclui testes). */
function sourceFiles(dir = new URL('../..', import.meta.url).pathname): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}
const SRC_ROOT = new URL('../..', import.meta.url).pathname
/** Remove comentários para que a documentação não gere falsos positivos. */
const code = (path: string) =>
  readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('A01 — login bem-sucedido com credenciais simuladas válidas', async () => {
  const { fake, service } = setup()
  const result = await service.signIn(`  ${TEST_ACCOUNT.email} `, TEST_ACCOUNT.password)
  assert.deepEqual(result, { ok: true, data: { uid: TEST_ACCOUNT.uid, email: TEST_ACCOUNT.email } })
  // Persistência local aplicada ANTES do login.
  assert.deepEqual(fake.calls, ['setLocalPersistence', 'signInWithEmailAndPassword'])
  assert.equal(fake.persistence(), 'local')
})

test('A02 — login rejeitado por credenciais inválidas (mensagem unificada)', async () => {
  const { fake, service } = setup()
  assert.deepEqual(await service.signIn(TEST_ACCOUNT.email, 'senha-errada'), {
    ok: false,
    error: 'invalid-credentials',
  })
  assert.deepEqual(await service.signIn('nao.existe@exemplo.invalid', 'qualquer'), {
    ok: false,
    error: 'invalid-credentials',
  })
  // Códigos que revelariam existência/estado da conta são unificados.
  for (const code of ['auth/wrong-password', 'auth/user-not-found', 'auth/user-disabled', 'auth/invalid-login-credentials']) {
    assert.equal(mapSignInError(firebaseError(code)), 'invalid-credentials', code)
  }
  // Validação local: o SDK não é chamado com entrada inválida.
  const callsBefore = fake.calls.length
  assert.deepEqual(await service.signIn('email-invalido', 'x'), { ok: false, error: 'invalid-email' })
  assert.deepEqual(await service.signIn(TEST_ACCOUNT.email, ''), { ok: false, error: 'missing-password' })
  assert.equal(fake.calls.length, callsBefore)
  // Outros erros mapeados para categorias seguras.
  assert.equal(mapSignInError(firebaseError('auth/too-many-requests')), 'too-many-requests')
  assert.equal(mapSignInError(firebaseError('auth/network-request-failed')), 'network')
  assert.equal(mapSignInError(firebaseError('auth/operation-not-allowed')), 'unavailable')
  assert.equal(mapSignInError(new Error('sem código')), 'unknown')
})

test('A03 — logout bem-sucedido notifica sessão encerrada', async () => {
  const { fake, service } = setup()
  const store = createAuthStore(service)
  const unsubscribe = store.subscribe(() => {})
  await service.signIn(TEST_ACCOUNT.email, TEST_ACCOUNT.password)
  await tick()
  assert.equal(store.getSnapshot().status, 'authenticated')

  assert.deepEqual(await service.signOut(), { ok: true, data: undefined })
  assert.deepEqual(store.getSnapshot(), { status: 'unauthenticated' })
  assert.ok(fake.calls.includes('signOut'))

  // Falha no logout é reportada sem detalhes.
  const failing = setup({ failures: { signOut: firebaseError('auth/network-request-failed') } })
  assert.deepEqual(await failing.service.signOut(), { ok: false, error: 'network' })
  unsubscribe()
})

test('A04 — observação e restauração da sessão persistida', async () => {
  // Sessão já persistida localmente (ex.: após recarregar a página).
  const { fake, service } = setup({ accounts: [TEST_ACCOUNT], persistedUser: TEST_ACCOUNT })
  const store = createAuthStore(service)
  const states: AuthState[] = [store.getSnapshot()]
  const unsubscribe = store.subscribe(() => states.push(store.getSnapshot()))

  assert.deepEqual(states[0], { status: 'loading' })
  await tick()
  assert.deepEqual(store.getSnapshot(), {
    status: 'authenticated',
    user: { uid: TEST_ACCOUNT.uid, email: TEST_ACCOUNT.email },
  })
  // Restaurada SEM novo login.
  assert.equal(fake.calls.includes('signInWithEmailAndPassword'), false)
  // Snapshot estável: notificações repetidas com o mesmo usuário não geram novo estado.
  const snapshot = store.getSnapshot()
  fake.emitCurrentUser()
  assert.equal(store.getSnapshot(), snapshot)
  assert.equal(states.length, 2)

  // Sem sessão persistida: loading → unauthenticated.
  const empty = setup()
  const emptyStore = createAuthStore(empty.service)
  const stop = emptyStore.subscribe(() => {})
  await tick()
  assert.deepEqual(emptyStore.getSnapshot(), { status: 'unauthenticated' })
  stop()
  unsubscribe()

  // Bloqueio de armazenamento local não impede o login (sessão só em memória).
  const blocked = setup({ accounts: [TEST_ACCOUNT], failures: { setLocalPersistence: new Error('storage bloqueado') } })
  assert.equal((await blocked.service.signIn(TEST_ACCOUNT.email, TEST_ACCOUNT.password)).ok, true)
})

test('A07 — recuperação de senha solicitada corretamente, com resposta genérica', async () => {
  const { fake, service } = setup()
  assert.deepEqual(await service.requestPasswordReset(` ${TEST_ACCOUNT.email} `), { ok: true, data: undefined })
  assert.deepEqual(fake.resetRequests, [TEST_ACCOUNT.email])

  // E-mail não cadastrado: MESMO resultado (não revela existência da conta).
  assert.deepEqual(await service.requestPasswordReset('nao.existe@exemplo.invalid'), { ok: true, data: undefined })
  assert.equal(mapPasswordResetError(firebaseError('auth/user-not-found')), null)

  // Formato inválido: bloqueado antes do SDK.
  const before = fake.calls.length
  assert.deepEqual(await service.requestPasswordReset('invalido'), { ok: false, error: 'invalid-email' })
  assert.equal(fake.calls.length, before)

  // Erros técnicos: categoria segura.
  const limited = setup({ failures: { sendPasswordResetEmail: firebaseError('auth/too-many-requests') } })
  assert.deepEqual(await limited.service.requestPasswordReset(TEST_ACCOUNT.email), {
    ok: false,
    error: 'too-many-requests',
  })
})

test('A08 — configuração Firebase inválida bloqueia a autenticação', async () => {
  const fake = createFakeAuthSdk({ accounts: [TEST_ACCOUNT] })
  // `auth === null` é o que a DEV-00.7 entrega quando a validação não é "valid".
  const service = createAuthService(null, fake.sdk)
  const store = createAuthStore(service)

  assert.equal(service.available, false)
  assert.deepEqual(store.getSnapshot(), { status: 'unavailable' })
  const unsubscribe = store.subscribe(() => {})
  assert.deepEqual(await service.signIn(TEST_ACCOUNT.email, TEST_ACCOUNT.password), { ok: false, error: 'unavailable' })
  assert.deepEqual(await service.signOut(), { ok: false, error: 'unavailable' })
  assert.deepEqual(await service.requestPasswordReset(TEST_ACCOUNT.email), { ok: false, error: 'unavailable' })
  unsubscribe()
  assert.deepEqual(fake.calls, [], 'nenhuma chamada ao SDK')
  assert.equal(store.activeObservers(), 0)

  // O módulo de entrada reutiliza a instância da DEV-00.7 (sem novo initializeApp/getAuth).
  const index = code(join(SRC_ROOT, 'services/auth/index.ts'))
  assert.match(index, /getFirebaseServices\(\)\.auth/)
  assert.doesNotMatch(index, /initializeApp|getAuth\(/)
})

test('A09 — erros não expõem e-mail, senha, tokens ou mensagens internas', async () => {
  const secret = 'Senha-Super-Secreta-987'
  const email = 'pessoa.sigilosa@exemplo.invalid'
  const logged: unknown[] = []
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug }
  for (const method of Object.keys(original) as (keyof typeof original)[]) {
    console[method] = (...args: unknown[]) => logged.push(args)
  }
  try {
    const { service } = setup({
      accounts: [TEST_ACCOUNT],
      failures: {
        sendPasswordResetEmail: firebaseError('auth/internal-error', `falha para ${email} projeto-x apiKey=AIza000`),
      },
    })
    const signIn = await service.signIn(email, secret)
    const reset = await service.requestPasswordReset(email)
    const ok = await service.signIn(TEST_ACCOUNT.email, TEST_ACCOUNT.password)

    for (const result of [signIn, reset]) {
      const serialized = JSON.stringify(result)
      assert.equal(Object.keys(result).sort().join(), 'error,ok')
      for (const sensitive of [secret, email, 'apiKey', 'AIza', 'projeto-x', 'Firebase:']) {
        assert.equal(serialized.includes(sensitive), false, sensitive)
      }
    }
    assert.deepEqual(reset, { ok: false, error: 'unknown' })
    // Usuário exposto contém apenas uid e email (sem tokens).
    assert.ok(ok.ok)
    assert.deepEqual(Object.keys(ok.data).sort(), ['email', 'uid'])
    assert.equal(JSON.stringify(ok).includes('token'), false)
    assert.deepEqual(logged, [], 'nenhum log emitido')
  } finally {
    Object.assign(console, original)
  }
  // Nenhum console.* nos módulos de autenticação.
  for (const file of sourceFiles().filter((f) => /services\/auth|pages\/Auth|AuthGate/.test(f))) {
    assert.doesNotMatch(code(file), /console\./, relative(SRC_ROOT, file))
  }
})

test('A10 — no máximo um observador ativo; encerrado ao final (ciclo do StrictMode)', async () => {
  const { fake, service } = setup()
  const store = createAuthStore(service)
  // StrictMode: inscreve, desinscreve e reinscreve; vários componentes inscritos.
  const first = store.subscribe(() => {})
  first()
  const second = store.subscribe(() => {})
  const third = store.subscribe(() => {})
  assert.equal(fake.activeObservers(), 1)
  assert.equal(store.activeObservers(), 1)
  second()
  assert.equal(fake.activeObservers(), 1)
  third()
  assert.equal(fake.activeObservers(), 0, 'sem vazamento após a última desinscrição')
  assert.equal(fake.maxConcurrentObservers(), 1, 'nunca houve observadores duplicados')
  await tick()
})

test('A11 — ausência de criação pública de usuários', () => {
  // Adaptador real expõe somente as 5 operações permitidas.
  assert.deepEqual(Object.keys(firebaseAuthSdk).sort(), [
    'onAuthStateChanged',
    'sendPasswordResetEmail',
    'setLocalPersistence',
    'signInWithEmailAndPassword',
    'signOut',
  ])
  const forbidden =
    /createUserWithEmailAndPassword|signInAnonymously|sendSignInLinkToEmail|signInWithPopup|signInWithRedirect|linkWithCredential|firebase-admin|accounts:signUp/
  for (const file of sourceFiles()) {
    assert.doesNotMatch(code(file), forbidden, relative(SRC_ROOT, file))
  }
})

test('A12 — fluxo de autenticação não executa operações no Firestore ou Storage', async () => {
  const { fake, service } = setup()
  const store = createAuthStore(service)
  const stop = store.subscribe(() => {})
  await service.signIn(TEST_ACCOUNT.email, TEST_ACCOUNT.password)
  await service.requestPasswordReset(TEST_ACCOUNT.email)
  await service.signOut()
  stop()
  const allowed = new Set(['setLocalPersistence', 'signInWithEmailAndPassword', 'signOut', 'sendPasswordResetEmail', 'onAuthStateChanged'])
  assert.ok(fake.calls.every((call) => allowed.has(call)), fake.calls.join())

  // Módulos de autenticação não importam nem usam Firestore/Storage.
  for (const file of sourceFiles().filter((f) => /services\/auth|pages\/Auth|AuthGate|AuthProvider|hooks\//.test(f))) {
    assert.doesNotMatch(code(file), /firebase\/(firestore|storage)|\.firestore\b|\.storage\b/, relative(SRC_ROOT, file))
  }
  // Nenhuma operação de escrita, tempo real ou Storage em toda a aplicação. Desde a DEV-01.2,
  // as únicas LEITURAS permitidas (getDocFromServer/getDocsFromServer) ficam restritas ao
  // adaptador `services/organizations/sdk.ts` — verificado em `organizations.test.ts`.
  const dataOps =
    /\b(getDoc|getDocs|setDoc|addDoc|updateDoc|deleteDoc|onSnapshot|collection|runTransaction|writeBatch|uploadBytes|uploadBytesResumable|uploadString|getDownloadURL|getBytes|deleteObject|listAll|getMetadata|updateMetadata)\s*\(/
  for (const file of sourceFiles()) {
    assert.doesNotMatch(code(file), dataOps, relative(SRC_ROOT, file))
  }
})
