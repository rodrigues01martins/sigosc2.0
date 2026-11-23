/**
 * DEV-UXPT-01 — CARACTERIZAÇÃO do comportamento LEGADO das APIs do Plano (`npm run test:server`).
 *
 * Emuladores de Auth e Firestore (projeto `demo-`), Admin SDK e código REAL de `api/`. Os estados
 * legados são SEMEADOS diretamente (fixtures fictícias) para registrar como as três APIs atuais
 * (`osc-work-plans`, `osc-work-plan-components`, `osc-work-plan-financial`) os tratam em `6b9fc3c`.
 *
 * Testes marcados "LEGADO" descrevem limitações do modelo com finalização interna obrigatória que
 * poderão ser substituídas pela UX-PT-02 (DEV-UXPT-02 e seguintes). Ao substituí-las, o teste deve
 * ser trocado EXPLICITAMENTE pelo novo contrato — nunca ter asserções enfraquecidas.
 * Referência: docs/uxpt/DEV-UXPT-01-compatibilidade.md.
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import type { ApiResponse, ServerDeps } from '../../api/_lib/permissionsService.ts'
import { getServerDeps } from '../../api/_lib/serverDeps.ts'
import { handleWorkPlanComponentsRequest } from '../../api/_lib/workPlanComponentsService.ts'
import { handleWorkPlanFinancialRequest } from '../../api/_lib/workPlanFinancialService.ts'
import { handleWorkPlansRequest } from '../../api/_lib/workPlansService.ts'
import { MEMBERS, OSCS, USERS, memberDocument, memberPath, oscDocument, oscPath } from '../support/organizationFixtures.ts'
import { PARTNERSHIPS, partnershipDocument, partnershipPath } from '../support/partnershipFixtures.ts'
import { PERMISSION_MEMBERS, PERMISSION_USERS } from '../support/permissionFixtures.ts'
import { reviewed } from '../support/reviewFixtures.ts'
import { categoryData, componentDocument, goalData, itemData, workPlanDocument, type WorkPlanFixture } from '../support/workPlanFixtures.ts'

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-sigosc-server'
process.env.GCLOUD_PROJECT = PROJECT_ID
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST
if (!authHost || !firestoreHost) throw new Error('Emuladores ausentes: execute com "npm run test:server".')

const ALL_USERS = { ...USERS, ...PERMISSION_USERS }
const ALFA = OSCS.ALFA.id
const GAMA = OSCS.GAMA.id
const OP = PERMISSION_USERS.OPERATOR
const ADMIN = USERS.MULTI
const RUNNING = 'pAlfaColaboracao06'
const COOPERATION = 'pAlfaCooperacao01xx'
const GAMA_P = 'pGamaColaboracao09x'
const TODAY = '2026-11-17'
const GOAL = 'g_00000000000000000001'
const CATEGORY = 'c_00000000000000000001'
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
  await setPermissions(OP, ['work-plan.view', 'work-plan.edit'])
}

const setPermissions = (user: { uid: string }, permissions: string[], oscId = ALFA) => deps.db.doc(`oscs/${oscId}/members/${user.uid}`).update({ permissions })
const informed = (value: string | number) => ({ state: 'informed', value }) as const
const REQUIRED = { approvalDate: informed('2026-02-10'), executionStart: informed('2026-03-01'), executionEnd: informed('2028-02-28') }
let counter = 0
const nextRequest = () => `pedido-${++counter}-legado`
const auth = (user: { uid: string }) => `Bearer ${tokens.get(user.uid) ?? ''}`
const plans = (user: { uid: string }, method: 'POST' | 'PATCH', body: Record<string, unknown>) =>
  handleWorkPlansRequest({ method, authorization: auth(user), query: new URLSearchParams(), rawBody: JSON.stringify(body) }, deps, { today: TODAY })
const history = (user: { uid: string }, partnershipId = RUNNING) =>
  handleWorkPlansRequest({ method: 'GET', authorization: auth(user), query: new URLSearchParams({ oscId: ALFA, partnershipId }), rawBody: '' }, deps, { today: TODAY })
const createGoal = (user: { uid: string }, o: { oscId?: string; partnershipId?: string; workPlanId?: string; requestId?: string } = {}) =>
  handleWorkPlanComponentsRequest(
    { method: 'POST', authorization: auth(user), query: new URLSearchParams(), rawBody: JSON.stringify({ oscId: o.oscId ?? ALFA, partnershipId: o.partnershipId ?? RUNNING, workPlanId: o.workPlanId ?? 'original', requestId: o.requestId ?? nextRequest(), action: 'create-goal', data: goalData('Meta 09') }) },
    deps,
  )
const createCategory = (user: { uid: string }, o: { oscId?: string; partnershipId?: string; workPlanId?: string } = {}) =>
  handleWorkPlanFinancialRequest(
    { method: 'POST', authorization: auth(user), query: new URLSearchParams(), rawBody: JSON.stringify({ oscId: o.oscId ?? ALFA, partnershipId: o.partnershipId ?? RUNNING, workPlanId: o.workPlanId ?? 'original', requestId: nextRequest(), action: 'create-category', data: categoryData('C9', 'Categoria fictícia') }) },
    deps,
  )
const update = (user: { uid: string }, changes: Record<string, unknown>, expectedRevision: number, o: { workPlanId?: string; requestId?: string; partnershipId?: string; oscId?: string } = {}) =>
  plans(user, 'PATCH', { oscId: o.oscId ?? ALFA, partnershipId: o.partnershipId ?? RUNNING, workPlanId: o.workPlanId ?? 'original', requestId: o.requestId ?? nextRequest(), expectedRevision, changes })
const correct = (user: { uid: string }, changes: Record<string, unknown>, expectedRevision: number, o: { workPlanId?: string; requestId?: string } = {}) =>
  plans(user, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: o.workPlanId ?? 'original', requestId: o.requestId ?? nextRequest(), action: 'correct', expectedRevision, changes, justification: 'Transcrição divergente do Plano aprovado.', declaration: true })
const finalize = (user: { uid: string }, expectedRevision: number, o: { workPlanId?: string; requestId?: string } = {}) =>
  plans(user, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: o.workPlanId ?? 'original', requestId: o.requestId ?? nextRequest(), action: 'finalize', expectedRevision, confirm: true, ...reviewed() })
const createVersion = (user: { uid: string }, base = 'original', baseRevision = 1) =>
  plans(user, 'POST', { oscId: ALFA, partnershipId: RUNNING, requestId: nextRequest(), action: 'create-version', baseWorkPlanId: base, baseRevision, formalAct: { type: 'apostilamento', actDate: '2026-10-01' } })

const status = (response: ApiResponse, expected: number, reason?: string) => {
  assert.equal(response.status, expected, JSON.stringify(response))
  if (reason) assert.equal(response.body.reason ?? response.body.error, reason, JSON.stringify(response))
}
const planPath = (id: string, partnershipId = RUNNING, oscId = ALFA) => `oscs/${oscId}/partnerships/${partnershipId}/workPlans/${id}`
const docOf = async (id: string, partnershipId = RUNNING) => (await deps.db.doc(planPath(id, partnershipId)).get()).data()
const events = async (partnershipId = RUNNING) => (await deps.db.collection(`oscs/${ALFA}/workPlanEvents`).where('partnershipId', '==', partnershipId).get()).docs.map((d) => d.data())
const versionIds = async (partnershipId = RUNNING) => (await deps.db.collection(`oscs/${ALFA}/partnerships/${partnershipId}/workPlans`).get()).docs.map((d) => d.id).sort()

/** Semeia uma versão legada com componentes opcionais (dados fictícios). */
async function plan(fixture: Partial<WorkPlanFixture> & { partnershipId?: string; extra?: Record<string, unknown> } = {}) {
  const p = { oscId: ALFA, partnershipId: RUNNING, ...fixture }
  const doc = { ...workPlanDocument(p), ...fixture.extra }
  await deps.db.doc(planPath(doc.id, p.partnershipId, p.oscId)).set(doc)
  const target = { oscId: p.oscId, partnershipId: p.partnershipId, workPlanId: doc.id }
  for (const g of fixture.goals ?? []) await deps.db.doc(`${planPath(doc.id, p.partnershipId, p.oscId)}/goals/${g.id}`).set(componentDocument('goal', g, target))
  for (const c of fixture.financialCategories ?? []) await deps.db.doc(`${planPath(doc.id, p.partnershipId, p.oscId)}/financialCategories/${c.id}`).set(componentDocument('financial-category', c, target))
  for (const i of fixture.financialItems ?? []) await deps.db.doc(`${planPath(doc.id, p.partnershipId, p.oscId)}/financialItems/${i.id}`).set(componentDocument('financial-item', i, target))
  return doc
}
const finalizedOriginal = (extra: Partial<WorkPlanFixture> = {}) => plan({ status: 'finalized', revision: 3, values: REQUIRED, ...extra })

before(async () => {
  const resolved = getServerDeps({ ...process.env, GCLOUD_PROJECT: PROJECT_ID })
  assert.ok(resolved)
  deps = resolved
  const authAdmin = getAuth(getApps().find((a) => a.name === 'sigosc-server'))
  await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' })
  for (const user of Object.values(ALL_USERS)) {
    await authAdmin.createUser({ uid: user.uid, email: user.email, password: user.password })
    tokens.set(user.uid, await signIn(user))
  }
})

after(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)))
})

beforeEach(seed)

describe('DEV-UXPT-01 — Plano não estruturado e em cadastramento', () => {
  test('UXPT01-S01 — não estruturado: nenhuma gravação cria o original implicitamente (exige "start")', async () => {
    status(await update(OP, REQUIRED, 1), 409, 'not-structured')
    status(await finalize(OP, 1), 409, 'not-structured')
    status(await correct(OP, REQUIRED, 1), 409, 'not-finalized')
    status(await createGoal(OP), 404, 'not-found')
    status(await createCategory(OP), 404, 'not-found')
    status(await createVersion(OP), 409, 'base-not-finalized')
    assert.deepEqual(await versionIds(), [])
    assert.deepEqual(await events(), [])
  })

  test('UXPT01-S02 — "start" cria o original com ID fixo, idempotente por reenvio', async () => {
    const requestId = nextRequest()
    const first = await plans(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, requestId, action: 'start' })
    status(first, 201)
    assert.deepEqual(first.body.workPlan, { id: 'original', revision: 1, registrationStatus: 'in-registration' })
    // Qualquer novo "start" sobre original em cadastramento devolve o estado, sem duplicar.
    const again = await plans(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, requestId: nextRequest(), action: 'start' })
    status(again, 200)
    assert.equal(again.body.created, false)
    const doc = await docOf('original')
    assert.deepEqual(doc?.origin, { kind: 'approved-plan-registration', formalVersion: false, sequence: 1, sourceWorkPlanId: null })
    assert.equal(doc?.startRequestId, requestId)
    assert.deepEqual((await events()).map((e) => e.action), ['start'])
  })

  test('UXPT01-S03 — cadastramento: salvamento por campo com revisão, idempotência e conflito "stale"', async () => {
    await plan({ revision: 1 })
    const requestId = nextRequest()
    const saved = await update(OP, { approvalDate: informed('2026-02-10') }, 1, { requestId })
    status(saved, 200)
    assert.deepEqual(saved.body.workPlan, { id: 'original', revision: 2, registrationStatus: 'in-registration' })
    // Reenvio do MESMO pedido: estado confirmado, sem nova revisão nem evento.
    const retry = await update(OP, { approvalDate: informed('2026-02-11') }, 1, { requestId })
    status(retry, 200)
    assert.equal(retry.body.changed, false)
    // Revisão desatualizada.
    const stale = await update(OP, { executionStart: informed('2026-03-01') }, 1)
    status(stale, 409, 'stale')
    assert.equal(stale.body.revision, 2)
    // Sem alteração efetiva: nada é gravado.
    const same = await update(OP, { approvalDate: informed('2026-02-10') }, 2)
    status(same, 200)
    assert.equal(same.body.changed, false)
    const doc = await docOf('original')
    assert.deepEqual([doc?.revision, doc?.values.approvalDate, doc?.registrationStatus], [2, informed('2026-02-10'), 'in-registration'])
    const log = await events()
    assert.deepEqual(log.map((e) => [e.action, e.fromRevision, e.toRevision, e.fields]), [['update', 1, 2, ['approvalDate']]])
    // Correção material não se aplica a cadastro em andamento.
    status(await correct(OP, { approvalReference: informed('Parecer 1') }, 2), 409, 'not-finalized')
  })

  test('UXPT01-S04 — cadastramento: metas e financeiro gravam com procedure "registration"', async () => {
    await plan({ revision: 1 })
    status(await createGoal(OP), 201)
    status(await createCategory(OP), 201)
    const procedures = (await events()).map((e) => [e.action, e.procedure])
    assert.deepEqual(procedures.sort(), [['financial-category-created', 'registration'], ['goal-created', 'registration']])
  })
})

describe('DEV-UXPT-01 — Plano finalizado (LEGADO)', () => {
  test('UXPT01-S05 (LEGADO) — finalizado: edição comum, novo start e nova finalização recusados; documento intacto', async () => {
    const seeded = await finalizedOriginal()
    status(await update(OP, { approvalReference: informed('Parecer 1') }, 3), 409, 'already-finalized')
    status(await plans(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, requestId: nextRequest(), action: 'start' }), 409, 'already-finalized')
    status(await finalize(OP, 3), 409, 'already-finalized')
    // Sem componentes: o servidor indica o procedimento excepcional próprio de cada componente.
    status(await createGoal(OP), 409, 'complementary-transcription-pending')
    status(await createCategory(OP), 409, 'financial-transcription-pending')
    const doc = await docOf('original')
    assert.deepEqual([doc?.revision, doc?.registrationStatus, doc?.finalizedBy, doc?.finalizationRequestId], [3, 'finalized', seeded.finalizedBy, 'req-final'])
    assert.deepEqual(doc?.values, seeded.values)
    assert.deepEqual(await events(), [])
  })

  test('UXPT01-S06 (LEGADO) — finalizado COM componentes: edição de metas e financeiro recusada como "already-finalized"', async () => {
    await finalizedOriginal({ goals: [{ id: GOAL, data: goalData('Meta 01') }], financialCategories: [{ id: CATEGORY, data: categoryData('C1', 'Pessoal') }], financialItems: [{ id: 'f_00000000000000000001', data: itemData('F1', CATEGORY, 1000) }] })
    status(await createGoal(OP), 409, 'already-finalized')
    status(await createCategory(OP), 409, 'already-finalized')
  })

  test('UXPT01-S07 — correção material atual: altera só o documento indicado, preserva a finalização e audita antes/depois', async () => {
    const seeded = await finalizedOriginal()
    const requestId = nextRequest()
    const r = await correct(OP, { approvalReference: informed('Parecer 12/2026') }, 3, { requestId })
    status(r, 200)
    assert.deepEqual(r.body.workPlan, { id: 'original', revision: 4, registrationStatus: 'finalized' })
    const doc = await docOf('original')
    // Campos históricos preservados.
    assert.deepEqual([doc?.registrationStatus, doc?.finalizedBy, doc?.finalizationRequestId, doc?.createdBy], ['finalized', seeded.finalizedBy, 'req-final', seeded.createdBy])
    assert.equal(doc?.finalizedAt.toDate().toISOString(), seeded.finalizedAt?.toISOString())
    assert.deepEqual([doc?.revision, doc?.correctionCount, doc?.lastCorrectionBy], [4, 1, OP.uid])
    assert.deepEqual(doc?.values.approvalReference, informed('Parecer 12/2026'))
    // Evento com ID determinístico (marcador de idempotência) e valores anteriores/posteriores.
    const event = (await deps.db.doc(`oscs/${ALFA}/workPlanEvents/correction_${OP.uid}_${requestId}`).get()).data()
    assert.equal(event?.action, 'material-correction')
    assert.deepEqual(event?.corrections, [{ field: 'approvalReference', before: { state: 'not-informed' }, after: informed('Parecer 12/2026') }])
    assert.deepEqual([event?.fromRevision, event?.toRevision, event?.declaration.accepted], [3, 4, true])
    // Reenvio: sem nova revisão nem novo evento.
    const retry = await correct(OP, { approvalReference: informed('Outro') }, 3, { requestId })
    status(retry, 200)
    assert.deepEqual([retry.body.corrected, (retry.body.workPlan as { revision: number }).revision], [false, 4])
    assert.equal((await events()).length, 1)
    // A correção não pode desfazer os requisitos da finalização.
    const breaks = await correct(OP, { executionStart: { state: 'not-informed' } }, 4)
    status(breaks, 422, 'invalid-correction')
    // Histórico servido pelo servidor (somente correções materiais).
    const h = await history(OP)
    status(h, 200)
    assert.equal((h.body.entries as unknown[]).length, 1)
  })
})

describe('DEV-UXPT-01 — versões formais e ativação (LEGADO)', () => {
  test('UXPT01-S08 (LEGADO) — ativação ocorre SOMENTE na finalização da versão posterior; substituída recebe só activation.*', async () => {
    const original = await finalizedOriginal()
    await plan({ sequence: 2, revision: 2, values: REQUIRED })
    assert.equal((await docOf('v2'))?.activation.status, 'awaiting-finalization')
    const requestId = nextRequest()
    const r = await finalize(OP, 2, { workPlanId: 'v2', requestId })
    status(r, 200)
    assert.equal((r.body.workPlan as { activationStatus: string }).activationStatus, 'active')
    const v2 = await docOf('v2')
    assert.deepEqual([v2?.registrationStatus, v2?.activation.status, v2?.activation.rule, v2?.activation.supersededWorkPlanId, v2?.activation.finalizationRequestId], ['finalized', 'active', 'DEC-PT-003', 'original', requestId])
    const after = await docOf('original')
    assert.deepEqual([after?.activation.status, after?.activation.supersededByWorkPlanId], ['superseded', 'v2'])
    // Valores, revisão e finalização da substituída intactos.
    assert.deepEqual([after?.revision, after?.registrationStatus, after?.finalizedBy, after?.values], [original.revision, 'finalized', original.finalizedBy, original.values])
    assert.deepEqual((await events()).map((e) => e.action).sort(), ['components-reviewed', 'finalize', 'version-activated'])
    // Reenvio: estado confirmado, sem nova ativação nem eventos.
    const retry = await finalize(OP, 2, { workPlanId: 'v2', requestId })
    status(retry, 200)
    assert.equal(retry.body.finalized, false)
    assert.equal((await events()).length, 3)
  })

  test('UXPT01-S09 (LEGADO) — versão em cadastramento não é vigente e impede nova alteração formal (DEC-PT-004)', async () => {
    await finalizedOriginal()
    await plan({ sequence: 2, revision: 1, values: REQUIRED })
    status(await createVersion(OP, 'original', 3), 409, 'pending-version-exists')
    // Edição comum permitida na versão em cadastramento; a original permanece bloqueada.
    status(await update(OP, { approvalReference: informed('TA 1') }, 1, { workPlanId: 'v2' }), 200)
    status(await update(OP, { approvalReference: informed('TA 1') }, 3), 409, 'already-finalized')
  })

  test('UXPT01-S10 (LEGADO) — versão legada "pending-decision" finalizada: não é ativada retroativamente e bloqueia nova versão', async () => {
    await finalizedOriginal()
    await plan({ sequence: 2, status: 'finalized', revision: 3, values: REQUIRED, activation: 'pending-decision' })
    status(await createVersion(OP, 'original', 3), 409, 'legacy-version-pending')
    status(await finalize(OP, 3, { workPlanId: 'v2' }), 409, 'already-finalized')
    assert.equal((await docOf('v2'))?.activation.status, 'pending-decision')
    assert.equal((await docOf('original'))?.activation, undefined)
  })

  test('UXPT01-S11 — cadeia inconsistente (duas ativas) bloqueia nova versão sem escolher por suposição', async () => {
    await finalizedOriginal({ activation: 'superseded' })
    await plan({ sequence: 2, status: 'finalized', revision: 3, values: REQUIRED, activation: 'active' })
    await plan({ sequence: 3, status: 'finalized', revision: 3, values: REQUIRED, activation: 'active' })
    status(await createVersion(OP, 'v3', 3), 409, 'versions-inconsistent')
  })

  test('UXPT01-S12 (LEGADO) — versão substituída: sem edição nem incorporação; correção material AINDA admitida', async () => {
    await finalizedOriginal({ activation: 'superseded' })
    await plan({ sequence: 2, status: 'finalized', revision: 3, values: REQUIRED, activation: 'active' })
    status(await update(OP, { approvalReference: informed('X') }, 3), 409, 'already-finalized')
    status(await plans(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'open-transcription', declaration: true }), 409, 'transcription-not-current')
    // Comportamento atual registrado: decideWorkPlanOperation('correct') só exige "finalizado".
    status(await correct(OP, { approvalReference: informed('Parecer 3') }, 3), 200)
    assert.equal((await docOf('original'))?.activation.status, 'superseded')
  })
})

describe('DEV-UXPT-01 — incorporações excepcionais (LEGADO)', () => {
  test('UXPT01-S13 (LEGADO) — incorporação de metas aberta libera SOMENTE metas/indicadores e bloqueia nova versão', async () => {
    await finalizedOriginal({ transcription: { status: 'open' } })
    status(await createGoal(OP), 201)
    status(await createCategory(OP), 409, 'financial-transcription-pending')
    status(await createVersion(OP, 'original', 3), 409, 'transcription-open')
    status(await update(OP, { approvalReference: informed('X') }, 3), 409, 'already-finalized')
    assert.deepEqual((await events()).map((e) => [e.action, e.procedure]), [['goal-created', 'complementary-transcription']])
  })

  test('UXPT01-S14 (LEGADO) — incorporação financeira aberta libera SOMENTE o financeiro e bloqueia nova versão', async () => {
    await finalizedOriginal({ financialTranscription: { status: 'open' } })
    status(await createCategory(OP), 201)
    status(await createGoal(OP), 409, 'complementary-transcription-pending')
    status(await createVersion(OP, 'original', 3), 409, 'financial-transcription-open')
    assert.deepEqual((await events()).map((e) => [e.action, e.procedure]), [['financial-category-created', 'financial-transcription']])
  })

  test('UXPT01-S15 (LEGADO) — incorporações encerradas: somente consulta, sem reabertura', async () => {
    await finalizedOriginal({ transcription: { status: 'closed' }, financialTranscription: { status: 'closed' } })
    status(await createGoal(OP), 409, 'transcription-closed')
    status(await createCategory(OP), 409, 'financial-transcription-closed')
    status(await plans(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'open-transcription', declaration: true }), 409, 'transcription-closed')
    status(await plans(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'open-financial-transcription', declaration: true }), 409, 'financial-transcription-closed')
    // Encerradas não bloqueiam nova alteração formal.
    status(await createVersion(OP, 'original', 3), 201)
  })
})

describe('DEV-UXPT-01 — isolamento, permissões e aplicabilidade', () => {
  test('UXPT01-S16 — isolamento por OSC nas três APIs', async () => {
    await plan({ oscId: GAMA, partnershipId: GAMA_P, revision: 1 })
    status(await update(OP, REQUIRED, 1, { oscId: GAMA, partnershipId: GAMA_P }), 403, 'no-membership')
    status(await createGoal(OP, { oscId: GAMA, partnershipId: GAMA_P }), 403, 'no-membership')
    status(await createCategory(OP, { oscId: GAMA, partnershipId: GAMA_P }), 403, 'no-membership')
    // ID de parceria de outra OSC sob a OSC do usuário: inexistente (o caminho isola).
    status(await update(OP, REQUIRED, 1, { partnershipId: GAMA_P }), 404, 'not-found')
    status(await createGoal(OP, { partnershipId: GAMA_P }), 404, 'not-found')
    assert.equal((await deps.db.doc(planPath('original', GAMA_P, GAMA)).get()).get('revision'), 1)
  })

  test('UXPT01-S17 — permissões individuais: view, financial.view e administrador sem permissão não gravam', async () => {
    await plan({ revision: 1 })
    await setPermissions(OP, ['work-plan.view', 'financial.view'])
    status(await update(OP, REQUIRED, 1), 403, 'permission-not-granted')
    status(await createGoal(OP), 403, 'permission-not-granted')
    status(await createCategory(OP), 403, 'permission-not-granted')
    status(await update(ADMIN, REQUIRED, 1), 403, 'permission-not-granted')
    status(await createCategory(ADMIN), 403, 'permission-not-granted')
    // Histórico exige work-plan.view.
    await setPermissions(OP, ['partnerships.view'])
    status(await history(OP), 403, 'permission-not-granted')
    assert.deepEqual(await events(), [])
  })

  test('UXPT01-S18 — aplicabilidade financeira por instrumento e parceria arquivada', async () => {
    // Acordo de Cooperação arquivado (fixture): somente consulta.
    await plan({ partnershipId: COOPERATION, revision: 1 })
    status(await update(OP, REQUIRED, 1, { partnershipId: COOPERATION }), 403, 'partnership-archived')
    // Fora do arquivamento, o financeiro continua "não se aplica" no AC.
    await deps.db.doc(`oscs/${ALFA}/partnerships/${COOPERATION}`).update({ administrativeStatus: 'em-execucao' })
    status(await createCategory(OP, { partnershipId: COOPERATION }), 409, 'financial-not-applicable')
    status(await createGoal(OP, { partnershipId: COOPERATION }), 201)
  })
})
