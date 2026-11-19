/**
 * DEV-02.4 — Metas e indicadores PREVISTOS no AMBIENTE CONFIÁVEL (`npm run test:server`).
 * Emuladores de Auth e Firestore; Admin SDK, código REAL de `api/` e política de PRODUÇÃO.
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp } from 'firebase-admin/firestore'
import type { ApiResponse, ServerDeps } from '../../api/_lib/permissionsService.ts'
import { getServerDeps } from '../../api/_lib/serverDeps.ts'
import { handleWorkPlanComponentsRequest } from '../../api/_lib/workPlanComponentsService.ts'
import { handleWorkPlansRequest } from '../../api/_lib/workPlansService.ts'
import { MEMBERS, OSCS, USERS, memberDocument, memberPath, oscDocument, oscPath } from '../support/organizationFixtures.ts'
import { PARTNERSHIPS, partnershipDocument, partnershipPath } from '../support/partnershipFixtures.ts'
import { PERMISSION_MEMBERS, PERMISSION_USERS } from '../support/permissionFixtures.ts'
import { goalData, indicatorData } from '../support/workPlanFixtures.ts'

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
const RUNNING = 'pAlfaColaboracao06'
const SUSPENDED = 'pAlfaFomento02xxxxx'
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
  await setPermissions(OP, ['work-plan.view', 'work-plan.edit'])
}

const setPermissions = (user: { uid: string }, permissions: string[], oscId = ALFA) => deps.db.doc(`oscs/${oscId}/members/${user.uid}`).update({ permissions })
let counter = 0
const nextRequest = () => `pedido-${++counter}-componente`
const call = (user: { uid: string }, method: 'POST' | 'PATCH', body: Record<string, unknown>) =>
  handleWorkPlansRequest({ method, authorization: `Bearer ${tokens.get(user.uid) ?? ''}`, query: new URLSearchParams(), rawBody: JSON.stringify(body) }, deps, { today: TODAY })
const informed = (value: string | number) => ({ state: 'informed', value })
const REQUIRED = { approvalDate: informed('2026-02-10'), executionStart: informed('2026-03-01'), executionEnd: informed('2028-02-28') }
const ACT = { type: 'termo-aditivo', reference: '1º Termo Aditivo', actDate: '2026-09-01', description: 'Ampliação do público atendido.', effectiveDate: '2026-10-01' }
const status = (response: ApiResponse, expected: number, reason?: string) => {
  assert.equal(response.status, expected, JSON.stringify(response))
  if (reason) assert.equal(response.body.reason ?? response.body.error, reason, JSON.stringify(response))
}
const versions = async (partnershipId = RUNNING) => (await deps.db.collection(`oscs/${ALFA}/partnerships/${partnershipId}/workPlans`).get()).docs.map((d) => d.id).sort()
const events = async () => (await deps.db.collection(`oscs/${ALFA}/workPlanEvents`).get()).docs.map((d) => d.data())

const createVersion = (user: { uid: string }, options: { partnershipId?: string; base?: string; baseRevision?: number; act?: unknown; requestId?: string; oscId?: string } = {}) =>
  call(user, 'POST', {
    oscId: options.oscId ?? ALFA,
    partnershipId: options.partnershipId ?? RUNNING,
    requestId: options.requestId ?? nextRequest(),
    action: 'create-version',
    baseWorkPlanId: options.base ?? 'original',
    baseRevision: options.baseRevision ?? 3,
    formalAct: 'act' in options ? options.act : ACT,
  })

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


const comp = (user: { uid: string }, method: 'POST' | 'PATCH', body: Record<string, unknown>) =>
  handleWorkPlanComponentsRequest({ method, authorization: `Bearer ${tokens.get(user.uid) ?? ''}`, query: new URLSearchParams(), rawBody: JSON.stringify(body) }, deps)
const addGoal = (user: { uid: string }, data: unknown, o: { workPlanId?: string; requestId?: string; partnershipId?: string; oscId?: string } = {}) =>
  comp(user, 'POST', { oscId: o.oscId ?? ALFA, partnershipId: o.partnershipId ?? RUNNING, workPlanId: o.workPlanId ?? 'original', requestId: o.requestId ?? nextRequest(), action: 'create-goal', data })
const addIndicator = (user: { uid: string }, data: unknown, o: { workPlanId?: string; requestId?: string } = {}) =>
  comp(user, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: o.workPlanId ?? 'original', requestId: o.requestId ?? nextRequest(), action: 'create-indicator', data })
const patch = (user: { uid: string }, kind: 'goal' | 'indicator', componentId: string, expectedRevision: number, data: unknown, o: { workPlanId?: string; requestId?: string } = {}) =>
  comp(user, 'PATCH', { oscId: ALFA, partnershipId: RUNNING, workPlanId: o.workPlanId ?? 'original', requestId: o.requestId ?? nextRequest(), componentKind: kind, componentId, expectedRevision, data })
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- documentos lidos do emulador para asserções
type ComponentDoc = Record<string, any>
const idOf = (r: ApiResponse) => (r.body.component as { id: string }).id
const componentsOf = async (workPlanId = 'original', collection: 'goals' | 'indicators' = 'goals') =>
  (await deps.db.collection(`oscs/${ALFA}/partnerships/${RUNNING}/workPlans/${workPlanId}/${collection}`).get()).docs.map((d) => ({ id: d.id, ...d.data() })) as Record<string, unknown>[] as ComponentDoc[]
/** Original em cadastramento com os campos obrigatórios. */
async function draftOriginal(partnershipId = RUNNING) {
  status(await call(OP, 'POST', { oscId: ALFA, partnershipId, requestId: nextRequest(), action: 'start' }), 201)
  status(await call(OP, 'PATCH', { oscId: ALFA, partnershipId, requestId: nextRequest(), expectedRevision: 1, changes: REQUIRED }), 200)
}
const finalize = (workPlanId: string, expectedRevision: number) => call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId, requestId: nextRequest(), action: 'finalize', expectedRevision, confirm: true })

describe('Cadastro de metas e indicadores (versão em cadastramento)', () => {
  test('DEV-02.4-T02/T03/T04/T07/T08/T22 — meta e indicador gravados pelo servidor, vinculados e associados à versão', async () => {
    await draftOriginal()
    const g = await addGoal(OP, goalData('Meta 01', { expectedQuantity: { state: 'informed', value: 0 } }))
    status(g, 201)
    const goalId = idOf(g)
    assert.match(goalId, /^g_[a-f0-9]{20}$/)
    const i = await addIndicator(OP, indicatorData('IND-01', [goalId]))
    status(i, 201)
    const [goal] = await componentsOf()
    assert.deepEqual([goal?.workPlanId, goal?.oscId, goal?.partnershipId, goal?.revision, goal?.createdBy, goal?.inheritedFrom], ['original', ALFA, RUNNING, 1, OP.uid, null])
    assert.deepEqual(goal?.data.expectedQuantity, { state: 'informed', value: 0 }, 'zero preservado como valor informado')
    assert.deepEqual(goal?.data.expectedResult, { state: 'not-informed' })
    const [ind] = await componentsOf('original', 'indicators')
    assert.deepEqual([ind?.data.goalIds, ind?.data.target, ind?.data.rule.numerator], [[goalId], { state: 'informed', value: 80 }, 'concluintes'])
    assert.equal(JSON.stringify(ind).match(/realiz|apurad|achieved/i), null, 'T25: nenhum valor realizado')
  })

  test('DEV-02.4-T05/T10/T11/T12 — validação, fórmula como texto, vínculos íntegros e código único', async () => {
    await draftOriginal()
    const g = idOf(await addGoal(OP, goalData('Meta 01')))
    const bad = await addGoal(OP, { ...goalData(''), nature: 'outra' })
    status(bad, 422, 'invalid-component')
    assert.deepEqual([(bad.body.fields as Record<string, string>).code, (bad.body.fields as Record<string, string>).nature], ['required', 'invalid'])
    status(await addGoal(OP, goalData('meta 01')), 422, 'invalid-component') // código duplicado
    status(await addGoal(OP, { ...goalData('Meta 09'), realizedValue: 10 }), 422, 'invalid-component') // T25
    status(await addIndicator(OP, indicatorData('IND-01', ['g_99999999999999999999'])), 422, 'invalid-component') // meta inexistente
    const hostile = await addIndicator(OP, indicatorData('IND-02', [g], { rule: { method: 'described', description: "require('child_process').exec('rm -rf /')" } }))
    status(hostile, 201) // T11: texto armazenado, jamais executado
    const ind = (await componentsOf('original', 'indicators'))[0]
    assert.equal(ind?.data.rule.description, "require('child_process').exec('rm -rf /')")
    // T12: meta com indicador ativo não pode ser descontinuada; após descontinuar o indicador, pode.
    status(await patch(OP, 'goal', g, 1, goalData('Meta 01', { status: 'discontinued' })), 422, 'invalid-component')
    status(await patch(OP, 'indicator', ind?.id, 1, indicatorData('IND-02', [g], { status: 'discontinued', rule: ind?.data.rule })), 200)
    status(await patch(OP, 'goal', g, 1, goalData('Meta 01', { status: 'discontinued' })), 200)
    status(await addIndicator(OP, indicatorData('IND-03', [g])), 422, 'invalid-component') // vínculo a meta descontinuada
    assert.equal((await componentsOf()).length, 1, 'descontinuação é lógica: nada é apagado')
    status(await comp(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'create-goal', data: goalData('Meta 05'), componentId: 'g_00000000000000000000' }), 400)
    status(await comp(OP, 'PATCH', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), componentKind: 'goal', componentId: 'i_00000000000000000000', expectedRevision: 1, data: goalData('X') }), 400)
  })

  test('DEV-02.4-T09/T14/T15 — periodicidade individual; edição concorrente; auditoria por componente', async () => {
    await draftOriginal()
    const g = idOf(await addGoal(OP, goalData('Meta 01')))
    const i1 = idOf(await addIndicator(OP, indicatorData('IND-01', [g])))
    const i2 = idOf(await addIndicator(OP, indicatorData('IND-02', [g], { periodicity: { state: 'informed', value: { kind: 'other', description: 'No 6º e no 18º mês' } } })))
    const inds = await componentsOf('original', 'indicators')
    assert.deepEqual(inds.map((x) => x.data.periodicity.value.kind).sort(), ['monthly', 'other'])
    status(await patch(OP, 'indicator', i1, 1, indicatorData('IND-01', [g], { periodicity: { state: 'informed', value: { kind: 'quarterly', description: null } } })), 200)
    status(await patch(OP, 'indicator', i1, 1, indicatorData('IND-01', [g], { target: { state: 'informed', value: 90 } })), 409, 'stale') // T14
    assert.equal((await componentsOf('original', 'indicators')).find((x) => x.id === i2)?.data.periodicity.value.kind, 'other', 'outro indicador intacto')
    const evs = (await events()).filter((e) => String(e.action).startsWith('goal-') || String(e.action).startsWith('indicator-'))
    assert.deepEqual(evs.map((e) => e.action).sort(), ['goal-created', 'indicator-created', 'indicator-created', 'indicator-updated'])
    const upd = evs.find((e) => e.action === 'indicator-updated')
    assert.deepEqual([upd?.componentId, upd?.workPlanId, upd?.periodicityChanged, upd?.fields, upd?.fromRevision, upd?.toRevision, upd?.actorUid, upd?.oscId, upd?.partnershipId], [i1, 'original', true, ['periodicity'], 1, 2, OP.uid, ALFA, RUNNING])
    assert.ok(upd?.at instanceof Timestamp)
  })

  test('DEV-02.4-T13 — reenvio idempotente e criações simultâneas não duplicam', async () => {
    await draftOriginal()
    const first = await addGoal(OP, goalData('Meta 01'), { requestId: 'meta-repetida-1' })
    status(first, 201)
    const again = await addGoal(OP, goalData('Meta 01'), { requestId: 'meta-repetida-1' })
    status(again, 200)
    assert.deepEqual([again.body.created, idOf(again)], [false, idOf(first)])
    const parallel = await Promise.all([addGoal(OP, goalData('Meta 02'), { requestId: 'meta-paralela-1' }), addGoal(OP, goalData('Meta 02'), { requestId: 'meta-paralela-1' }), addGoal(OP, goalData('Meta 02'), { requestId: 'meta-paralela-1' })])
    assert.equal(parallel.filter((r) => r.status === 201).length, 1, JSON.stringify(parallel.map((r) => r.status)))
    assert.ok(parallel.every((r) => r.status === 201 || r.status === 200))
    // Pedidos distintos com o mesmo código: um grava, o outro recebe código duplicado.
    const dup = await Promise.all([addGoal(OP, goalData('Meta 03')), addGoal(OP, goalData('Meta 03'))])
    assert.deepEqual(dup.map((r) => r.status).sort(), [201, 422])
    assert.equal((await componentsOf()).length, 3)
    assert.equal((await events()).filter((e) => e.action === 'goal-created').length, 3)
  })
})

describe('Ciclo de vida, versões e restrições', () => {
  test('DEV-02.4-T21/T23 — nova versão copia integralmente os componentes (mesmos IDs); versão anterior preservada', async () => {
    await draftOriginal()
    const g = idOf(await addGoal(OP, goalData('Meta 01')))
    const i = idOf(await addIndicator(OP, indicatorData('IND-01', [g])))
    status(await finalize('original', 2), 200)
    const originalGoals = await componentsOf()
    status(await createVersion(OP, { baseRevision: 3 }), 201)
    const copied = await componentsOf('v2')
    const copiedInd = await componentsOf('v2', 'indicators')
    assert.deepEqual(copied.map((x) => x.id), [g])
    assert.deepEqual(copiedInd.map((x) => [x.id, x.data.goalIds]), [[i, [g]]])
    assert.deepEqual(copied[0]?.data, originalGoals[0]?.data)
    assert.deepEqual([copied[0]?.workPlanId, copied[0]?.revision, copied[0]?.inheritedFrom], ['v2', 1, { workPlanId: 'original', revision: 1 }])
    assert.equal((await events()).find((e) => e.action === 'version-created')?.copiedComponents, 2)
    // Alteração na v2 não toca a original; inclusão só na v2.
    status(await patch(OP, 'goal', g, 1, goalData('Meta 01', { expectedQuantity: { state: 'informed', value: 250 } }), { workPlanId: 'v2' }), 200)
    status(await addGoal(OP, goalData('Meta 02'), { workPlanId: 'v2' }), 201)
    assert.deepEqual(await componentsOf(), originalGoals)
    assert.equal((await componentsOf('v2')).length, 2)
    // Finalizada: sem alteração comum (inclusive da original substituída).
    status(await finalize('v2', 1), 200)
    status(await patch(OP, 'goal', g, 2, goalData('Meta 01'), { workPlanId: 'v2' }), 409, 'already-finalized')
    status(await addGoal(OP, goalData('Meta 03'), { workPlanId: 'original' }), 409, 'already-finalized')
  })

  test('Bloqueio seguro — Plano finalizado SEM componentes: transcrição complementar aguarda decisão administrativa', async () => {
    await draftOriginal()
    status(await finalize('original', 2), 200)
    status(await addGoal(OP, goalData('Meta 01')), 409, 'complementary-transcription-pending')
    status(await addIndicator(OP, indicatorData('IND-01')), 409, 'complementary-transcription-pending')
    assert.equal((await componentsOf()).length, 0)
    // A correção material (DEC-PT-002) não serve para incluir componentes.
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'correct', expectedRevision: 3, changes: { goals: [goalData('Meta 01')] }, justification: 'Inclusão indevida de metas.', declaration: true }), 422)
    // Nem a funcionalidade nova cria versão formal automaticamente.
    assert.deepEqual(await versions(), ['original'])
  })

  test('DEV-02.4-T16/T20 — permissões individuais e isolamento entre OSCs', async () => {
    await draftOriginal()
    for (const [user, permissions] of [[DELEGATE, ['work-plan.view']], [DELEGATE, ['work-plan.view', 'work-plan.finalize']], [ADMIN, []]] as const) {
      await setPermissions(user, [...permissions])
      status(await addGoal(user, goalData('Meta 01')), 403, 'permission-not-granted')
    }
    await setPermissions(DELEGATE, ['work-plan.edit'])
    status(await addGoal(DELEGATE, goalData('Meta 01')), 201)
    status(await addGoal(OP, goalData('Meta 02'), { oscId: GAMA }), 403, 'no-membership')
    status(await addGoal(OP, goalData('Meta 02'), { partnershipId: 'pGamaColaboracao09x' }), 404, 'not-found')
    status(await addGoal(OP, goalData('Meta 02'), { workPlanId: 'v7' }), 404, 'not-found')
    status(await comp(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: '../original', requestId: nextRequest(), action: 'create-goal', data: goalData('Meta 02') }), 400)
    status(await handleWorkPlanComponentsRequest({ method: 'POST', authorization: undefined, query: new URLSearchParams(), rawBody: '{}' }, deps), 401)
    assert.equal((await componentsOf()).length, 1)
  })

  test('DEV-02.4-T17/T18/T19 — suspensão comercial e arquivada bloqueiam; parceria suspensa admite', async () => {
    await draftOriginal(SUSPENDED)
    status(await addGoal(OP, goalData('Meta 01'), { partnershipId: SUSPENDED }), 201)
    await draftOriginal()
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}`).update({ administrativeStatus: 'arquivada' })
    status(await addGoal(OP, goalData('Meta 01')), 403, 'partnership-archived')
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}`).update({ administrativeStatus: 'em-execucao' })
    await deps.db.doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'suspended' })
    status(await addGoal(OP, goalData('Meta 01')), 403, 'commercial-suspension')
    assert.equal((await componentsOf()).length, 0)
  })
})

after(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)))
})
