/**
 * DEV-02.1 — Cadastro de parcerias no AMBIENTE CONFIÁVEL (`npm run test:server`).
 * Emuladores de Auth e Firestore, projeto fictício. Admin SDK e código REAIS de `api/`.
 *
 * Duas categorias, separadas de propósito:
 *  - ROTINA HABILITADA EM PRODUÇÃO: a política real (`decidePartnershipRegistration`) — que
 *    NEGA todo cadastro com `pending-specification` (T13/T14) e não grava nada.
 *  - ROTINA PREPARADA (bloqueada em produção): a gravação, exercitada SOMENTE com uma política
 *    HIPOTÉTICA injetada pelo teste. Não comprova regra de negócio aprovada; comprova a mecânica
 *    (autoria, datas de servidor, auditoria, idempotência, unicidade e isolamento) — T16.
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { promisify } from 'node:util'
import { deleteApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp } from 'firebase-admin/firestore'
import handler from '../../api/osc-partnerships.ts'
import { handlePartnershipsRequest, serverToday, type RegistrationPolicy } from '../../api/_lib/partnershipsService.ts'
import type { ApiResponse, ServerDeps } from '../../api/_lib/permissionsService.ts'
import { getServerDeps } from '../../api/_lib/serverDeps.ts'
import { evaluate } from '../../src/domain/authorization.ts'
import { MEMBERS, OSCS, USERS, memberDocument, memberPath, oscDocument, oscPath } from '../support/organizationFixtures.ts'
import { PERMISSION_MEMBERS, PERMISSION_USERS } from '../support/permissionFixtures.ts'

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-sigosc-server'
process.env.GCLOUD_PROJECT = PROJECT_ID
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST
if (!authHost || !firestoreHost) throw new Error('Emuladores ausentes: execute com "npm run test:server".')

const ALL_USERS = { ...USERS, ...PERMISSION_USERS }
const ALFA = OSCS.ALFA.id
const TODAY = '2026-11-17'
let deps: ServerDeps
const tokens = new Map<string, string>()

/** POLÍTICA HIPOTÉTICA, SÓ DE TESTE: trata partnerships.view como se autorizasse o cadastro. */
const HYPOTHETICAL_POLICY: RegistrationPolicy = (context) => evaluate(context, { kind: 'operate', permission: 'partnerships.view' })

const DRAFT = {
  instrument: 'termo-colaboracao',
  instrumentNumber: '06/2026',
  publicPartner: 'Secretaria Municipal Fictícia de Assistência Social',
  object: 'Oficinas socioeducativas fictícias no contraturno escolar.',
  formalizationDate: '2026-02-20',
  termStart: '2026-03-01',
  termEnd: '2028-02-28',
  globalValueCents: 15_000_000,
  workPlanApprovalDeclared: true,
}

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
  assert.equal((await deps.db.collection(`oscs/${ALFA}/members`).get()).size, 4)
}

let requestCounter = 0
const post = (user: { uid: string } | null, body: Record<string, unknown>, policy?: RegistrationPolicy) =>
  handlePartnershipsRequest(
    { method: 'POST', authorization: user ? `Bearer ${tokens.get(user.uid) ?? ''}` : undefined, query: new URLSearchParams(), rawBody: JSON.stringify(body) },
    deps,
    policy ? { policy, today: TODAY } : { today: TODAY },
  )
const register = (user: { uid: string }, draft: Record<string, unknown> = DRAFT, options: { oscId?: string; requestId?: string; policy?: RegistrationPolicy } = {}) =>
  post(user, { oscId: options.oscId ?? ALFA, requestId: options.requestId ?? `pedido-${++requestCounter}-teste`, draft }, options.policy)
const partnerships = async (oscId = ALFA) => (await deps.db.collection(`oscs/${oscId}/partnerships`).get()).docs
const events = async (oscId = ALFA) => (await deps.db.collection(`oscs/${oscId}/partnershipEvents`).get()).docs.map((d) => d.data())
const status = (response: ApiResponse, expected: number, reason?: string) => {
  assert.equal(response.status, expected, JSON.stringify(response))
  if (reason) assert.equal(response.body.reason, reason, JSON.stringify(response))
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

describe('Rotina habilitada em produção: cadastro BLOQUEADO por especificação pendente', () => {
  test('DEV-02.1-T13 — nenhum usuário cadastra (administrador, delegado, operador); nada é gravado', async () => {
    for (const user of [USERS.MULTI, PERMISSION_USERS.DELEGATE, PERMISSION_USERS.OPERATOR]) {
      status(await register(user), 403, 'pending-specification')
    }
    assert.equal((await partnerships()).length, 0)
    assert.equal((await events()).length, 0)
  })

  test('DEV-02.1-T13 — sem vínculo, vínculo inativo e outra OSC prevalecem sobre a especificação', async () => {
    status(await register(USERS.NONE), 403, 'no-membership')
    status(await register(USERS.SINGLE), 403, 'no-membership') // administrador de GAMA tentando ALFA
    status(await register(PERMISSION_USERS.FORMER), 403, 'membership-inactive')
    status(await register(USERS.MULTI, DRAFT, { oscId: OSCS.DELTA.id }), 403, 'organization-not-active')
    status(await post(null, { oscId: ALFA, requestId: 'pedido-sem-token', draft: DRAFT }), 401)
  })

  test('DEV-02.1-T14 — suspensão comercial bloqueia o cadastro', async () => {
    await deps.db.doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'suspended' })
    status(await register(USERS.MULTI), 403, 'commercial-suspension')
    status(await register(PERMISSION_USERS.OPERATOR, DRAFT, { policy: HYPOTHETICAL_POLICY }), 403, 'commercial-suspension')
    assert.equal((await partnerships()).length, 0)
  })

  test('Formato estrito: situação, autoria ou OSC forjadas no corpo são recusadas (400); só POST', async () => {
    for (const forged of [{ ...DRAFT, administrativeStatus: 'arquivada' }, { ...DRAFT, createdBy: USERS.MULTI.uid }, { ...DRAFT, oscId: OSCS.GAMA.id }]) {
      status(await register(PERMISSION_USERS.OPERATOR, forged, { policy: HYPOTHETICAL_POLICY }), 400)
    }
    status(await post(PERMISSION_USERS.OPERATOR, { oscId: ALFA, requestId: 'curto', draft: DRAFT }, HYPOTHETICAL_POLICY), 400)
    status(await post(PERMISSION_USERS.OPERATOR, { oscId: ALFA, requestId: 'pedido-extra-1', draft: DRAFT, uid: 'x' }, HYPOTHETICAL_POLICY), 400)
    const get = await handlePartnershipsRequest({ method: 'GET', authorization: undefined, query: new URLSearchParams(), rawBody: '' }, deps)
    status(get, 405)
    status(await handlePartnershipsRequest({ method: 'POST', authorization: 'Bearer x', query: new URLSearchParams(), rawBody: '{}' }, null), 503)
    assert.equal((await partnerships()).length, 0)
  })

  test('Função HTTP real (sem opções) aplica a política de produção: 403 pending-specification', async () => {
    const server: Server = createServer((req, res) => void handler(req, res))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { port } = server.address() as AddressInfo
      const response = await fetch(`http://127.0.0.1:${port}/api/osc-partnerships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.get(PERMISSION_USERS.OPERATOR.uid) ?? ''}` },
        body: JSON.stringify({ oscId: ALFA, requestId: 'pedido-http-1', draft: DRAFT }),
      })
      assert.equal(response.status, 403)
      assert.deepEqual(await response.json(), { error: 'forbidden', reason: 'pending-specification' })
      assert.equal(response.headers.get('cache-control'), 'no-store')
    } finally {
      server.close()
    }
    assert.equal((await partnerships()).length, 0)
  })
})

describe('Rotina PREPARADA (bloqueada em produção) — política hipotética de teste', () => {
  const as = (user: { uid: string }, draft: Record<string, unknown> = DRAFT, options: { oscId?: string; requestId?: string } = {}) =>
    register(user, draft, { ...options, policy: HYPOTHETICAL_POLICY })

  test('DEV-02.1-T16 — grava autoria, datas de servidor, situação inicial e auditoria sem conteúdo', async () => {
    const response = await as(PERMISSION_USERS.OPERATOR)
    status(response, 201)
    const id = (response.body.partnership as { id: string }).id
    const doc = (await deps.db.doc(`oscs/${ALFA}/partnerships/${id}`).get()).data()
    assert.ok(doc)
    assert.equal(doc.id, id)
    assert.equal(doc.oscId, ALFA)
    assert.equal(doc.createdBy, PERMISSION_USERS.OPERATOR.uid)
    assert.equal(doc.updatedBy, PERMISSION_USERS.OPERATOR.uid)
    assert.ok(doc.createdAt instanceof Timestamp, 'createdAt é carimbo do servidor')
    assert.ok(doc.updatedAt instanceof Timestamp)
    assert.ok(Math.abs(doc.createdAt.toMillis() - Date.now()) < 60_000)
    assert.equal(doc.administrativeStatus, 'em-execucao')
    assert.deepEqual(doc.workPlan, { approvalDeclared: true, document: 'not-incorporated' })
    assert.equal(doc.globalValueCents, DRAFT.globalValueCents)
    const [event, ...rest] = await events()
    assert.equal(rest.length, 0)
    assert.equal(event?.action, 'create')
    assert.equal(event?.partnershipId, id)
    assert.equal(event?.actorUid, PERMISSION_USERS.OPERATOR.uid)
    assert.equal(event?.actorAuthority, 'member')
    assert.ok(event?.at instanceof Timestamp)
    assert.equal(JSON.stringify(event).includes(DRAFT.object), false, 'auditoria sem o conteúdo do cadastro')
  })

  test('DEV-02.1-T15 — submissão duplicada: mesmo pedido é idempotente; mesma parceria é recusada (409)', async () => {
    const first = await as(PERMISSION_USERS.OPERATOR, DRAFT, { requestId: 'pedido-repetido-1' })
    status(first, 201)
    const again = await as(PERMISSION_USERS.OPERATOR, DRAFT, { requestId: 'pedido-repetido-1' })
    status(again, 200)
    assert.equal(again.body.created, false)
    assert.deepEqual(again.body.partnership, first.body.partnership)
    status(await as(PERMISSION_USERS.OPERATOR, { ...DRAFT, publicPartner: 'SECRETARIA MUNICIPAL FICTICIA DE ASSISTENCIA SOCIAL' }), 409)
    assert.equal((await partnerships()).length, 1)
    assert.equal((await events()).length, 1)
  })

  test('DEV-02.1-T09 a T12 e T15 — validação no servidor com mensagens por campo (422)', async () => {
    const invalid = async (draft: Record<string, unknown>, fields: Record<string, string>) => {
      const response = await as(PERMISSION_USERS.OPERATOR, draft)
      status(response, 422)
      assert.deepEqual(response.body.fields, fields)
    }
    await invalid({ ...DRAFT, instrument: 'convenio' }, { instrument: 'instrument-not-allowed' }) // T12
    await invalid({ ...DRAFT, instrument: 'acordo-cooperacao' }, { globalValueCents: 'not-applicable' }) // T11
    await invalid({ ...DRAFT, instrument: 'termo-fomento', globalValueCents: null }, { globalValueCents: 'required' }) // T10
    await invalid({ ...DRAFT, termEnd: '2026-02-01' }, { termEnd: 'end-not-after-start' }) // T09
    await invalid({ ...DRAFT, workPlanApprovalDeclared: false }, { workPlanApprovalDeclared: 'declaration-required' })
    const withoutValue: Record<string, unknown> = { ...DRAFT }
    delete withoutValue.globalValueCents
    status(await as(PERMISSION_USERS.OPERATOR, { ...withoutValue, instrument: 'acordo-cooperacao', instrumentNumber: '01/2026' }), 201) // T11
    assert.equal((await partnerships()).length, 1)
  })

  test('DEV-02.1-T02/T08 (servidor) — cadastro só na OSC do vínculo; gravação isolada por caminho', async () => {
    status(await as(PERMISSION_USERS.OPERATOR, DRAFT, { oscId: OSCS.GAMA.id }), 403, 'no-membership')
    status(await as(USERS.MULTI), 403, 'permission-not-granted') // administrador sem permissões implícitas
    assert.equal((await partnerships(OSCS.GAMA.id)).length, 0)
    assert.equal((await partnerships()).length, 0)
  })

  test('serverToday usa o fuso de Brasília (AAAA-MM-DD)', () => {
    assert.equal(serverToday(new Date('2026-11-18T02:30:00Z')), '2026-11-17')
    assert.match(serverToday(), /^\d{4}-\d{2}-\d{2}$/)
  })
})

test('DEV-01.3-FIX01 preservado na nova função: carrega sem require(esm) e responde 503 sem credenciais', async () => {
  const api = new URL('../../api/osc-partnerships.ts', import.meta.url).href
  const code = `
    import { Readable } from 'node:stream'
    const { default: handler } = await import(${JSON.stringify(api)})
    const result = await new Promise((resolve) => {
      const req = Object.assign(Readable.from(['{}']), { method: 'POST', headers: { authorization: 'Bearer a.b.c' }, url: '/api/osc-partnerships' })
      const res = { statusCode: 0, setHeader() {}, end(b) { resolve([this.statusCode, JSON.parse(b)]) } }
      handler(req, res)
    })
    console.log(JSON.stringify({ requireModule: process.features.require_module ?? false, result }))
  `
  const { stdout } = await promisify(execFile)(process.execPath, ['--no-experimental-require-module', '--no-warnings', '--input-type=module', '-e', code], {
    env: { PATH: process.env.PATH ?? '' },
    cwd: new URL('../..', import.meta.url).pathname,
  })
  const parsed = JSON.parse(stdout.trim().split('\n').pop() as string) as { requireModule: boolean; result: unknown }
  assert.equal(parsed.requireModule, false)
  assert.deepEqual(parsed.result, [503, { error: 'not-configured' }])
})

after(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)))
})
