/**
 * Testes do serviço e do contexto organizacional (DEV-01.2) — `npm test`.
 *
 * Usam Firestore e Auth SIMULADOS (sem rede). Verificam a lógica U01–U07; a
 * segurança real (MT01–MT12) é verificada nos emuladores (`npm run test:rules`).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createFakeAuthSdk } from '../../../tests/support/fakeAuthSdk.ts'
import { createFakeOrganizationsSdk, firestoreError } from '../../../tests/support/fakeOrganizationsSdk.ts'
import { OSCS, USERS } from '../../../tests/support/organizationFixtures.ts'
import { createAuthService } from '../auth/authService.ts'
import { createAuthStore } from '../auth/authStore.ts'
import { createOrganizationService } from './organizationService.ts'
import { createOrganizationStore } from './organizationStore.ts'
import { parseMember, parseOrganization } from './parsing.ts'
import { firestoreOrganizationsSdk } from './sdk.ts'
import { createMemorySelectionStorage } from './selectionStorage.ts'
import type { OrganizationState } from './types.ts'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const accounts = Object.values(USERS).map((u) => ({ ...u }))

function setup({ persistedUser, storage = createMemorySelectionStorage() }: {
  persistedUser?: (typeof accounts)[number]
  storage?: ReturnType<typeof createMemorySelectionStorage>
} = {}) {
  const fakeAuth = createFakeAuthSdk({ accounts, persistedUser })
  const auth = createAuthService(fakeAuth.auth, fakeAuth.sdk)
  const authStore = createAuthStore(auth)
  const fakeDb = createFakeOrganizationsSdk()
  const service = createOrganizationService(fakeDb.db, fakeDb.sdk)
  const store = createOrganizationStore({ authStore, service, selectionStorage: storage })
  const states: OrganizationState[] = []
  const stop = store.subscribe(() => states.push(store.getSnapshot()))
  return { auth, authStore, fakeAuth, fakeDb, service, store, storage, states, stop }
}

async function signInAndSettle(ctx: ReturnType<typeof setup>, user: (typeof accounts)[number]) {
  await tick()
  await ctx.auth.signIn(user.email, user.password)
  await tick()
  await tick()
}

function ready(state: OrganizationState) {
  assert.equal(state.status, 'ready', JSON.stringify(state))
  if (state.status !== 'ready') throw new Error('estado não pronto')
  return state
}

test('Identificação dos vínculos: ativos, inativo, OSC pendente e administrador autoritativo', async () => {
  const ctx = setup()
  await signInAndSettle(ctx, USERS.MULTI)
  const state = ready(ctx.store.getSnapshot())
  const byId = Object.fromEntries(state.memberships.map((m) => [m.oscId, m]))

  assert.deepEqual(state.memberships.map((m) => m.oscId), ['osc-alfa', 'osc-beta', 'osc-delta', 'osc-gama'])
  assert.equal(byId['osc-alfa']?.selectable, true)
  assert.equal(byId['osc-alfa']?.isAdministrator, true)
  assert.equal(byId['osc-beta']?.isAdministrator, false)
  assert.equal(byId['osc-beta']?.organization?.commercialStatus, 'suspended')
  assert.equal(byId['osc-delta']?.selectable, false)
  assert.equal(byId['osc-delta']?.unselectableReason, 'organization-not-active')
  // U04: vínculo inativo — OSC não consultada, sem dados institucionais.
  assert.equal(byId['osc-gama']?.selectable, false)
  assert.equal(byId['osc-gama']?.unselectableReason, 'membership-inactive')
  assert.equal(byId['osc-gama']?.organization, null)
  assert.equal(ctx.fakeDb.calls.includes('getOrganization:osc-gama'), false)
  // Nenhuma leitura global; apenas consulta dos próprios vínculos + gets das OSCs ativas.
  assert.deepEqual(ctx.fakeDb.calls.sort(), [
    'getOrganization:osc-alfa', 'getOrganization:osc-beta', 'getOrganization:osc-delta', `listMembershipsByUid:${USERS.MULTI.uid}`,
  ])
  ctx.stop()
})

test('Administrador: espelho specialRole não concede a função; somente administratorUid', async () => {
  const ctx = setup()
  // Espelho diz "administrator" em BETA, mas o campo autoritativo é null.
  ctx.fakeDb.docs.set(`oscs/osc-beta/members/${USERS.MULTI.uid}`, {
    ...ctx.fakeDb.docs.get(`oscs/osc-beta/members/${USERS.MULTI.uid}`), specialRole: 'administrator',
  })
  await signInAndSettle(ctx, USERS.MULTI)
  const beta = ready(ctx.store.getSnapshot()).memberships.find((m) => m.oscId === 'osc-beta')
  assert.equal(beta?.isAdministrator, false)
  ctx.stop()
})

test('U01 — um único vínculo selecionável é selecionado automaticamente', async () => {
  const ctx = setup()
  await signInAndSettle(ctx, USERS.SINGLE)
  const state = ready(ctx.store.getSnapshot())
  assert.equal(state.activeOscId, OSCS.GAMA.id)
  assert.deepEqual(ctx.storage.entries(), { [USERS.SINGLE.uid]: OSCS.GAMA.id })
  ctx.stop()
})

test('U02 — vários vínculos: nenhuma seleção automática; escolha revalidada no servidor', async () => {
  const ctx = setup()
  await signInAndSettle(ctx, USERS.MULTI)
  assert.equal(ready(ctx.store.getSnapshot()).activeOscId, null)

  await ctx.store.select(OSCS.BETA.id)
  const state = ready(ctx.store.getSnapshot())
  assert.equal(state.activeOscId, OSCS.BETA.id)
  assert.ok(ctx.fakeDb.calls.includes(`getMembership:osc-beta/${USERS.MULTI.uid}`))
  assert.deepEqual(ctx.storage.entries(), { [USERS.MULTI.uid]: OSCS.BETA.id })
  ctx.stop()
})

test('U03 — usuário sem vínculos: estado pronto, lista vazia, sem seleção', async () => {
  const ctx = setup()
  await signInAndSettle(ctx, USERS.NONE)
  const state = ready(ctx.store.getSnapshot())
  assert.deepEqual(state.memberships, [])
  assert.equal(state.activeOscId, null)
  ctx.stop()
})

test('U04 — vínculo inativo e OSC não ativa não podem ser selecionados (sem consulta ao servidor)', async () => {
  const ctx = setup()
  await signInAndSettle(ctx, USERS.MULTI)
  const before = ctx.fakeDb.calls.length
  await ctx.store.select(OSCS.GAMA.id)
  assert.equal(ready(ctx.store.getSnapshot()).selectionError, 'not-selectable')
  await ctx.store.select(OSCS.DELTA.id)
  await ctx.store.select('osc-inexistente')
  const state = ready(ctx.store.getSnapshot())
  assert.equal(state.activeOscId, null)
  assert.equal(ctx.fakeDb.calls.length, before)
  ctx.stop()
})

test('U05 — troca de OSC substitui o contexto; vínculo revogado entre a carga e a troca é recusado', async () => {
  const ctx = setup()
  await signInAndSettle(ctx, USERS.MULTI)
  await ctx.store.select(OSCS.ALFA.id)
  await ctx.store.select(OSCS.BETA.id)
  assert.equal(ready(ctx.store.getSnapshot()).activeOscId, OSCS.BETA.id)

  // Administração inativa o vínculo em ALFA após a carga: a troca é recusada.
  const alfa = `oscs/osc-alfa/members/${USERS.MULTI.uid}`
  ctx.fakeDb.docs.set(alfa, { ...ctx.fakeDb.docs.get(alfa), status: 'inactive' })
  await ctx.store.select(OSCS.ALFA.id)
  const state = ready(ctx.store.getSnapshot())
  assert.equal(state.activeOscId, OSCS.BETA.id)
  assert.equal(state.selectionError, 'not-selectable')
  assert.equal(state.memberships.find((m) => m.oscId === 'osc-alfa')?.status, 'inactive')

  // Vínculo excluído: removido da lista.
  ctx.fakeDb.docs.delete(alfa)
  await ctx.store.reload()
  assert.equal(ready(ctx.store.getSnapshot()).memberships.some((m) => m.oscId === 'osc-alfa'), false)
  ctx.stop()
})

test('U06 — logout limpa integralmente o contexto e a seleção guardada', async () => {
  const ctx = setup()
  await signInAndSettle(ctx, USERS.MULTI)
  await ctx.store.select(OSCS.ALFA.id)
  assert.deepEqual(ctx.storage.entries(), { [USERS.MULTI.uid]: OSCS.ALFA.id })
  await ctx.auth.signOut()
  await tick()
  assert.deepEqual(ctx.store.getSnapshot(), { status: 'signed-out' })
  assert.deepEqual(ctx.storage.entries(), {})

  // Novo login do MESMO usuário não reaproveita a seleção anterior.
  await ctx.auth.signIn(USERS.MULTI.email, USERS.MULTI.password)
  await tick(); await tick()
  assert.equal(ready(ctx.store.getSnapshot()).activeOscId, null)
  ctx.stop()
})

test('U06b — resposta tardia após logout é descartada', async () => {
  const ctx = setup()
  await tick()
  const release = ctx.fakeDb.hold()
  await ctx.auth.signIn(USERS.MULTI.email, USERS.MULTI.password)
  await tick()
  assert.equal(ctx.store.getSnapshot().status, 'loading')
  await ctx.auth.signOut()
  await tick()
  release()
  await tick(); await tick()
  assert.deepEqual(ctx.store.getSnapshot(), { status: 'signed-out' })
  ctx.stop()
})

test('U07 — sessão restaurada reutiliza a seleção somente após revalidação no servidor', async () => {
  const storage = createMemorySelectionStorage()
  storage.write(USERS.MULTI.uid, OSCS.BETA.id)
  const ok = setup({ persistedUser: USERS.MULTI, storage })
  await tick(); await tick(); await tick()
  assert.equal(ready(ok.store.getSnapshot()).activeOscId, OSCS.BETA.id)
  assert.ok(ok.fakeDb.calls.includes(`listMembershipsByUid:${USERS.MULTI.uid}`))
  ok.stop()

  // Vínculo inativado enquanto o usuário estava fora: seleção NÃO é reutilizada.
  const storage2 = createMemorySelectionStorage()
  storage2.write(USERS.MULTI.uid, OSCS.BETA.id)
  const revoked = setup({ persistedUser: USERS.MULTI, storage: storage2 })
  const beta = `oscs/osc-beta/members/${USERS.MULTI.uid}`
  revoked.fakeDb.docs.set(beta, { ...revoked.fakeDb.docs.get(beta), status: 'inactive' })
  await tick(); await tick(); await tick()
  // BETA não é reutilizada; ALFA passa a ser a única selecionável e é escolhida pela regra U01.
  assert.equal(ready(revoked.store.getSnapshot()).activeOscId, OSCS.ALFA.id)
  assert.deepEqual(storage2.entries(), { [USERS.MULTI.uid]: OSCS.ALFA.id })

  // Seleção guardada de OSC sem vínculo (adulterada) é ignorada.
  const storage3 = createMemorySelectionStorage()
  storage3.write(USERS.NONE.uid, OSCS.ALFA.id)
  const forged = setup({ persistedUser: USERS.NONE, storage: storage3 })
  await tick(); await tick(); await tick()
  assert.equal(ready(forged.store.getSnapshot()).activeOscId, null)
  assert.equal(forged.fakeDb.calls.includes('getOrganization:osc-alfa'), false)
  revoked.stop(); forged.stop()
})

test('Falhas: rede, regras não publicadas e índice ausente — categorias seguras e nova tentativa', async () => {
  const cases = [
    [firestoreError('unavailable', 'offline em projeto-x'), 'network'],
    [firestoreError('permission-denied', 'Missing or insufficient permissions.'), 'permission-denied'],
    [firestoreError('failed-precondition', 'The query requires an index. https://console.firebase.google.com/...'), 'not-configured'],
    [new Error('sem código'), 'unknown'],
  ] as const
  for (const [error, kind] of cases) {
    const ctx = setup()
    ctx.fakeDb.fail('listMembershipsByUid', error)
    await signInAndSettle(ctx, USERS.MULTI)
    const state = ctx.store.getSnapshot()
    assert.deepEqual(state, { status: 'error', uid: USERS.MULTI.uid, error: kind })
    assert.equal(JSON.stringify(state).includes('projeto-x') || JSON.stringify(state).includes('console.firebase'), false)
    ctx.fakeDb.recover()
    await ctx.store.reload()
    assert.equal(ready(ctx.store.getSnapshot()).memberships.length, 4)
    ctx.stop()
  }
  // OSC ilegível (ex.: regra negou) torna só aquele vínculo indisponível.
  const partial = setup()
  partial.fakeDb.fail('getOrganization', firestoreError('permission-denied'))
  await signInAndSettle(partial, USERS.SINGLE)
  const state = ready(partial.store.getSnapshot())
  assert.equal(state.memberships[0]?.unselectableReason, 'organization-unavailable')
  assert.equal(state.activeOscId, null)
  partial.stop()
  // Falha de rede ao trocar: contexto atual preservado.
  const switching = setup()
  await signInAndSettle(switching, USERS.MULTI)
  await switching.store.select(OSCS.ALFA.id)
  switching.fakeDb.fail('getMembership', firestoreError('unavailable'))
  await switching.store.select(OSCS.BETA.id)
  const after = ready(switching.store.getSnapshot())
  assert.equal(after.activeOscId, OSCS.ALFA.id)
  assert.equal(after.selectionError, 'network')
  switching.stop()
})

test('Validação defensiva: documentos inconsistentes são descartados (falha fechada)', () => {
  const uid = 'u1'
  const member = (path: string, data: Record<string, unknown>) => parseMember({ path, data }, uid)
  assert.ok(member('oscs/a/members/u1', { uid, oscId: 'a', status: 'active' }))
  assert.equal(member('oscs/a/members/u1', { uid: 'u2', oscId: 'a', status: 'active' }), null)
  assert.equal(member('oscs/a/members/u1', { uid, oscId: 'b', status: 'active' }), null)
  assert.equal(member('oscs/a/members/u1', { uid, oscId: 'a', status: 'ACTIVE' }), null)
  assert.equal(member('outros/a/members/u1', { uid, oscId: 'a', status: 'active' }), null)
  assert.equal(member('oscs/a/members/u2', { uid, oscId: 'a', status: 'active' }), null)
  const osc = { id: 'a', name: 'OSC', registrationStatus: 'active', commercialStatus: 'active', administratorUid: null }
  assert.ok(parseOrganization({ path: 'oscs/a', data: osc }, 'a'))
  assert.equal(parseOrganization({ path: 'oscs/a', data: { ...osc, id: 'b' } }, 'a'), null)
  assert.equal(parseOrganization({ path: 'oscs/a', data: { ...osc, registrationStatus: 'x' } }, 'a'), null)
  assert.equal(parseOrganization({ path: 'oscs/a', data: { ...osc, administratorUid: 7 } }, 'a'), null)
  assert.equal(parseOrganization({ path: 'oscs/a', data: { ...osc, name: ' ' } }, 'a'), null)
})

test('Configuração inválida: contexto indisponível e nenhuma chamada ao Firestore', async () => {
  const fakeDb = createFakeOrganizationsSdk()
  const fakeAuth = createFakeAuthSdk({ accounts, persistedUser: USERS.MULTI })
  const authStore = createAuthStore(createAuthService(fakeAuth.auth, fakeAuth.sdk))
  const store = createOrganizationStore({
    authStore,
    service: createOrganizationService(null, fakeDb.sdk),
    selectionStorage: createMemorySelectionStorage(),
  })
  const stop = store.subscribe(() => {})
  await tick(); await tick()
  assert.deepEqual(store.getSnapshot(), { status: 'unavailable' })
  assert.deepEqual(fakeDb.calls, [])
  stop()
})

test('StrictMode/inscrições: um único observador de autenticação, liberado ao final', async () => {
  const ctx = setup()
  const a = ctx.store.subscribe(() => {})
  a()
  const b = ctx.store.subscribe(() => {})
  assert.equal(ctx.fakeAuth.activeObservers(), 1)
  b(); ctx.stop()
  assert.equal(ctx.fakeAuth.activeObservers(), 0)
  assert.equal(ctx.fakeAuth.maxConcurrentObservers(), 1)
  await tick()
})

test('Adaptador real: somente leituras no servidor; nenhuma escrita em toda a aplicação', () => {
  assert.deepEqual(Object.keys(firestoreOrganizationsSdk).sort(), ['getMembership', 'getOrganization', 'listMembershipsByUid'])
  const root = new URL('../..', import.meta.url).pathname
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : []
    })
  const writes = /\b(setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction|onSnapshot|getDocs|getDoc|getDocsFromCache|getDocFromCache)\s*\(/
  for (const file of files(root)) {
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(code, writes, relative(root, file))
    // Importações de valor (não `import type`) do SDK do Firestore.
    if (/import\s+\{[^}]*\}\s+from\s+'firebase\/firestore'/.test(code)) {
      // DEV-02.1: o adaptador de LEITURA de parcerias é o único acréscimo autorizado.
      assert.ok(/services\/(organizations\/sdk|partnerships\/sdk|firebase\/sdk)\.ts$/.test(file), `Firestore importado fora do adaptador: ${relative(root, file)}`)
    }
  }
})
