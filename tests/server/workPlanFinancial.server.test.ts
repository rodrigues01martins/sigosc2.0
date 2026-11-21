/**
 * DEV-02.5 — Planejamento financeiro PREVISTO no AMBIENTE CONFIÁVEL (`npm run test:server`).
 * Emuladores de Auth e Firestore; Admin SDK, código REAL de `api/` e política de PRODUÇÃO.
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp } from 'firebase-admin/firestore'
import type { ApiResponse, ServerDeps } from '../../api/_lib/permissionsService.ts'
import { getServerDeps } from '../../api/_lib/serverDeps.ts'
import { handleWorkPlanFinancialRequest } from '../../api/_lib/workPlanFinancialService.ts'
import { handleWorkPlansRequest } from '../../api/_lib/workPlansService.ts'
import { MEMBERS, OSCS, USERS, memberDocument, memberPath, oscDocument, oscPath } from '../support/organizationFixtures.ts'
import { PARTNERSHIPS, partnershipDocument, partnershipPath } from '../support/partnershipFixtures.ts'
import { PERMISSION_MEMBERS, PERMISSION_USERS } from '../support/permissionFixtures.ts'
import { categoryData, componentDocument, goalData, indicatorData, itemData } from '../support/workPlanFixtures.ts'
import { REVIEW_NONE, REVIEW_TRANSCRIBED, reviewed } from '../support/reviewFixtures.ts'
import { componentsToken } from '../../src/domain/workPlanComponents.ts'

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
const nextRequest = () => `pedido-${++counter}-financeiro`
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


// eslint-disable-next-line @typescript-eslint/no-explicit-any -- documentos lidos do emulador para asserções
type ComponentDoc = Record<string, any>
const componentsOf = async (workPlanId = 'original', collection: 'goals' | 'indicators' = 'goals') =>
  (await deps.db.collection(`oscs/${ALFA}/partnerships/${RUNNING}/workPlans/${workPlanId}/${collection}`).get()).docs.map((d) => ({ id: d.id, ...d.data() })) as Record<string, unknown>[] as ComponentDoc[]
/** Original em cadastramento com os campos obrigatórios. */
async function draftOriginal(partnershipId = RUNNING) {
  status(await call(OP, 'POST', { oscId: ALFA, partnershipId, requestId: nextRequest(), action: 'start' }), 201)
  status(await call(OP, 'PATCH', { oscId: ALFA, partnershipId, requestId: nextRequest(), expectedRevision: 1, changes: REQUIRED }), 200)
}
/** Finalização com a conferência coerente com os componentes REAIS da versão (DEC-PT-007). */
const tokenOf = async (workPlanId: string) =>
  componentsToken([...(await componentsOf(workPlanId)).map((c) => ({ kind: 'goal' as const, id: c.id, revision: c.revision })), ...(await componentsOf(workPlanId, 'indicators')).map((c) => ({ kind: 'indicator' as const, id: c.id, revision: c.revision }))])
async function finalize(workPlanId: string, expectedRevision: number, review: unknown = null) {
  const token = await tokenOf(workPlanId)
  const auto = review ?? (token.startsWith('0-') ? REVIEW_NONE : REVIEW_TRANSCRIBED)
  return call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId, requestId: nextRequest(), action: 'finalize', expectedRevision, confirm: true, ...reviewed(auto, token) })
}


const fin = (user: { uid: string }, method: 'POST' | 'PATCH', body: Record<string, unknown>) =>
  handleWorkPlanFinancialRequest({ method, authorization: `Bearer ${tokens.get(user.uid) ?? ''}`, query: new URLSearchParams(), rawBody: JSON.stringify(body) }, deps)
type Opt = { workPlanId?: string; requestId?: string; partnershipId?: string; oscId?: string }
const addCategory = (user: { uid: string }, data: unknown, o: Opt = {}) =>
  fin(user, 'POST', { oscId: o.oscId ?? ALFA, partnershipId: o.partnershipId ?? RUNNING, workPlanId: o.workPlanId ?? 'original', requestId: o.requestId ?? nextRequest(), action: 'create-category', data })
const addItem = (user: { uid: string }, data: unknown, o: Opt = {}) =>
  fin(user, 'POST', { oscId: o.oscId ?? ALFA, partnershipId: o.partnershipId ?? RUNNING, workPlanId: o.workPlanId ?? 'original', requestId: o.requestId ?? nextRequest(), action: 'create-item', data })
const patchFin = (user: { uid: string }, kind: 'financial-category' | 'financial-item', id: string, expectedRevision: number, data: unknown, o: Opt = {}) =>
  fin(user, 'PATCH', { oscId: ALFA, partnershipId: o.partnershipId ?? RUNNING, workPlanId: o.workPlanId ?? 'original', requestId: o.requestId ?? nextRequest(), kind, id, expectedRevision, data })
const recId = (r: ApiResponse) => (r.body.record as { id: string }).id
const finDocs = async (workPlanId = 'original', collection: 'financialCategories' | 'financialItems' = 'financialItems', partnershipId = RUNNING) =>
  (await deps.db.collection(`oscs/${ALFA}/partnerships/${partnershipId}/workPlans/${workPlanId}/${collection}`).get()).docs.map((d) => ({ id: d.id, ...d.data() })) as ComponentDoc[]
const COOPERATION = 'pAlfaCooperacao01xx'

describe('Cadastro do planejamento financeiro (versão em cadastramento)', () => {
  test('DEV-02.5-T04/T05/T07/T08/T09/T11/T15 — categoria e itens gravados em centavos inteiros, com auditoria', async () => {
    await draftOriginal()
    const c = await addCategory(OP, categoryData('C1', 'Recursos Humanos', 'recursos-humanos'))
    status(c, 201)
    const cat = recId(c)
    assert.match(cat, /^c_[a-f0-9]{20}$/)
    const global = await addItem(OP, itemData('F1', cat, 32_000_000))
    status(global, 201)
    const detailed = await addItem(OP, itemData('F2', cat, 1_800_000, { quantity: { state: 'informed', value: '12' }, unit: { state: 'informed', value: 'meses' }, unitValue: { state: 'informed', cents: 150_000 }, calculationMemory: { state: 'informed', value: '12 meses × R$ 1.500,00' } }))
    status(detailed, 201)
    const items = await finDocs()
    const f2 = items.find((i) => i.data.code === 'F2')
    assert.deepEqual([f2?.data.plannedValue, f2?.data.quantity, f2?.data.unitValue, f2?.workPlanId, f2?.revision, f2?.createdBy], [{ state: 'informed', cents: 1_800_000 }, { state: 'informed', value: '12' }, { state: 'informed', cents: 150_000 }, 'original', 1, OP.uid])
    status(await patchFin(OP, 'financial-item', recId(global), 1, itemData('F1', cat, 33_000_050)), 200)
    const ev = (await events()).find((e) => e.action === 'financial-item-updated')
    assert.deepEqual([ev?.recordId, ev?.fields, ev?.plannedValueChange, ev?.toRevision, ev?.workPlanId, ev?.actorUid], [recId(global), ['plannedValue'], { before: { state: 'informed', cents: 32_000_000 }, after: { state: 'informed', cents: 33_000_050 } }, 2, 'original', OP.uid])
    assert.ok(ev?.at instanceof Timestamp)
    assert.deepEqual((await events()).filter((e) => String(e.action).startsWith('financial-')).map((e) => e.action).sort(), ['financial-category-created', 'financial-item-created', 'financial-item-created', 'financial-item-updated'])
  })

  test('DEV-02.5-T06/T03/T28 — validação, código único, integridade categoria–item; sem campos de realizado', async () => {
    await draftOriginal()
    const cat = recId(await addCategory(OP, categoryData('C1', 'Material de Consumo', 'material-consumo')))
    status(await addCategory(OP, categoryData('c1', 'Outra')), 422, 'invalid-financial') // código duplicado
    status(await addItem(OP, itemData('F1', 'c_99999999999999999999', 100)), 422, 'invalid-financial')
    status(await addItem(OP, { ...itemData('F1', cat, 100), description: '' }), 422, 'invalid-financial')
    status(await addItem(OP, { ...itemData('F1', cat, 100), spentCents: 50 }), 422, 'invalid-financial')
    status(await addItem(OP, itemData('F1', cat, null, { plannedValue: { state: 'informed', cents: 10.5 } })), 422, 'invalid-financial')
    const zero = await addItem(OP, itemData('F1', cat, 0))
    status(zero, 201)
    status(await addItem(OP, itemData('F2', cat, null)), 201) // valor não informado permitido no cadastro
    assert.deepEqual((await finDocs()).map((i) => i.data.plannedValue).sort((a, b) => a.state.localeCompare(b.state)), [{ state: 'informed', cents: 0 }, { state: 'not-informed' }])
    status(await patchFin(OP, 'financial-category', cat, 1, categoryData('C1', 'Material de Consumo', 'material-consumo', { status: 'discontinued' })), 422, 'invalid-financial')
    assert.equal((await finDocs('original', 'financialCategories')).length, 1, 'descontinuação recusada; nada apagado')
  })

  test('DEV-02.5-T13/T14 — reenvio idempotente, criações simultâneas e edição concorrente', async () => {
    await draftOriginal()
    const cat = recId(await addCategory(OP, categoryData('C1', 'Recursos Humanos')))
    const first = await addItem(OP, itemData('F1', cat, 100), { requestId: 'item-repetido-1' })
    status(first, 201)
    const again = await addItem(OP, itemData('F1', cat, 100), { requestId: 'item-repetido-1' })
    status(again, 200)
    assert.deepEqual([again.body.created, recId(again)], [false, recId(first)])
    const par = await Promise.all([1, 2, 3].map(() => addItem(OP, itemData('F2', cat, 200), { requestId: 'item-paralelo-1' })))
    assert.equal(par.filter((r) => r.status === 201).length, 1, JSON.stringify(par.map((r) => r.status)))
    assert.equal((await finDocs()).length, 2)
    assert.equal((await events()).filter((e) => e.action === 'financial-item-created').length, 2, 'sem eventos duplicados')
    status(await patchFin(OP, 'financial-item', recId(first), 1, itemData('F1', cat, 300)), 200)
    status(await patchFin(OP, 'financial-item', recId(first), 1, itemData('F1', cat, 400)), 409, 'stale')
    assert.deepEqual((await finDocs()).find((i) => i.id === recId(first))?.data.plannedValue, { state: 'informed', cents: 300 })
  })
})

describe('Aplicabilidade, ciclo de vida e restrições', () => {
  test('DEV-02.5-T02 — Acordo de Cooperação: planejamento financeiro não se aplica (sem repasse zero)', async () => {
    // Acordo de Cooperação em execução (o fixture é arquivado; aqui só o instrumento importa).
    await deps.db.doc(`oscs/${ALFA}/partnerships/${COOPERATION}`).update({ administrativeStatus: 'em-execucao' })
    await draftOriginal(COOPERATION)
    status(await addCategory(OP, categoryData('C1', 'Recursos Humanos'), { partnershipId: COOPERATION }), 409, 'financial-not-applicable')
    assert.equal((await finDocs('original', 'financialCategories', COOPERATION)).length, 0)
  })

  test('DEV-02.5-T16/T20 — permissões individuais e isolamento entre OSCs', async () => {
    await draftOriginal()
    for (const [user, permissions] of [[DELEGATE, ['work-plan.view']], [DELEGATE, ['work-plan.view', 'financial.view']], [DELEGATE, ['work-plan.view', 'work-plan.finalize']], [ADMIN, []]] as const) {
      await setPermissions(user, [...permissions])
      status(await addCategory(user, categoryData('C1', 'X')), 403, 'permission-not-granted')
    }
    status(await addCategory(OP, categoryData('C1', 'X'), { oscId: GAMA }), 403, 'no-membership')
    status(await addCategory(OP, categoryData('C1', 'X'), { partnershipId: 'pGamaColaboracao09x' }), 404, 'not-found')
    status(await fin(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'create-item', data: itemData('F1', 'c_00000000000000000001', 1), id: 'f_00000000000000000000' }), 400)
    status(await fin(OP, 'PATCH', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), kind: 'financial-category', id: 'f_00000000000000000000', expectedRevision: 1, data: {} }), 400)
    status(await handleWorkPlanFinancialRequest({ method: 'POST', authorization: undefined, query: new URLSearchParams(), rawBody: '{}' }, deps), 401)
  })

  test('DEV-02.5-T17/T18/T19 — suspensão comercial e arquivada bloqueiam; parceria suspensa admite', async () => {
    await draftOriginal(SUSPENDED)
    status(await addCategory(OP, categoryData('C1', 'X'), { partnershipId: SUSPENDED }), 201)
    await draftOriginal()
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}`).update({ administrativeStatus: 'arquivada' })
    status(await addCategory(OP, categoryData('C1', 'X')), 403, 'partnership-archived')
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}`).update({ administrativeStatus: 'em-execucao' })
    await deps.db.doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'suspended' })
    status(await addCategory(OP, categoryData('C1', 'X')), 403, 'commercial-suspension')
  })

  test('DEV-02.5-T27/T26 — Plano finalizado protegido (inclusive durante a incorporação DEC-PT-006); finalização inalterada', async () => {
    await draftOriginal()
    const cat = recId(await addCategory(OP, categoryData('C1', 'Recursos Humanos')))
    const f1 = recId(await addItem(OP, itemData('F1', cat, null))) // incompleto é salvo no cadastro
    status(await finalize('original', 2), 422, 'finalization-pending') // DEC-PT-013 (DEV-02.5-C01): item ativo exige valor
    status(await patchFin(OP, 'financial-item', f1, 1, itemData('F1', cat, 100)), 200)
    status(await finalize('original', 2), 200) // T26: contrato review/componentsToken/declaration preservado
    status(await addItem(OP, itemData('F2', cat, 100)), 409, 'already-finalized')
    status(await patchFin(OP, 'financial-category', cat, 1, categoryData('C1', 'Outro nome')), 409, 'already-finalized')
    await seed()
    await draftOriginal()
    status(await finalize('original', 2), 200)
    status(await addCategory(OP, categoryData('C1', 'X')), 409, 'financial-transcription-pending')
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'open-transcription', declaration: true }), 201)
    status(await addCategory(OP, categoryData('C1', 'X')), 409, 'financial-transcription-pending') // DEC-PT-006 não se estende ao financeiro
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'correct', expectedRevision: 3, changes: { financialItems: [itemData('F1', cat, 1)] }, justification: 'Inclusão indevida de itens financeiros.', declaration: true }), 422)
    assert.deepEqual(await versions(), ['original'])
  })
})

describe('Versionamento do planejamento financeiro', () => {
  test('DEV-02.5-T21/T22/T23 — cópia integral com IDs lógicos; versão anterior preservada; alteração só na nova', async () => {
    await draftOriginal()
    const cat = recId(await addCategory(OP, categoryData('C1', 'Recursos Humanos', 'recursos-humanos')))
    const f1 = recId(await addItem(OP, itemData('F1', cat, 32_000_000)))
    status(await finalize('original', 2), 200)
    const origItems = await finDocs()
    status(await createVersion(OP, { baseRevision: 3 }), 201)
    const copied = await finDocs('v2')
    assert.deepEqual(copied.map((i) => [i.id, i.data.categoryId, i.workPlanId, i.revision, i.inheritedFrom]), [[f1, cat, 'v2', 1, { workPlanId: 'original', revision: 1 }]])
    assert.deepEqual(copied[0]?.data, origItems[0]?.data)
    assert.deepEqual((await finDocs('v2', 'financialCategories')).map((c) => c.id), [cat])
    status(await patchFin(OP, 'financial-item', f1, 1, itemData('F1', cat, 35_000_000), { workPlanId: 'v2' }), 200)
    status(await addItem(OP, itemData('F2', cat, 1_000), { workPlanId: 'v2' }), 201)
    assert.deepEqual(await finDocs(), origItems, 'versão anterior intacta')
  })

  test('DEV-02.5-T29 — capacidade: cópia transacional completa nos limites técnicos (100 metas, 200 indicadores, 30 categorias, 150 itens)', async () => {
    await draftOriginal()
    const base = `oscs/${ALFA}/partnerships/${RUNNING}/workPlans/original`
    const p = { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original' }
    const hex = (n: number) => n.toString(16).padStart(20, '0')
    const writes: [string, Record<string, unknown>][] = []
    for (let n = 0; n < 100; n++) writes.push([`${base}/goals/g_${hex(n)}`, componentDocument('goal', { id: `g_${hex(n)}`, data: goalData(`Meta ${n}`) }, p)])
    for (let n = 0; n < 200; n++) writes.push([`${base}/indicators/i_${hex(n)}`, componentDocument('indicator', { id: `i_${hex(n)}`, data: indicatorData(`IND-${n}`) }, p)])
    for (let n = 0; n < 30; n++) writes.push([`${base}/financialCategories/c_${hex(n)}`, componentDocument('financial-category', { id: `c_${hex(n)}`, data: categoryData(`C${n}`, `Categoria ${n}`) }, p)])
    for (let n = 0; n < 150; n++) writes.push([`${base}/financialItems/f_${hex(n)}`, componentDocument('financial-item', { id: `f_${hex(n)}`, data: itemData(`F${n}`, `c_${hex(n % 30)}`, n * 100) }, p)])
    for (let i = 0; i < writes.length; i += 400) {
      const batch = deps.db.batch()
      for (const [path, doc] of writes.slice(i, i + 400)) batch.set(deps.db.doc(path), doc)
      await batch.commit()
    }
    status(await addCategory(OP, categoryData('C99', 'Excedente')), 422, 'invalid-financial') // 31ª categoria
    status(await finalize('original', 2), 200)
    status(await createVersion(OP, { baseRevision: 3 }), 201)
    assert.deepEqual([(await componentsOf('v2')).length, (await componentsOf('v2', 'indicators')).length, (await finDocs('v2', 'financialCategories')).length, (await finDocs('v2')).length], [100, 200, 30, 150])
    assert.equal((await events()).find((e) => e.action === 'version-created')?.copiedComponents, 480)
  })
})

after(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)))
})
