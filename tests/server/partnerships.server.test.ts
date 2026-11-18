/**
 * DEV-02.1 e complemento C01 — Cadastro e correção cadastral de parcerias no AMBIENTE CONFIÁVEL.
 * Executar com `npm run test:server`: emuladores de Auth e Firestore, projeto fictício.
 * Admin SDK, código REAL de `api/` e a política de autorização de PRODUÇÃO (sem política
 * hipotética). As permissões são gravadas no vínculo como o servidor de permissões as gravaria
 * (e, em T09, concedidas pela própria API `/api/osc-permissions`).
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
import { handlePartnershipsRequest, serverToday } from '../../api/_lib/partnershipsService.ts'
import { handlePermissionsRequest, type ApiResponse, type ServerDeps } from '../../api/_lib/permissionsService.ts'
import { getServerDeps } from '../../api/_lib/serverDeps.ts'
import { MEMBERS, OSCS, USERS, memberDocument, memberPath, oscDocument, oscPath } from '../support/organizationFixtures.ts'
import { PERMISSION_MEMBERS, PERMISSION_USERS } from '../support/permissionFixtures.ts'
import { partnershipDocument } from '../support/partnershipFixtures.ts'

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-sigosc-server'
process.env.GCLOUD_PROJECT = PROJECT_ID
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST
if (!authHost || !firestoreHost) throw new Error('Emuladores ausentes: execute com "npm run test:server".')

const ALL_USERS = { ...USERS, ...PERMISSION_USERS }
const ALFA = OSCS.ALFA.id
const GAMA = OSCS.GAMA.id
const OP = PERMISSION_USERS.OPERATOR
const DELEGATE = PERMISSION_USERS.DELEGATE
const ADMIN = USERS.MULTI
const TODAY = '2026-11-17'
let deps: ServerDeps
const tokens = new Map<string, string>()

const BASE = {
  instrumentNumber: '06/2026',
  publicPartner: 'Secretaria Municipal Fictícia de Assistência Social',
  object: 'Oficinas socioeducativas fictícias.',
  formalizationDate: '2026-02-20',
  termStart: '2026-03-01',
  termEnd: '2028-02-28',
  administrativeStatus: 'em-execucao',
  workPlanApprovalDeclared: true,
}
const TC = { ...BASE, instrument: 'termo-colaboracao', globalValueStatus: 'informed', globalValueCents: 15_000_000 }
const TF = { ...BASE, instrument: 'termo-fomento', instrumentNumber: '02/2026', globalValueStatus: 'not-informed' }
const AC = { ...BASE, instrument: 'acordo-cooperacao', instrumentNumber: '01/2026' }

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

/** Situação dos vínculos como ficaria após concessões pela gestão de permissões. */
const setPermissions = (user: { uid: string }, permissions: string[], oscId = ALFA) =>
  deps.db.doc(`oscs/${oscId}/members/${user.uid}`).update({ permissions })

let counter = 0
const nextRequest = () => `pedido-${++counter}-teste`
const call = (user: { uid: string } | null, method: 'POST' | 'PATCH', body: Record<string, unknown>) =>
  handlePartnershipsRequest(
    { method, authorization: user ? `Bearer ${tokens.get(user.uid) ?? ''}` : undefined, query: new URLSearchParams(), rawBody: JSON.stringify(body) },
    deps,
    { today: TODAY },
  )
const create = (user: { uid: string }, draft: Record<string, unknown>, options: { oscId?: string; requestId?: string; acknowledgeDuplicates?: boolean } = {}) =>
  call(user, 'POST', {
    oscId: options.oscId ?? ALFA,
    requestId: options.requestId ?? nextRequest(),
    draft,
    ...(options.acknowledgeDuplicates ? { acknowledgeDuplicates: true } : {}),
  })
const edit = (user: { uid: string }, partnershipId: string, changes: Record<string, unknown>, options: { oscId?: string; requestId?: string; expectedRevision?: number } = {}) =>
  call(user, 'PATCH', { oscId: options.oscId ?? ALFA, partnershipId, requestId: options.requestId ?? nextRequest(), expectedRevision: options.expectedRevision ?? 1, changes })
const grant = (actor: { uid: string }, target: { uid: string }, permission: string, action: 'grant-permission' | 'revoke-permission' = 'grant-permission') =>
  handlePermissionsRequest(
    { method: 'POST', authorization: `Bearer ${tokens.get(actor.uid) ?? ''}`, query: new URLSearchParams(), rawBody: JSON.stringify({ oscId: ALFA, targetUid: target.uid, action, permission }) },
    deps,
  )
const docs = async (oscId = ALFA) => (await deps.db.collection(`oscs/${oscId}/partnerships`).get()).docs
const events = async (oscId = ALFA) => (await deps.db.collection(`oscs/${oscId}/partnershipEvents`).get()).docs.map((d) => d.data())
const read = async (id: string, oscId = ALFA) => (await deps.db.doc(`oscs/${oscId}/partnerships/${id}`).get()).data()
const idOf = (response: ApiResponse) => (response.body.partnership as { id: string }).id
const status = (response: ApiResponse, expected: number, reason?: string) => {
  assert.equal(response.status, expected, JSON.stringify(response))
  if (reason) assert.equal(response.body.reason ?? response.body.error, reason, JSON.stringify(response))
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

describe('Permissões (DEC-PAR-001 e DEC-PAR-002)', () => {
  test('DEV-02.1-C01-T02/T03 — create cadastra; somente edit não cadastra', async () => {
    await setPermissions(OP, ['partnerships.create'])
    status(await create(OP, TC), 201)
    await setPermissions(OP, ['partnerships.edit', 'partnerships.view'])
    status(await create(OP, AC), 403, 'permission-not-granted')
    assert.equal((await docs()).length, 1)
  })

  test('DEV-02.1-C01-T04/T05 — edit corrige; somente create não edita', async () => {
    await setPermissions(OP, ['partnerships.create'])
    const id = idOf(await create(OP, TC))
    status(await edit(OP, id, { object: 'Objeto corrigido.' }), 403, 'permission-not-granted')
    await setPermissions(DELEGATE, ['partnerships.edit'])
    const response = await edit(DELEGATE, id, { object: 'Objeto corrigido.', administrativeProcess: '123/2026' })
    status(response, 200)
    assert.deepEqual(response.body.partnership, { id, revision: 2 })
    const doc = await read(id)
    assert.equal(doc?.object, 'Objeto corrigido.')
    assert.equal(doc?.administrativeProcess, '123/2026')
    assert.equal(doc?.updatedBy, DELEGATE.uid)
    assert.equal(doc?.createdBy, OP.uid, 'autoria original preservada')
    const update = (await events()).find((e) => e.action === 'update')
    assert.deepEqual(update?.fields, ['object', 'administrativeProcess'])
    assert.equal(JSON.stringify(update).includes('Objeto corrigido'), false, 'auditoria sem conteúdo')
  })

  test('Correção cadastral não altera campos protegidos (instrumento, datas, valor, situação, autoria)', async () => {
    await setPermissions(OP, ['partnerships.create', 'partnerships.edit'])
    const id = idOf(await create(OP, TC))
    for (const forbidden of [{ termEnd: '2030-01-01' }, { instrument: 'termo-fomento' }, { globalValueCents: 1 }, { administrativeStatus: 'arquivada' }, { createdBy: ADMIN.uid }, { oscId: GAMA }]) {
      status(await edit(OP, id, forbidden), 422)
    }
    status(await call(OP, 'PATCH', { oscId: ALFA, partnershipId: id, requestId: nextRequest(), expectedRevision: 1, changes: { object: 'x' }, createdBy: 'x' }), 400)
    const doc = await read(id)
    assert.deepEqual([doc?.termEnd, doc?.instrument, doc?.globalValueCents, doc?.administrativeStatus, doc?.revision], [TC.termEnd, TC.instrument, TC.globalValueCents, 'em-execucao', 1])
  })

  test('DEV-02.1-C01-T06/T07/T08 — administrador sem permissões implícitas; não se concede; delegado não altera o administrador', async () => {
    status(await create(ADMIN, TC), 403, 'permission-not-granted')
    for (const permission of ['partnerships.create', 'partnerships.edit', 'partnerships.view']) {
      status(await grant(ADMIN, ADMIN, permission), 403, 'self-modification')
      status(await grant(DELEGATE, ADMIN, permission), 403, 'target-is-administrator')
      status(await grant(DELEGATE, ADMIN, permission, 'revoke-permission'), 403, 'target-is-administrator')
    }
    assert.equal((await deps.db.doc(memberPath({ oscId: ALFA, uid: ADMIN.uid })).get()).get('permissions'), undefined)
  })

  test('DEV-02.1-C01-T09 — concessão e revogação reais das novas permissões pela API de permissões', async () => {
    status(await grant(ADMIN, OP, 'partnerships.create'), 200)
    status(await grant(DELEGATE, OP, 'partnerships.edit'), 200)
    const member = (await deps.db.doc(memberPath({ oscId: ALFA, uid: OP.uid })).get()).data()
    assert.deepEqual(member?.permissions, ['partnerships.view', 'partnerships.create', 'partnerships.edit'])
    const id = idOf(await create(OP, TC))
    status(await edit(OP, id, { publicPartner: 'Secretaria Fictícia Renomeada' }), 200)
    status(await grant(ADMIN, OP, 'partnerships.create', 'revoke-permission'), 200)
    status(await create(OP, AC), 403, 'permission-not-granted') // revogação vale imediatamente
    const audit = (await deps.db.collection(`oscs/${ALFA}/permissionEvents`).get()).docs.map((d) => d.data().permission)
    assert.deepEqual(audit.sort(), ['partnerships.create', 'partnerships.create', 'partnerships.edit'])
  })
})

describe('Cadastro (DEC-PAR-003 a DEC-PAR-006)', () => {
  beforeEach(() => setPermissions(OP, ['partnerships.view', 'partnerships.create', 'partnerships.edit']))

  test('DEV-02.1-C01-T10/T11/T12 — TC (valor informado), TF (não informado) e AC (não aplicável)', async () => {
    const tc = await read(idOf(await create(OP, TC)))
    assert.deepEqual([tc?.globalValueStatus, tc?.globalValueCents], ['informed', 15_000_000])
    const tf = await read(idOf(await create(OP, TF)))
    assert.deepEqual([tf?.globalValueStatus, tf?.globalValueCents], ['not-informed', null])
    const ac = await read(idOf(await create(OP, AC)))
    assert.deepEqual([ac?.globalValueStatus, ac?.globalValueCents], ['not-applicable', null])
    status(await create(OP, { ...AC, globalValueStatus: 'informed', globalValueCents: 0 }), 422)
    status(await create(OP, { ...TC, instrument: 'convenio' }), 422)
    assert.equal((await docs()).length, 3)
  })

  test('DEV-02.1-C01-T13/T17/T18 — vigência encerrada e datas históricas; situação não calculada', async () => {
    const ended = await create(OP, { ...AC, formalizationDate: '2015-11-10', termStart: '2015-11-01', termEnd: '2017-10-31', administrativeStatus: 'em-execucao' })
    status(ended, 201)
    assert.deepEqual(ended.body.warnings, { formalizationDate: 'before-mrosc-reference', termStart: 'start-before-formalization' })
    const doc = await read(idOf(ended))
    assert.equal(doc?.administrativeStatus, 'em-execucao', 'declarada pelo usuário, não derivada da vigência encerrada')
    assert.equal(doc?.termEnd, '2017-10-31')
    status(await create(OP, { ...AC, termEnd: '2026-02-01' }), 422) // término anterior ao início: erro comprovado
    status(await create(OP, { ...AC, formalizationDate: '2026-11-18' }), 422) // ainda não formalizada
  })

  test('DEV-02.1-C01-T14/T15 — suspensa e encerrada: cadastradas e sem bloqueio automático de alterações', async () => {
    for (const situation of ['suspensa', 'encerrada']) {
      const id = idOf(await create(OP, { ...AC, instrumentNumber: `S-${situation}`, administrativeStatus: situation }))
      assert.equal((await read(id))?.administrativeStatus, situation)
      status(await edit(OP, id, { object: `Correção em parceria ${situation}.` }), 200)
    }
  })

  test('DEV-02.1-C01-T16 — arquivada: cadastrada, consulta preservada, alterações bloqueadas, sem desarquivar', async () => {
    const id = idOf(await create(OP, { ...AC, administrativeStatus: 'arquivada' }))
    status(await edit(OP, id, { object: 'Tentativa.' }), 403, 'partnership-archived')
    status(await edit(OP, id, { administrativeStatus: 'em-execucao' }), 403, 'partnership-archived')
    const doc = await read(id)
    assert.deepEqual([doc?.administrativeStatus, doc?.object, doc?.revision], ['arquivada', AC.object, 1])
  })

  test('DEV-02.1-C01-T19 — possível duplicidade: aviso com dados para conferência; confirmação explícita; instrumentos distintos livres', async () => {
    const first = idOf(await create(OP, TC))
    const warning = await create(OP, { ...TC, publicPartner: 'SECRETARIA MUNICIPAL FICTICIA DE ASSISTENCIA SOCIAL' })
    status(warning, 409, 'possible-duplicate')
    const [candidate] = warning.body.candidates as { id: string; sameDates: boolean }[]
    assert.equal(candidate?.id, first)
    assert.equal(candidate?.sameDates, true)
    const confirmed = await create(OP, { ...TC, termStart: '2026-04-01' }, { acknowledgeDuplicates: true })
    status(confirmed, 201)
    assert.equal((await events()).find((e) => e.partnershipId === idOf(confirmed))?.duplicateAcknowledged, true)
    status(await create(OP, { ...TC, instrumentNumber: '07/2026' }), 201) // número diferente: sem aviso
    // Quem só cadastra recebe a contagem, sem dados de parcerias que não pode consultar.
    await setPermissions(DELEGATE, ['partnerships.create'])
    const blind = await create(DELEGATE, TC)
    status(blind, 409, 'possible-duplicate')
    assert.deepEqual([blind.body.count, blind.body.candidates], [2, []])
    assert.equal((await docs()).length, 3)
  })

  test('DEV-02.1-C01-T20 — reenvio da mesma solicitação não cria segunda parceria (sequencial e concorrente)', async () => {
    const first = await create(OP, TC, { requestId: 'pedido-repetido-1' })
    status(first, 201)
    const again = await create(OP, TC, { requestId: 'pedido-repetido-1' })
    status(again, 200)
    assert.deepEqual([again.body.created, idOf(again)], [false, idOf(first)])
    // Condição de corrida: cinco envios simultâneos do mesmo pedido → um único cadastro.
    const parallel = await Promise.all(Array.from({ length: 5 }, () => create(OP, AC, { requestId: 'pedido-concorrente-1' })))
    assert.deepEqual(parallel.map((r) => r.status).sort(), [200, 200, 200, 200, 201])
    assert.equal(new Set(parallel.map(idOf)).size, 1)
    assert.equal((await docs()).length, 2)
    assert.equal((await events()).filter((e) => e.action === 'create').length, 2)
    // O mesmo requestId de OUTRO usuário é outro pedido (marcador por usuário).
    await setPermissions(DELEGATE, ['partnerships.create'])
    status(await create(DELEGATE, { ...AC, instrumentNumber: '99/2026' }, { requestId: 'pedido-repetido-1' }), 201)
  })

  test('Correções concorrentes: a revisão impede sobrescrita silenciosa; reenvio da mesma correção é idempotente', async () => {
    const id = idOf(await create(OP, TC))
    await setPermissions(DELEGATE, ['partnerships.edit'])
    const [a, b] = await Promise.all([edit(OP, id, { object: 'Versão A.' }, { requestId: 'correcao-a-1' }), edit(DELEGATE, id, { object: 'Versão B.' }, { requestId: 'correcao-b-1' })])
    assert.deepEqual([a.status, b.status].sort(), [200, 409])
    const loser = a.status === 409 ? a : b
    assert.equal(loser.body.error, 'stale')
    const doc = await read(id)
    assert.equal(doc?.revision, 2)
    const winner = a.status === 200 ? { user: OP, requestId: 'correcao-a-1', object: 'Versão A.' } : { user: DELEGATE, requestId: 'correcao-b-1', object: 'Versão B.' }
    assert.equal(doc?.object, winner.object)
    const replay = await edit(winner.user, id, { object: winner.object }, { requestId: winner.requestId, expectedRevision: 1 })
    status(replay, 200)
    assert.equal(replay.body.changed, false)
    assert.equal((await events()).filter((e) => e.action === 'update').length, 1)
  })
})

describe('Segurança e integridade', () => {
  test('DEV-02.1-C01-T21 — sem autorização: sem vínculo, inativo, sem permissão, sem token', async () => {
    await setPermissions(PERMISSION_USERS.FORMER, ['partnerships.create', 'partnerships.edit'])
    status(await create(USERS.NONE, TC), 403, 'no-membership')
    status(await create(PERMISSION_USERS.FORMER, TC), 403, 'membership-inactive')
    status(await create(DELEGATE, TC), 403, 'permission-not-granted') // delegação não implica permissões operacionais
    status(await edit(DELEGATE, 'qualquer', { object: 'x' }), 403, 'permission-not-granted')
    status(await call(null, 'POST', { oscId: ALFA, requestId: nextRequest(), draft: TC }), 401)
    assert.equal((await docs()).length, 0)
  })

  test('DEV-02.1-C01-T22 — suspensão comercial impede cadastro e correção (inclusive do administrador)', async () => {
    await setPermissions(OP, ['partnerships.create', 'partnerships.edit'])
    const id = idOf(await create(OP, TC))
    await deps.db.doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'suspended' })
    // Permissões do administrador gravadas diretamente só para este teste (simulam a futura Administração da Plataforma).
    await setPermissions(ADMIN, ['partnerships.create', 'partnerships.edit'])
    for (const user of [OP, ADMIN]) {
      status(await create(user, AC), 403, 'commercial-suspension')
      status(await edit(user, id, { object: 'x' }), 403, 'commercial-suspension')
    }
    assert.equal((await docs()).length, 1)
  })

  test('DEV-02.1-C01-T23 — sem escrita ou leitura indevida em outra OSC; corpo forjado recusado', async () => {
    await setPermissions(OP, ['partnerships.view', 'partnerships.create', 'partnerships.edit'])
    await deps.db.doc(`oscs/${GAMA}/partnerships/pGamaColaboracao09x`).set(partnershipDocument({ id: 'pGamaColaboracao09x', oscId: GAMA }))
    status(await create(OP, TC, { oscId: GAMA }), 403, 'no-membership')
    status(await edit(OP, 'pGamaColaboracao09x', { object: 'Invasão.' }, { oscId: GAMA }), 403, 'no-membership')
    // ID de parceria de GAMA enviado sob ALFA: procurado só no caminho de ALFA → não encontrado.
    status(await edit(OP, 'pGamaColaboracao09x', { object: 'Invasão.' }), 404, 'not-found')
    assert.equal((await read('pGamaColaboracao09x', GAMA))?.object, partnershipDocument({ id: 'x', oscId: GAMA }).object)
    for (const forged of [{ ...TC, oscId: GAMA }, { ...TC, createdBy: ADMIN.uid }, { ...TC, id: 'escolhido' }, { ...TC, revision: 9 }]) {
      status(await create(OP, forged), 400)
    }
    status(await call(OP, 'POST', { oscId: ALFA, requestId: 'curto', draft: TC }), 400)
    status(await handlePartnershipsRequest({ method: 'GET', authorization: undefined, query: new URLSearchParams(), rawBody: '' }, deps), 405)
    status(await handlePartnershipsRequest({ method: 'POST', authorization: 'Bearer x', query: new URLSearchParams(), rawBody: '{}' }, null), 503)
    assert.equal((await docs()).length, 0)
    assert.equal((await docs(GAMA)).length, 1)
  })

  test('DEV-02.1-C01-T24 — autoria, carimbos do servidor, situação declarada e auditoria persistidos', async () => {
    await setPermissions(OP, ['partnerships.create'])
    const response = await create(OP, { ...TF, administrativeStatus: 'suspensa' })
    status(response, 201)
    const id = idOf(response)
    const doc = await read(id)
    assert.ok(doc)
    assert.deepEqual([doc.id, doc.oscId, doc.schemaVersion, doc.revision], [id, ALFA, 2, 1])
    assert.deepEqual([doc.createdBy, doc.updatedBy, doc.administrativeStatusDeclaredBy], [OP.uid, OP.uid, OP.uid])
    for (const field of ['createdAt', 'updatedAt', 'administrativeStatusDeclaredAt']) assert.ok(doc[field] instanceof Timestamp, field)
    assert.ok(Math.abs((doc.createdAt as Timestamp).toMillis() - Date.now()) < 60_000)
    assert.deepEqual([doc.administrativeStatus, doc.administrativeStatusSource], ['suspensa', 'declared-at-registration'])
    assert.equal(doc.workPlan.approvalDeclared, true)
    assert.equal(doc.workPlan.document, 'not-incorporated')
    assert.equal(doc.workPlan.declaredBy, OP.uid)
    const marker = (await deps.db.doc(`oscs/${ALFA}/partnershipRequests/${OP.uid}_${doc.creationRequestId}`).get()).data()
    assert.equal(marker?.partnershipId, id)
    const [event, ...rest] = await events()
    assert.equal(rest.length, 0)
    assert.deepEqual([event?.action, event?.partnershipId, event?.actorUid, event?.actorAuthority, event?.administrativeStatus, event?.duplicateAcknowledged], ['create', id, OP.uid, 'member', 'suspensa', false])
    assert.ok(event?.at instanceof Timestamp)
    assert.equal(JSON.stringify(event).includes(TF.object), false, 'auditoria sem o conteúdo do cadastro')
  })

  test('Função HTTP real: cadastro e correção pela rota /api/osc-partnerships', async () => {
    await setPermissions(OP, ['partnerships.create', 'partnerships.edit'])
    const server: Server = createServer((req, res) => void handler(req, res))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { port } = server.address() as AddressInfo
      const url = `http://127.0.0.1:${port}/api/osc-partnerships`
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.get(OP.uid) ?? ''}` }
      const created = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ oscId: ALFA, requestId: 'pedido-http-1', draft: AC }) })
      assert.equal(created.status, 201)
      assert.equal(created.headers.get('cache-control'), 'no-store')
      const { partnership } = (await created.json()) as { partnership: { id: string } }
      const patched = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ oscId: ALFA, partnershipId: partnership.id, requestId: 'correcao-http-1', expectedRevision: 1, changes: { object: 'Corrigido via HTTP.' } }) })
      assert.equal(patched.status, 200)
      assert.equal((await fetch(url, { method: 'DELETE', headers })).status, 405)
    } finally {
      server.close()
    }
    assert.equal((await docs()).length, 1)
  })

  test('serverToday usa o fuso de Brasília (AAAA-MM-DD)', () => {
    assert.equal(serverToday(new Date('2026-11-18T02:30:00Z')), '2026-11-17')
  })
})

test('DEV-01.3-FIX01 preservado: a função carrega sem require(esm) e responde 503 sem credenciais', async () => {
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
