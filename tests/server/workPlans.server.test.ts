/**
 * DEV-02.2 — Plano de Trabalho estruturado no AMBIENTE CONFIÁVEL (`npm run test:server`).
 * Emuladores de Auth e Firestore, projeto fictício; Admin SDK, código REAL de `api/` e política
 * de autorização de PRODUÇÃO (permissões gravadas no vínculo como a gestão de permissões gravaria;
 * em T10 também concedidas pela própria API de permissões).
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { deleteApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp } from 'firebase-admin/firestore'
import handler from '../../api/osc-work-plans.ts'
import { handlePermissionsRequest, type ApiResponse, type ServerDeps } from '../../api/_lib/permissionsService.ts'
import { getServerDeps } from '../../api/_lib/serverDeps.ts'
import { correctionEventId, handleWorkPlansRequest } from '../../api/_lib/workPlansService.ts'
import { CORRECTION_DECLARATION } from '../../src/domain/workPlans.ts'
import { MEMBERS, OSCS, USERS, memberDocument, memberPath, oscDocument, oscPath } from '../support/organizationFixtures.ts'
import { PARTNERSHIPS, partnershipDocument, partnershipPath } from '../support/partnershipFixtures.ts'
import { PERMISSION_MEMBERS, PERMISSION_USERS } from '../support/permissionFixtures.ts'

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
const RUNNING = 'pAlfaColaboracao06' // em execução
const SUSPENDED = 'pAlfaFomento02xxxxx' // administrativamente suspensa
const ARCHIVED = 'pAlfaCooperacao01xx' // arquivada
const GAMA_P = 'pGamaColaboracao09x'
const TODAY = '2026-11-17'
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
  for (const p of PARTNERSHIPS) batch.set(deps.db.doc(partnershipPath(p)), partnershipDocument(p))
  await batch.commit()
}

const setPermissions = (user: { uid: string }, permissions: string[], oscId = ALFA) => deps.db.doc(`oscs/${oscId}/members/${user.uid}`).update({ permissions })
let counter = 0
const nextRequest = () => `pedido-${++counter}-plano`
const call = (user: { uid: string } | null, method: 'POST' | 'PATCH', body: Record<string, unknown>) =>
  handleWorkPlansRequest(
    { method, authorization: user ? `Bearer ${tokens.get(user.uid) ?? ''}` : undefined, query: new URLSearchParams(), rawBody: JSON.stringify(body) },
    deps,
    { today: TODAY },
  )
const start = (user: { uid: string }, partnershipId = RUNNING, options: { oscId?: string; requestId?: string } = {}) =>
  call(user, 'POST', { oscId: options.oscId ?? ALFA, partnershipId, requestId: options.requestId ?? nextRequest(), action: 'start' })
const update = (user: { uid: string }, changes: Record<string, unknown>, options: { partnershipId?: string; revision?: number; requestId?: string; oscId?: string } = {}) =>
  call(user, 'PATCH', { oscId: options.oscId ?? ALFA, partnershipId: options.partnershipId ?? RUNNING, requestId: options.requestId ?? nextRequest(), expectedRevision: options.revision ?? 1, changes })
const finalize = (user: { uid: string }, options: { partnershipId?: string; revision?: number; requestId?: string } = {}) =>
  call(user, 'POST', { oscId: ALFA, partnershipId: options.partnershipId ?? RUNNING, requestId: options.requestId ?? nextRequest(), action: 'finalize', expectedRevision: options.revision ?? 1, confirm: true })
const plan = async (partnershipId = RUNNING, oscId = ALFA) => (await deps.db.doc(`oscs/${oscId}/partnerships/${partnershipId}/workPlans/original`).get()).data()
const events = async () => (await deps.db.collection(`oscs/${ALFA}/workPlanEvents`).get()).docs.map((d) => d.data())
const status = (response: ApiResponse, expected: number, reason?: string) => {
  assert.equal(response.status, expected, JSON.stringify(response))
  if (reason) assert.equal(response.body.reason ?? response.body.error, reason, JSON.stringify(response))
}
const informed = (value: string | number) => ({ state: 'informed', value })
const REQUIRED = { approvalDate: informed('2026-02-10'), executionStart: informed('2026-03-01'), executionEnd: informed('2028-02-28') }

before(async () => {
  const resolved = getServerDeps({ ...process.env, GCLOUD_PROJECT: PROJECT_ID })
  assert.ok(resolved)
  deps = resolved
  const auth = getAuth(getApps().find((a) => a.name === 'sigosc-server'))
  await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' })
  for (const user of Object.values(ALL_USERS)) {
    await auth.createUser({ uid: user.uid, email: user.email, password: user.password })
    tokens.set(user.uid, await signIn(user))
  }
})

beforeEach(seed)

describe('Cadastro estruturado (work-plan.edit)', () => {
  beforeEach(() => setPermissions(OP, ['partnerships.view', 'work-plan.view', 'work-plan.edit']))

  test('DEV-02.2-T04/T14 — inicia o cadastro: tudo "não informado", autoria, carimbos e origem sem versão formal', async () => {
    const response = await start(OP)
    status(response, 201)
    const doc = await plan()
    assert.ok(doc)
    assert.deepEqual([doc.id, doc.oscId, doc.partnershipId, doc.registrationStatus, doc.revision], ['original', ALFA, RUNNING, 'in-registration', 1])
    assert.deepEqual(doc.origin, { kind: 'approved-plan-registration', formalVersion: false, sequence: 1, sourceWorkPlanId: null })
    assert.deepEqual(doc.document, { status: 'not-stored', storagePath: null })
    assert.ok(Object.values(doc.values as Record<string, { state: string }>).every((v) => v.state === 'not-informed'))
    assert.deepEqual([doc.createdBy, doc.updatedBy], [OP.uid, OP.uid])
    assert.ok(doc.createdAt instanceof Timestamp && doc.updatedAt instanceof Timestamp)
    const [event] = await events()
    assert.deepEqual([event?.action, event?.actorUid, event?.partnershipId], ['start', OP.uid, RUNNING])
  })

  test('DEV-02.2-T06/T07/T15 — campos complementares; não informado × não aplicável × zero; alterações auditadas', async () => {
    await start(OP)
    const response = await update(OP, {
      ...REQUIRED,
      targetAudience: { state: 'not-applicable' },
      estimatedBeneficiaries: informed(0),
      justification: informed('  Atendimento a famílias do território.  '),
      complementaryNotes: { state: 'not-informed' },
    })
    status(response, 200)
    const doc = await plan()
    assert.deepEqual(doc?.values.estimatedBeneficiaries, { state: 'informed', value: 0 }) // zero é valor informado
    assert.deepEqual(doc?.values.targetAudience, { state: 'not-applicable' })
    assert.deepEqual(doc?.values.geographicScope, { state: 'not-informed' }) // ausência ≠ não aplicável
    assert.deepEqual(doc?.values.justification, { state: 'informed', value: 'Atendimento a famílias do território.' })
    assert.equal(doc?.revision, 2)
    const updateEvent = (await events()).find((e) => e.action === 'update')
    assert.deepEqual((updateEvent?.fields as string[]).sort(), ['approvalDate', 'estimatedBeneficiaries', 'executionEnd', 'executionStart', 'justification', 'targetAudience'])
    assert.equal(JSON.stringify(updateEvent).includes('famílias'), false, 'auditoria sem conteúdo')
    // "Não aplicável" só onde o campo admite; texto vazio não é "informado"; negativo recusado.
    status(await update(OP, { approvalDate: { state: 'not-applicable' } }, { revision: 2 }), 422)
    status(await update(OP, { justification: informed('   ') }, { revision: 2 }), 422)
    status(await update(OP, { estimatedBeneficiaries: informed(-1) }, { revision: 2 }), 422)
    status(await update(OP, { estimatedBeneficiaries: informed('10') }, { revision: 2 }), 422)
  })

  test('DEV-02.2-T05 — validação no servidor: datas, futuro, período incoerente e campos fora do esquema', async () => {
    await start(OP)
    const invalid = async (changes: Record<string, unknown>, field: string, code: string) => {
      const r = await update(OP, changes)
      status(r, 422)
      assert.equal((r.body.fields as Record<string, string>)[field], code, JSON.stringify(r.body))
    }
    await invalid({ approvalDate: informed('2026-02-30') }, 'approvalDate', 'invalid-date')
    await invalid({ approvalDate: informed('2026-11-18') }, 'approvalDate', 'in-future')
    await invalid({ executionStart: informed('2026-03-01'), executionEnd: informed('2026-02-01') }, 'executionEnd', 'end-before-start')
    for (const forged of [{ registrationStatus: 'finalized' }, { partnershipId: GAMA_P }, { createdBy: ADMIN.uid }, { object: informed('x') }]) {
      status(await update(OP, forged), 422)
    }
    status(await call(OP, 'PATCH', { oscId: ALFA, partnershipId: RUNNING, requestId: nextRequest(), expectedRevision: 1, changes: {}, createdBy: 'x' }), 400)
    assert.equal((await plan())?.revision, 1)
  })

  test('DEV-02.2-T08 — dados autoritativos da parceria não são duplicados no Plano', async () => {
    await start(OP)
    await update(OP, REQUIRED)
    const doc = await plan()
    for (const field of ['instrument', 'instrumentNumber', 'object', 'publicPartner', 'termStart', 'termEnd', 'formalizationDate']) {
      assert.equal(field in (doc ?? {}), false, field)
      assert.equal(field in (doc?.values ?? {}), false, field)
    }
  })

  test('DEV-02.2-T16 — alterações concorrentes: revisão impede sobrescrita; reenvio da mesma alteração é idempotente', async () => {
    await start(OP)
    await setPermissions(DELEGATE, ['work-plan.edit'])
    const [a, b] = await Promise.all([
      update(OP, { justification: informed('Versão A.') }, { requestId: 'alteracao-a-1' }),
      update(DELEGATE, { justification: informed('Versão B.') }, { requestId: 'alteracao-b-1' }),
    ])
    assert.deepEqual([a.status, b.status].sort(), [200, 409])
    assert.equal((a.status === 409 ? a : b).body.error, 'stale')
    const winner = a.status === 200 ? { user: OP, id: 'alteracao-a-1', text: 'Versão A.' } : { user: DELEGATE, id: 'alteracao-b-1', text: 'Versão B.' }
    const replay = await update(winner.user, { justification: informed(winner.text) }, { requestId: winner.id })
    status(replay, 200)
    assert.equal(replay.body.changed, false)
    assert.equal((await plan())?.revision, 2)
  })

  test('DEV-02.2-T17 — inícios duplicados (sequenciais e simultâneos) criam um único registro', async () => {
    const parallel = await Promise.all(Array.from({ length: 5 }, () => start(OP)))
    assert.deepEqual(parallel.map((r) => r.status).sort(), [200, 200, 200, 200, 201])
    status(await start(OP), 200)
    assert.equal((await deps.db.collection(`oscs/${ALFA}/partnerships/${RUNNING}/workPlans`).get()).size, 1)
    assert.equal((await events()).filter((e) => e.action === 'start').length, 1)
  })
})

describe('Finalização interna (DEC-PT-001: work-plan.edit)', () => {
  beforeEach(async () => {
    await setPermissions(OP, ['work-plan.view', 'work-plan.edit'])
    await setPermissions(DELEGATE, ['work-plan.view', 'work-plan.edit'])
  })

  test('DEV-02.2-C01-T03/T04 — work-plan.edit finaliza; work-plan.finalize isolada não autoriza; pendências e confirmação', async () => {
    await start(OP)
    await setPermissions(ADMIN, ['work-plan.view', 'work-plan.finalize']) // identificador descontinuado gravado
    status(await finalize(ADMIN), 403, 'permission-not-granted')
    const pending = await finalize(DELEGATE)
    status(pending, 422, 'finalization-pending')
    assert.equal((pending.body.pending as string[]).length, 3)
    await update(OP, REQUIRED)
    status(await call(DELEGATE, 'POST', { oscId: ALFA, partnershipId: RUNNING, requestId: nextRequest(), action: 'finalize', expectedRevision: 2, confirm: false }), 400)
    status(await finalize(DELEGATE, { revision: 1 }), 409, 'stale')
    const ok = await finalize(DELEGATE, { revision: 2, requestId: 'finalizacao-1' })
    status(ok, 200)
    const doc = await plan()
    assert.deepEqual([doc?.registrationStatus, doc?.finalizedBy, doc?.revision], ['finalized', DELEGATE.uid, 3])
    assert.ok(doc?.finalizedAt instanceof Timestamp)
    assert.equal(doc?.createdBy, OP.uid, 'autoria original preservada')
    assert.equal((await events()).find((e) => e.action === 'finalize')?.actorUid, DELEGATE.uid)
    // Reenvio da mesma finalização: idempotente.
    status(await finalize(DELEGATE, { revision: 2, requestId: 'finalizacao-1' }), 200)
  })

  test('DEV-02.2-T19/T20 — registro finalizado preservado: sem alteração, nova finalização ou reinício', async () => {
    await start(OP)
    await update(OP, { ...REQUIRED, justification: informed('Texto finalizado.') })
    status(await finalize(DELEGATE, { revision: 2 }), 200)
    const before = await plan()
    status(await update(OP, { justification: informed('Alteração silenciosa.') }, { revision: 3 }), 409, 'already-finalized')
    status(await finalize(OP, { revision: 3 }), 409, 'already-finalized')
    status(await start(OP), 409, 'already-finalized')
    const after = await plan()
    assert.deepEqual(after?.values, before?.values)
    assert.equal(after?.revision, 3)
  })

  test('Aviso não impeditivo: período de execução fora da vigência é finalizável e sinalizado', async () => {
    await start(OP)
    await update(OP, { ...REQUIRED, executionEnd: informed('2029-12-31') })
    const r = await finalize(DELEGATE, { revision: 2 })
    status(r, 200)
    assert.equal((r.body.warnings as string[]).length, 1)
  })
})

/** Plano finalizado (pela API real) para os testes de correção material. */
async function finalizedPlan(partnershipId = RUNNING) {
  status(await start(OP, partnershipId), 201)
  status(await update(OP, { ...REQUIRED, estimatedBeneficiaries: { state: 'not-informed' }, geographicScope: { state: 'not-applicable' } }, { partnershipId }), 200)
  status(await finalize(OP, { partnershipId, revision: 2, requestId: `finalizacao-${partnershipId}` }), 200)
  return plan(partnershipId)
}
const JUST = 'Data transcrita incorretamente; o Plano aprovado indica 15/02/2026.'
const correct = (user: { uid: string }, changes: Record<string, unknown>, options: { partnershipId?: string; revision?: number; requestId?: string; justification?: unknown; declaration?: unknown; oscId?: string } = {}) =>
  call(user, 'POST', {
    oscId: options.oscId ?? ALFA,
    partnershipId: options.partnershipId ?? RUNNING,
    requestId: options.requestId ?? nextRequest(),
    action: 'correct',
    expectedRevision: options.revision ?? 3,
    changes,
    justification: 'justification' in options ? options.justification : JUST,
    declaration: 'declaration' in options ? options.declaration : true,
  })
const history = (user: { uid: string }, partnershipId = RUNNING, oscId = ALFA) =>
  handleWorkPlansRequest({ method: 'GET', authorization: `Bearer ${tokens.get(user.uid) ?? ''}`, query: new URLSearchParams({ oscId, partnershipId }), rawBody: '' }, deps)
const corrections = async () => (await events()).filter((e) => e.action === 'material-correction')

describe('Correção de erro material (DEC-PT-002)', () => {
  beforeEach(() => setPermissions(OP, ['work-plan.view', 'work-plan.edit']))

  test('DEV-02.2-C01-T10/T13/T14/T15 — corrige; preserva anterior e corrigido (com estados); finalização original intacta', async () => {
    const before = await finalizedPlan()
    const r = await correct(OP, { approvalDate: informed('2026-02-15'), estimatedBeneficiaries: informed(0), geographicScope: { state: 'not-informed' } }, { requestId: 'correcao-1' })
    status(r, 200)
    assert.equal(r.body.corrected, true)
    const after = await plan()
    assert.deepEqual(after?.values.approvalDate, { state: 'informed', value: '2026-02-15' })
    assert.deepEqual(after?.values.estimatedBeneficiaries, { state: 'informed', value: 0 })
    assert.deepEqual([after?.registrationStatus, after?.revision, after?.correctionCount], ['finalized', 4, 1])
    assert.deepEqual([after?.finalizedBy, after?.finalizationRequestId, after?.createdBy], [before?.finalizedBy, before?.finalizationRequestId, before?.createdBy])
    assert.equal((after?.finalizedAt as Timestamp).toMillis(), (before?.finalizedAt as Timestamp).toMillis())
    assert.equal((after?.createdAt as Timestamp).toMillis(), (before?.createdAt as Timestamp).toMillis())
    assert.deepEqual([after?.id, after?.oscId, after?.partnershipId, after?.origin], [before?.id, before?.oscId, before?.partnershipId, before?.origin])
    const [event] = await corrections()
    assert.ok(event)
    assert.deepEqual(event.corrections, [
      { field: 'approvalDate', before: { state: 'informed', value: '2026-02-10' }, after: { state: 'informed', value: '2026-02-15' } },
      { field: 'estimatedBeneficiaries', before: { state: 'not-informed' }, after: { state: 'informed', value: 0 } },
      { field: 'geographicScope', before: { state: 'not-applicable' }, after: { state: 'not-informed' } },
    ])
    assert.deepEqual([event.oscId, event.partnershipId, event.workPlanId, event.actorUid, event.requestId, event.fromRevision, event.toRevision], [ALFA, RUNNING, 'original', OP.uid, 'correcao-1', 3, 4])
    assert.equal(event.justification, JUST)
    assert.deepEqual(event.declaration, { accepted: true, text: CORRECTION_DECLARATION, automatedVerification: false })
    assert.ok(event.at instanceof Timestamp)
    // O evento de finalização original continua identificável.
    assert.equal((await events()).filter((e) => e.action === 'finalize').length, 1)
  })

  test('DEV-02.2-C01-T11/T12 — justificativa significativa e declaração obrigatórias; sem alteração efetiva recusada', async () => {
    await finalizedPlan()
    const invalid = async (options: Parameters<typeof correct>[2], changes: Record<string, unknown>, key: string, code: string) => {
      const r = await correct(OP, changes, options)
      status(r, 422, 'invalid-correction')
      assert.equal((r.body.fields as Record<string, string>)[key], code, JSON.stringify(r.body))
    }
    const change = { approvalDate: informed('2026-02-15') }
    await invalid({ justification: '   ' }, change, 'correctionReason', 'justification-required')
    await invalid({ justification: 'curta' }, change, 'correctionReason', 'justification-too-short')
    await invalid({ justification: 'x'.repeat(2001) }, change, 'correctionReason', 'justification-too-long')
    await invalid({ declaration: false }, change, 'declaration', 'declaration-required')
    await invalid({ declaration: 'sim' }, change, 'declaration', 'declaration-required')
    await invalid({}, { approvalDate: informed('2026-02-10') }, 'changes', 'no-change') // idêntico ao atual
    await invalid({}, { approvalDate: { state: 'not-informed' } }, 'changes', 'breaks-finalization') // requisito da finalização
    await invalid({}, { executionEnd: informed('2026-01-01') }, 'executionEnd', 'end-before-start')
    await invalid({}, { approvalDate: informed('2999-01-01') }, 'approvalDate', 'in-future')
    // Campos de identidade, autoria ou situação não são corrigíveis.
    for (const forged of [{ registrationStatus: 'in-registration' }, { finalizedAt: 'x' }, { partnershipId: 'outra' }, { object: informed('x') }]) {
      status(await correct(OP, forged), 422, 'invalid-correction')
    }
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, requestId: nextRequest(), action: 'correct', expectedRevision: 3, changes: change, justification: JUST, declaration: true, finalizedBy: ADMIN.uid }), 400)
    assert.deepEqual([(await plan())?.revision, (await corrections()).length], [3, 0])
  })

  test('DEV-02.2-C01-T09 — edição comum segue bloqueada; correção só em Plano finalizado', async () => {
    status(await start(OP), 201)
    status(await correct(OP, { approvalDate: informed('2026-02-15') }, { revision: 1 }), 409, 'not-finalized')
    await update(OP, REQUIRED)
    status(await finalize(OP, { revision: 2 }), 200)
    status(await update(OP, { justification: informed('Edição comum.') }, { revision: 3 }), 409, 'already-finalized')
  })

  test('DEV-02.2-C01-T16/T17 — correções concorrentes: uma vence; reenvio idempotente não duplica (inclusive simultâneo)', async () => {
    await finalizedPlan()
    await setPermissions(DELEGATE, ['work-plan.edit'])
    const [a, b] = await Promise.all([
      correct(OP, { approvalDate: informed('2026-02-15') }, { requestId: 'correcao-a-1' }),
      correct(DELEGATE, { approvalDate: informed('2026-02-16') }, { requestId: 'correcao-b-1' }),
    ])
    assert.deepEqual([a.status, b.status].sort(), [200, 409])
    assert.equal((a.status === 409 ? a : b).body.error, 'stale')
    const winner = a.status === 200 ? OP : DELEGATE
    const winnerId = a.status === 200 ? 'correcao-a-1' : 'correcao-b-1'
    const replay = await correct(winner, { approvalDate: informed('2026-02-20') }, { requestId: winnerId, revision: 3 })
    status(replay, 200)
    assert.equal(replay.body.corrected, false)
    // Reenvios simultâneos do mesmo pedido: uma única correção.
    const parallel = await Promise.all(Array.from({ length: 4 }, () => correct(OP, { executionMethod: informed('Execução direta.') }, { requestId: 'correcao-paralela-1', revision: 4 })))
    assert.ok(parallel.every((r) => r.status === 200))
    assert.equal(parallel.filter((r) => r.body.corrected === true).length, 1)
    assert.deepEqual([(await plan())?.revision, (await corrections()).length], [5, 2])
    assert.ok(await deps.db.doc(`oscs/${ALFA}/workPlanEvents/${correctionEventId(winner.uid, winnerId)}`).get().then((d) => d.exists))
  })

  test('DEV-02.2-C01-T18/T20 — arquivada bloqueia; suspensão comercial bloqueia; suspensão administrativa da parceria não', async () => {
    await finalizedPlan(SUSPENDED)
    status(await correct(OP, { approvalDate: informed('2026-02-15') }, { partnershipId: SUSPENDED }), 200) // parceria suspensa: permitido
    await finalizedPlan()
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}`).update({ administrativeStatus: 'arquivada' })
    status(await correct(OP, { approvalDate: informed('2026-02-15') }), 403, 'partnership-archived')
    await deps.db.doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'suspended' })
    status(await correct(OP, { approvalDate: informed('2026-02-17') }, { partnershipId: SUSPENDED, revision: 4 }), 403, 'commercial-suspension')
    assert.equal((await corrections()).length, 1)
  })

  test('DEV-02.2-C01-T05/T08/T21 — sem work-plan.edit (view, administrador, ID descontinuado) não corrige', async () => {
    await finalizedPlan()
    await setPermissions(DELEGATE, ['work-plan.view'])
    status(await correct(DELEGATE, { approvalDate: informed('2026-02-15') }), 403, 'permission-not-granted')
    status(await correct(ADMIN, { approvalDate: informed('2026-02-15') }), 403, 'permission-not-granted')
    await setPermissions(DELEGATE, ['work-plan.view', 'work-plan.finalize'])
    status(await correct(DELEGATE, { approvalDate: informed('2026-02-15') }), 403, 'permission-not-granted')
    status(await correct(OP, { approvalDate: informed('2026-02-15') }, { oscId: GAMA }), 403, 'no-membership')
    assert.equal((await corrections()).length, 0)
  })

  test('DEV-02.2-C01-T19 — histórico: servidor, work-plan.view, só a própria OSC; responsável sem dados de terceiros', async () => {
    await finalizedPlan()
    status(await correct(OP, { approvalDate: informed('2026-02-15') }, { requestId: 'historico-1' }), 200)
    await setPermissions(DELEGATE, ['work-plan.edit'])
    status(await correct(DELEGATE, { executionMethod: informed('Execução direta.') }, { revision: 4, justification: 'Campo omitido na transcrição do Plano aprovado.' }), 200)
    const own = await history(OP)
    status(own, 200)
    const entries = own.body.entries as { actor: string; actorAuthority: string; corrections: { field: string }[]; justification: string; toRevision: number }[]
    assert.deepEqual(entries.map((e) => [e.actor, e.actorAuthority, e.corrections[0]?.field, e.toRevision]), [['you', 'member', 'approvalDate', 4], ['other', 'delegate', 'executionMethod', 5]])
    assert.equal(JSON.stringify(own.body).includes(DELEGATE.uid), false, 'sem UID ou e-mail de terceiros')
    // Quem tem só edit (sem view) não consulta o histórico; nem outra OSC; nem sem vínculo.
    status(await history(DELEGATE), 403, 'permission-not-granted')
    await setPermissions(USERS.SINGLE, ['partnerships.view', 'work-plan.view'], GAMA)
    status(await history(USERS.SINGLE), 403, 'no-membership')
    status(await history(USERS.SINGLE, RUNNING, GAMA), 404, 'not-found') // ID de ALFA sob GAMA
    status(await history(USERS.NONE), 403, 'no-membership')
    status(await handleWorkPlansRequest({ method: 'GET', authorization: `Bearer ${tokens.get(OP.uid) ?? ''}`, query: new URLSearchParams({ oscId: ALFA, partnershipId: RUNNING, extra: '1' }), rawBody: '' }, deps), 400)
    // Suspensão comercial: o administrador com view mantém a consulta; os demais não.
    await deps.db.doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'suspended' })
    status(await history(OP), 403, 'commercial-suspension')
    await setPermissions(ADMIN, ['work-plan.view'])
    status(await history(ADMIN), 200)
  })
})

describe('Segurança e situações', () => {
  test('DEV-02.2-T10 — sem permissão (inclusive administrador e delegado sem permissões operacionais) nada é gravado', async () => {
    status(await start(OP), 403, 'permission-not-granted') // OP só tem partnerships.view
    status(await start(ADMIN), 403, 'permission-not-granted')
    status(await start(DELEGATE), 403, 'permission-not-granted')
    status(await start(USERS.NONE), 403, 'no-membership')
    status(await call(null, 'POST', { oscId: ALFA, partnershipId: RUNNING, requestId: nextRequest(), action: 'start' }), 401)
    // Concessão real pela API de permissões habilita imediatamente; revogação bloqueia.
    const grant = (permission: string, action = 'grant-permission') =>
      handlePermissionsRequest({ method: 'POST', authorization: `Bearer ${tokens.get(ADMIN.uid) ?? ''}`, query: new URLSearchParams(), rawBody: JSON.stringify({ oscId: ALFA, targetUid: OP.uid, action, permission }) }, deps)
    status(await grant('work-plan.edit'), 200)
    status(await start(OP), 201)
    status(await grant('work-plan.edit', 'revoke-permission'), 200)
    status(await update(OP, REQUIRED), 403, 'permission-not-granted')
    assert.equal((await plan())?.revision, 1)
  })

  test('DEV-02.2-T11 — suspensão comercial impede início, alteração e finalização', async () => {
    await setPermissions(OP, ['work-plan.edit'])
    await start(OP)
    await deps.db.doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'suspended' })
    status(await start(OP, SUSPENDED), 403, 'commercial-suspension')
    status(await update(OP, REQUIRED), 403, 'commercial-suspension')
    status(await finalize(OP), 403, 'commercial-suspension')
  })

  test('DEV-02.2-T12/T13 — arquivada: somente consulta; suspensa administrativamente: operações autorizadas', async () => {
    await setPermissions(OP, ['work-plan.edit'])
    status(await start(OP, ARCHIVED), 403, 'partnership-archived')
    status(await start(OP, SUSPENDED), 201)
    status(await update(OP, REQUIRED, { partnershipId: SUSPENDED }), 200)
    status(await finalize(OP, { partnershipId: SUSPENDED, revision: 2 }), 200)
    // Plano já existente em parceria arquivada também fica somente para consulta.
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}`).update({ administrativeStatus: 'arquivada' })
    status(await start(OP), 403, 'partnership-archived')
  })

  test('DEV-02.2-T02 (servidor) — sem gravação cruzada entre OSCs; ID desconhecido não revela nada', async () => {
    await setPermissions(OP, ['work-plan.edit'])
    await deps.db.doc(`oscs/${GAMA}/partnerships/${GAMA_P}`).set(partnershipDocument({ id: GAMA_P, oscId: GAMA }))
    status(await start(OP, GAMA_P, { oscId: GAMA }), 403, 'no-membership')
    status(await start(OP, GAMA_P), 404, 'not-found') // ID de GAMA sob ALFA: não existe neste caminho
    status(await start(OP, 'inexistente'), 404, 'not-found')
    await setPermissions(DELEGATE, [])
    status(await start(DELEGATE, 'inexistente'), 403, 'permission-not-granted') // sem permissão: nem 404
    assert.equal(await plan(GAMA_P, GAMA), undefined)
    status(await update(OP, REQUIRED, { partnershipId: RUNNING }), 409, 'not-structured')
  })

  test('Função HTTP real /api/osc-work-plans: início, alteração e método não permitido', async () => {
    await setPermissions(OP, ['work-plan.edit'])
    const server: Server = createServer((req, res) => void handler(req, res))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { port } = server.address() as AddressInfo
      const url = `http://127.0.0.1:${port}/api/osc-work-plans`
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.get(OP.uid) ?? ''}` }
      const started = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ oscId: ALFA, partnershipId: RUNNING, requestId: 'http-inicio-1', action: 'start' }) })
      assert.equal(started.status, 201)
      assert.equal(started.headers.get('cache-control'), 'no-store')
      const patched = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ oscId: ALFA, partnershipId: RUNNING, requestId: 'http-alteracao-1', expectedRevision: 1, changes: REQUIRED }) })
      assert.equal(patched.status, 200)
      assert.equal((await fetch(url, { method: 'DELETE', headers })).status, 405)
    } finally {
      server.close()
    }
    status(await handleWorkPlansRequest({ method: 'POST', authorization: 'Bearer x', query: new URLSearchParams(), rawBody: '{}' }, null), 503)
  })
})

after(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)))
})
