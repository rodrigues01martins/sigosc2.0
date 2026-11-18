/**
 * DEV-01.3 — Operações privilegiadas de permissões (PER) no AMBIENTE CONFIÁVEL.
 *
 * Executar com `npm run test:server`: emuladores de Auth e Firestore, projeto fictício
 * `demo-sigosc-server`. Usa o Firebase Admin SDK REAL e o código real de `api/`.
 * Limitação do emulador: tokens do emulador não são assinados, então a verificação
 * de ASSINATURA só ocorre no ambiente real (o Admin SDK a aplica fora do emulador).
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { getAuth } from 'firebase-admin/auth'
import { getApps } from 'firebase-admin/app'
import type { Timestamp } from 'firebase-admin/firestore'
import handler from '../../api/osc-permissions.ts'
import { handlePermissionsRequest, type ApiResponse, type ServerDeps } from '../../api/_lib/permissionsService.ts'
import { getServerDeps } from '../../api/_lib/serverDeps.ts'
import { MEMBERS, OSCS, USERS, memberDocument, memberPath, oscDocument, oscPath } from '../support/organizationFixtures.ts'
import { PERMISSION_MEMBERS, PERMISSION_USERS } from '../support/permissionFixtures.ts'

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-sigosc-server'
process.env.GCLOUD_PROJECT = PROJECT_ID
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST
if (!authHost || !firestoreHost) throw new Error('Emuladores ausentes: execute com "npm run test:server".')

const ALL_USERS = { ...USERS, ...PERMISSION_USERS }
const ALFA = OSCS.ALFA.id
let deps: ServerDeps
const tokens = new Map<string, string>()

async function signIn(user: { email: string; password: string }): Promise<string> {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password, returnSecureToken: true }),
  })
  const data = (await response.json()) as { idToken: string }
  assert.ok(data.idToken)
  return data.idToken
}

async function seed() {
  await fetch(`http://${firestoreHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
  const batch = deps.db.batch()
  for (const osc of Object.values(OSCS)) batch.set(deps.db.doc(oscPath(osc)), oscDocument(osc))
  for (const member of [...MEMBERS, ...PERMISSION_MEMBERS]) batch.set(deps.db.doc(memberPath(member)), memberDocument(member))
  await batch.commit()
  // Controle positivo: dados presentes.
  assert.equal((await deps.db.collection(`oscs/${ALFA}/members`).get()).size, 4)
}

const token = (user: { uid: string }) => tokens.get(user.uid) as string
const list = (user: { uid: string } | null, oscId: string = ALFA, extraQuery = '') =>
  handlePermissionsRequest(
    { method: 'GET', authorization: user ? `Bearer ${token(user)}` : undefined, query: new URLSearchParams(`oscId=${oscId}${extraQuery}`), rawBody: '' },
    deps,
  )
const post = (user: { uid: string }, body: Record<string, unknown>) =>
  handlePermissionsRequest(
    { method: 'POST', authorization: `Bearer ${token(user)}`, query: new URLSearchParams(), rawBody: JSON.stringify(body) },
    deps,
  )
const grant = (actor: { uid: string }, target: { uid: string }, permission = 'documents.view', oscId = ALFA) =>
  post(actor, { oscId, targetUid: target.uid, action: 'grant-permission', permission })
const revoke = (actor: { uid: string }, target: { uid: string }, permission: string, oscId = ALFA) =>
  post(actor, { oscId, targetUid: target.uid, action: 'revoke-permission', permission })
const delegation = (actor: { uid: string }, target: { uid: string }, action: 'grant-delegation' | 'revoke-delegation', oscId = ALFA) =>
  post(actor, { oscId, targetUid: target.uid, action })
const member = async (uid: string, oscId = ALFA) => (await deps.db.doc(`oscs/${oscId}/members/${uid}`).get()).data()
const events = async (oscId = ALFA) => (await deps.db.collection(`oscs/${oscId}/permissionEvents`).get()).docs.map((d) => d.data())
const denied = (response: ApiResponse, reason: string, status = 403) => {
  assert.equal(response.status, status, JSON.stringify(response))
  assert.equal(response.body.reason, reason, JSON.stringify(response))
}

before(async () => {
  const resolved = getServerDeps({ ...process.env, GCLOUD_PROJECT: PROJECT_ID })
  assert.ok(resolved, 'dependências do servidor no emulador')
  deps = resolved
  const auth = getAuth(getApps().find((a) => a.name === 'sigosc-server'))
  await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' })
  for (const user of Object.values(ALL_USERS)) {
    await auth.createUser({ uid: user.uid, email: user.email, password: user.password })
    tokens.set(user.uid, await signIn(user))
  }
})

beforeEach(seed)

describe('Consultas (P01/P02)', () => {
  test('PER-01/PER-02 — usuário comum não obtém a relação de terceiros pelo servidor', async () => {
    denied(await list(PERMISSION_USERS.OPERATOR), 'not-authorized')
    denied(await list(PERMISSION_USERS.FORMER), 'membership-inactive')
  })

  test('PER-03 — administrador consulta usuários e permissões da própria OSC', async () => {
    const response = await list(USERS.MULTI)
    assert.equal(response.status, 200)
    assert.equal(response.body.readOnly, false)
    assert.deepEqual(response.body.viewer, { uid: USERS.MULTI.uid, authority: 'administrator' })
    const members = response.body.members as { uid: string; email: string; permissions: string[]; isAdministrator: boolean; canManagePermissions: boolean; status: string }[]
    assert.deepEqual(members.map((m) => m.uid).sort(), [PERMISSION_USERS.DELEGATE.uid, PERMISSION_USERS.FORMER.uid, PERMISSION_USERS.OPERATOR.uid, USERS.MULTI.uid].sort())
    const operator = members.find((m) => m.uid === PERMISSION_USERS.OPERATOR.uid)
    assert.deepEqual(operator?.permissions, ['partnerships.view'])
    assert.equal(operator?.email, PERMISSION_USERS.OPERATOR.email)
    assert.equal(members.find((m) => m.uid === USERS.MULTI.uid)?.isAdministrator, true)
    // Delegado também consulta (fora da suspensão).
    assert.equal((await list(PERMISSION_USERS.DELEGATE)).status, 200)
  })

  test('PER-04 — administrador não administra outra OSC', async () => {
    // SINGLE administra GAMA, mas não tem vínculo com ALFA.
    denied(await list(USERS.SINGLE, ALFA), 'no-membership')
    denied(await grant(USERS.SINGLE, PERMISSION_USERS.OPERATOR), 'no-membership')
    // MULTI (admin de ALFA) não administra GAMA, onde seu vínculo é inativo.
    denied(await list(USERS.MULTI, OSCS.GAMA.id), 'membership-inactive')
    denied(await grant(USERS.MULTI, USERS.SINGLE, 'documents.view', OSCS.GAMA.id), 'membership-inactive')
    // Alvo de outra OSC, sem vínculo com ALFA.
    denied(await grant(USERS.MULTI, USERS.SINGLE), 'target-not-member', 404)
    assert.equal((await member(USERS.SINGLE.uid, OSCS.GAMA.id))?.permissions, undefined)
  })

  test('PER-13 — usuário sem vínculo não acessa a gestão', async () => {
    denied(await list(USERS.NONE), 'no-membership')
    denied(await grant(USERS.NONE, PERMISSION_USERS.OPERATOR), 'no-membership')
    denied(await delegation(USERS.NONE, USERS.NONE, 'grant-delegation'), 'no-membership')
  })
})

describe('Concessão, revogação e delegação (P03–P08)', () => {
  test('PER-05 — administrador concede permissão operacional, com autoria e auditoria', async () => {
    const response = await grant(USERS.MULTI, PERMISSION_USERS.OPERATOR, 'documents.view')
    assert.equal(response.status, 200)
    assert.equal(response.body.changed, true)
    const doc = await member(PERMISSION_USERS.OPERATOR.uid)
    assert.deepEqual(doc?.permissions, ['partnerships.view', 'documents.view'])
    assert.equal(doc?.permissionsUpdatedBy, USERS.MULTI.uid)
    assert.ok(doc?.permissionsUpdatedAt)
    const [event] = await events()
    assert.equal(event?.action, 'grant-permission')
    assert.equal(event?.actorUid, USERS.MULTI.uid)
    assert.equal(event?.actorAuthority, 'administrator')
    assert.deepEqual(event?.before.permissions, ['partnerships.view'])
    assert.deepEqual(event?.after.permissions, ['partnerships.view', 'documents.view'])
    // Idempotente: repetir não altera nem gera novo evento.
    assert.equal((await grant(USERS.MULTI, PERMISSION_USERS.OPERATOR, 'documents.view')).body.changed, false)
    assert.equal((await events()).length, 1)
  })

  test('PER-06 — administrador revoga permissão operacional (inclusive de ex-membro)', async () => {
    assert.equal((await revoke(USERS.MULTI, PERMISSION_USERS.OPERATOR, 'partnerships.view')).status, 200)
    assert.deepEqual((await member(PERMISSION_USERS.OPERATOR.uid))?.permissions, [])
    assert.equal((await revoke(USERS.MULTI, PERMISSION_USERS.FORMER, 'documents.view')).status, 200)
    // Vínculo inativo NÃO recebe concessão.
    denied(await grant(USERS.MULTI, PERMISSION_USERS.FORMER), 'target-not-active')
  })

  test('PER-07/PER-08 — administrador concede e revoga delegação a membro ativo', async () => {
    assert.equal((await delegation(USERS.MULTI, PERMISSION_USERS.OPERATOR, 'grant-delegation')).status, 200)
    const doc = await member(PERMISSION_USERS.OPERATOR.uid)
    assert.equal(doc?.canManagePermissions, true)
    assert.equal(doc?.delegationUpdatedBy, USERS.MULTI.uid)
    assert.deepEqual(doc?.permissions, ['partnerships.view'], 'delegação não altera permissões operacionais')
    assert.equal((await list(PERMISSION_USERS.OPERATOR)).status, 200)
    assert.equal((await delegation(USERS.MULTI, PERMISSION_USERS.OPERATOR, 'revoke-delegation')).status, 200)
    assert.equal((await member(PERMISSION_USERS.OPERATOR.uid))?.canManagePermissions, false)
    denied(await list(PERMISSION_USERS.OPERATOR), 'not-authorized')
    denied(await delegation(USERS.MULTI, PERMISSION_USERS.FORMER, 'grant-delegation'), 'target-not-active')
  })

  test('PER-09 — delegado concede e revoga permissão de outro usuário', async () => {
    const response = await grant(PERMISSION_USERS.DELEGATE, PERMISSION_USERS.OPERATOR, 'financial.view')
    assert.equal(response.status, 200)
    assert.deepEqual((await member(PERMISSION_USERS.OPERATOR.uid))?.permissions, ['partnerships.view', 'financial.view'])
    const [event] = await events()
    assert.equal(event?.actorAuthority, 'delegate')
    assert.equal((await revoke(PERMISSION_USERS.DELEGATE, PERMISSION_USERS.OPERATOR, 'financial.view')).status, 200)
    // Delegado não altera o administrador.
    denied(await grant(PERMISSION_USERS.DELEGATE, USERS.MULTI), 'target-is-administrator')
  })

  test('PER-10 — delegado não concede nem revoga delegação (sem subdelegação)', async () => {
    denied(await delegation(PERMISSION_USERS.DELEGATE, PERMISSION_USERS.OPERATOR, 'grant-delegation'), 'not-administrator')
    denied(await delegation(PERMISSION_USERS.DELEGATE, PERMISSION_USERS.DELEGATE, 'revoke-delegation'), 'not-administrator')
    assert.equal((await member(PERMISSION_USERS.OPERATOR.uid))?.canManagePermissions, undefined)
  })

  test('PER-11 — ninguém altera as próprias permissões ou delegação', async () => {
    denied(await grant(PERMISSION_USERS.DELEGATE, PERMISSION_USERS.DELEGATE), 'self-modification')
    denied(await revoke(PERMISSION_USERS.DELEGATE, PERMISSION_USERS.DELEGATE, 'documents.view'), 'self-modification')
    denied(await grant(USERS.MULTI, USERS.MULTI), 'self-modification')
    denied(await delegation(USERS.MULTI, USERS.MULTI, 'grant-delegation'), 'self-modification')
    denied(await grant(PERMISSION_USERS.OPERATOR, PERMISSION_USERS.OPERATOR), 'not-authorized')
    assert.deepEqual((await member(PERMISSION_USERS.DELEGATE.uid))?.permissions, [])
  })

  test('PER-12 — vínculo inativo (revogado) não autoriza operações', async () => {
    await deps.db.doc(`oscs/${ALFA}/members/${PERMISSION_USERS.DELEGATE.uid}`).update({ status: 'inactive' })
    denied(await grant(PERMISSION_USERS.DELEGATE, PERMISSION_USERS.OPERATOR), 'membership-inactive')
    denied(await list(PERMISSION_USERS.DELEGATE), 'membership-inactive')
    // Administrador com vínculo inativo também perde a competência.
    await deps.db.doc(`oscs/${ALFA}/members/${USERS.MULTI.uid}`).update({ status: 'inactive' })
    denied(await grant(USERS.MULTI, PERMISSION_USERS.OPERATOR), 'membership-inactive')
  })
})

describe('Suspensão comercial (P10)', () => {
  test('PER-14 — suspensão comercial bloqueia todas as modificações', async () => {
    await deps.db.doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'suspended' })
    denied(await grant(USERS.MULTI, PERMISSION_USERS.OPERATOR), 'commercial-suspension')
    denied(await revoke(USERS.MULTI, PERMISSION_USERS.OPERATOR, 'partnerships.view'), 'commercial-suspension')
    denied(await delegation(USERS.MULTI, PERMISSION_USERS.OPERATOR, 'grant-delegation'), 'commercial-suspension')
    denied(await delegation(USERS.MULTI, PERMISSION_USERS.DELEGATE, 'revoke-delegation'), 'commercial-suspension')
    denied(await grant(PERMISSION_USERS.DELEGATE, PERMISSION_USERS.OPERATOR), 'commercial-suspension')
    assert.deepEqual((await member(PERMISSION_USERS.OPERATOR.uid))?.permissions, ['partnerships.view'])
    assert.equal((await events()).length, 0)
  })

  test('PER-15 — administrador de OSC suspensa mantém somente a consulta', async () => {
    await deps.db.doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'suspended' })
    const response = await list(USERS.MULTI)
    assert.equal(response.status, 200)
    assert.equal(response.body.readOnly, true)
    denied(await list(PERMISSION_USERS.DELEGATE), 'commercial-suspension')
    denied(await list(PERMISSION_USERS.OPERATOR), 'not-authorized')
  })
})

describe('Isolamento e manipulação', () => {
  test('PER-16 — OSCs distintas não compartilham permissões nem competências', async () => {
    await grant(USERS.MULTI, PERMISSION_USERS.OPERATOR, 'documents.view')
    // MULTI é membro comum de BETA: não gere permissões lá, mesmo sendo admin de ALFA.
    denied(await list(USERS.MULTI, OSCS.BETA.id), 'not-authorized')
    // Delegado de ALFA não tem vínculo com BETA.
    denied(await grant(PERMISSION_USERS.DELEGATE, USERS.MULTI, 'documents.view', OSCS.BETA.id), 'no-membership')
    const betaMember = await member(USERS.MULTI.uid, OSCS.BETA.id)
    assert.equal(betaMember?.permissions, undefined)
    assert.equal((await events(OSCS.BETA.id)).length, 0)
  })

  test('PER-18 — dados do cliente (papel, uid, permissões) não concedem autorização', async () => {
    // Campos extras ou forjados são rejeitados.
    for (const extra of [{ role: 'administrator' }, { actorUid: USERS.MULTI.uid }, { isAdministrator: true }, { permissions: ['partnerships.view'] }]) {
      const response = await post(PERMISSION_USERS.OPERATOR, { oscId: ALFA, targetUid: PERMISSION_USERS.OPERATOR.uid, action: 'grant-permission', permission: 'documents.view', ...extra })
      assert.deepEqual(response, { status: 400, body: { error: 'invalid-request' } })
    }
    // Permissões inexistentes, pendentes ou genéricas.
    for (const permission of ['admin', 'all', '*', 'financial.edit', 'users.invite', '']) { // DEC-PAR-001: partnerships.edit agora é concedível
      denied(await grant(USERS.MULTI, PERMISSION_USERS.OPERATOR, permission), 'invalid-permission')
    }
    // Identificadores com caminho embutido (tentativa de outra OSC/coleção).
    for (const oscId of ['osc-alfa/members/x', '../osc-beta', 'osc alfa', '']) {
      const response = await post(USERS.MULTI, { oscId, targetUid: PERMISSION_USERS.OPERATOR.uid, action: 'grant-permission', permission: 'documents.view' })
      assert.equal(response.status, 400)
    }
    assert.equal((await list(USERS.MULTI, ALFA, '&role=administrator')).status, 400)
    // Documento de vínculo com permissões manipuladas (textos livres) é saneado.
    await deps.db.doc(`oscs/${ALFA}/members/${PERMISSION_USERS.OPERATOR.uid}`).update({ permissions: ['admin', 'all', '*'], canManagePermissions: 'true' })
    denied(await list(PERMISSION_USERS.OPERATOR), 'not-authorized')
  })

  test('Sessão: sem token, token inválido e sessão revogada são recusados', async () => {
    assert.deepEqual(await list(null), { status: 401, body: { error: 'invalid-token' } })
    const bad = await handlePermissionsRequest({ method: 'GET', authorization: 'Bearer não-é-um-token', query: new URLSearchParams(`oscId=${ALFA}`), rawBody: '' }, deps)
    assert.equal(bad.status, 401)
    const garbage = await handlePermissionsRequest({ method: 'GET', authorization: 'Bearer abc.def.ghi', query: new URLSearchParams(`oscId=${ALFA}`), rawBody: '' }, deps)
    assert.equal(garbage.status, 401)
    // Revogação da sessão (ex.: desligamento): token emitido antes é recusado.
    const victim = await signIn(PERMISSION_USERS.DELEGATE)
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await getAuth(getApps().find((a) => a.name === 'sigosc-server')).revokeRefreshTokens(PERMISSION_USERS.DELEGATE.uid)
    const response = await handlePermissionsRequest({ method: 'GET', authorization: `Bearer ${victim}`, query: new URLSearchParams(`oscId=${ALFA}`), rawBody: '' }, deps)
    assert.deepEqual(response, { status: 401, body: { error: 'session-expired' } })
    tokens.set(PERMISSION_USERS.DELEGATE.uid, await signIn(PERMISSION_USERS.DELEGATE))
    // Sem configuração: 503, nenhuma operação.
    assert.deepEqual(await handlePermissionsRequest({ method: 'GET', authorization: 'Bearer x', query: new URLSearchParams(), rawBody: '' }, null), { status: 503, body: { error: 'not-configured' } })
  })

  test('PER-19 — operações simultâneas não produzem elevação indevida', async () => {
    for (let round = 0; round < 6; round++) {
      await seed()
      // Administrador revoga a delegação enquanto o delegado tenta conceder.
      const [revocation, attempt] = await Promise.all([
        delegation(USERS.MULTI, PERMISSION_USERS.DELEGATE, 'revoke-delegation'),
        grant(PERMISSION_USERS.DELEGATE, PERMISSION_USERS.OPERATOR, 'documents.view'),
      ])
      assert.equal(revocation.status, 200)
      assert.ok([200, 403].includes(attempt.status), JSON.stringify(attempt))
      // Tempo de COMMIT dos eventos (createTime). O campo `at` (serverTimestamp) não serve
      // para ordenar transações no emulador: é atribuído antes do commit.
      const log = (await deps.db.collection(`oscs/${ALFA}/permissionEvents`).get()).docs
      const committedAt = (action: string): Timestamp | undefined => log.find((d) => d.data().action === action)?.createTime
      const revokeAt = committedAt('revoke-delegation') as Timestamp
      const grantAt = committedAt('grant-permission')
      // Se a concessão foi aceita, foi gravada ANTES da revogação (serialização transacional).
      if (attempt.status === 200) assert.ok(grantAt && grantAt.toMillis() <= revokeAt.toMillis())
      else assert.equal(attempt.body.reason, 'not-authorized')
      // Depois da revogação, o ex-delegado não opera.
      denied(await grant(PERMISSION_USERS.DELEGATE, PERMISSION_USERS.OPERATOR, 'financial.view'), 'not-authorized')
    }
    // Concessões simultâneas ao mesmo usuário não se perdem.
    await seed()
    const results = await Promise.all(
      ['work-plan.view', 'execution.view', 'financial.view', 'documents.view'].map((p) => grant(USERS.MULTI, PERMISSION_USERS.OPERATOR, p)),
    )
    assert.ok(results.every((r) => r.status === 200), JSON.stringify(results))
    assert.deepEqual((await member(PERMISSION_USERS.OPERATOR.uid))?.permissions, ['partnerships.view', 'work-plan.view', 'execution.view', 'financial.view', 'documents.view'])
    // Autoconcessão de delegação concorrente: sempre negada.
    const selfAttempts = await Promise.all([1, 2, 3].map(() => delegation(PERMISSION_USERS.OPERATOR, PERMISSION_USERS.OPERATOR, 'grant-delegation')))
    assert.ok(selfAttempts.every((r) => r.status === 403))
  })
})

describe('Adaptador HTTP real (api/osc-permissions.ts)', () => {
  let server: Server
  let base = ''
  before(async () => {
    server = createServer((req, res) => void handler(req, res))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/osc-permissions`
  })
  after(() => new Promise<void>((resolve) => server.close(() => resolve())))

  test('GET/POST pelo HTTP: cabeçalhos seguros, métodos e corpo inválido', async () => {
    const ok = await fetch(`${base}?oscId=${ALFA}`, { headers: { Authorization: `Bearer ${token(USERS.MULTI)}` } })
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('cache-control'), 'no-store')
    assert.match(ok.headers.get('content-type') ?? '', /application\/json/)
    assert.equal(ok.headers.get('access-control-allow-origin'), null)
    const granted = await fetch(base, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token(USERS.MULTI)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ oscId: ALFA, targetUid: PERMISSION_USERS.OPERATOR.uid, action: 'grant-permission', permission: 'execution.view' }),
    })
    assert.equal(granted.status, 200)
    assert.equal((await fetch(base, { method: 'DELETE' })).status, 405)
    const invalid = await fetch(base, { method: 'POST', headers: { Authorization: `Bearer ${token(USERS.MULTI)}` }, body: '{não é json' })
    assert.deepEqual([invalid.status, await invalid.json()], [400, { error: 'invalid-request' }])
    const huge = await fetch(base, { method: 'POST', headers: { Authorization: `Bearer ${token(USERS.MULTI)}` }, body: 'x'.repeat(20_000) })
    assert.equal(huge.status, 400)
  })
})
