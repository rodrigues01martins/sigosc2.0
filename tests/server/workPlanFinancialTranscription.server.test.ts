/**
 * DEV-02.5-C01 — Incorporação financeira, valor previsto obrigatório e fontes no AMBIENTE CONFIÁVEL (`npm run test:server`).
 * Emuladores de Auth e Firestore; Admin SDK, código REAL de `api/` e política de PRODUÇÃO.
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { ApiResponse, ServerDeps } from '../../api/_lib/permissionsService.ts'
import { getServerDeps } from '../../api/_lib/serverDeps.ts'
import { handleWorkPlanComponentsRequest } from '../../api/_lib/workPlanComponentsService.ts'
import { handleWorkPlanFinancialRequest } from '../../api/_lib/workPlanFinancialService.ts'
import { financialToken } from '../../src/domain/workPlanFinancial.ts'
import { handleWorkPlansRequest } from '../../api/_lib/workPlansService.ts'
import { MEMBERS, OSCS, USERS, memberDocument, memberPath, oscDocument, oscPath } from '../support/organizationFixtures.ts'
import { PARTNERSHIPS, partnershipDocument, partnershipPath } from '../support/partnershipFixtures.ts'
import { PERMISSION_MEMBERS, PERMISSION_USERS } from '../support/permissionFixtures.ts'
import { categoryData, goalData, itemData } from '../support/workPlanFixtures.ts'
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
const nextRequest = () => `pedido-${++counter}-fin-c01`
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


const fTrans = (workPlanId: string, action: 'open-financial-transcription' | 'close-financial-transcription', extra: Record<string, unknown> = {}, user: { uid: string } = OP, requestId = nextRequest(), partnershipId = RUNNING) =>
  call(user, 'POST', { oscId: ALFA, partnershipId, workPlanId, requestId, action, ...(action === 'open-financial-transcription' ? { declaration: true } : {}), ...extra })
const tokenFin = async (workPlanId = 'original', partnershipId = RUNNING) => {
  const cats = (await finDocs(workPlanId, 'financialCategories', partnershipId)).map((c) => ({ id: c.id, revision: c.revision }))
  const items = (await finDocs(workPlanId, 'financialItems', partnershipId)).map((i) => ({ id: i.id, revision: i.revision, data: { categoryId: i.data.categoryId } }))
  return financialToken(cats, items)
}
const closeFin = async (extra: Record<string, unknown> = {}, requestId = nextRequest()) =>
  fTrans('original', 'close-financial-transcription', { expectedTranscriptionRevision: 1, financialToken: await tokenFin(), declaration: true, ...extra }, OP, requestId)
const planDoc = async (id = 'original', partnershipId = RUNNING) => (await deps.db.doc(`oscs/${ALFA}/partnerships/${partnershipId}/workPlans/${id}`).get()).data() as ComponentDoc
async function finalizedEmpty(partnershipId = RUNNING) {
  await draftOriginal(partnershipId)
  status(await call(OP, 'POST', { oscId: ALFA, partnershipId, workPlanId: 'original', requestId: nextRequest(), action: 'finalize', expectedRevision: 2, confirm: true, ...reviewed() }), 200)
}
const comp = (body: Record<string, unknown>) => handleWorkPlanComponentsRequest({ method: 'POST', authorization: `Bearer ${tokens.get(OP.uid) ?? ''}`, query: new URLSearchParams(), rawBody: JSON.stringify(body) }, deps)

describe('DEC-PT-011 — incorporação financeira complementar', () => {
  test('C01-T01/T03/T09/T10/T11/T13/T14/T15/T16/T17/T18 — abrir, transcrever, encerrar; finalização original intocada', async () => {
    await finalizedEmpty()
    const before = await planDoc()
    status(await addCategory(OP, categoryData('C1', 'Pessoal')), 409, 'financial-transcription-pending')
    status(await fTrans('original', 'open-financial-transcription', { declaration: false }), 422, 'declaration-required') // T03
    status(await fTrans('original', 'open-financial-transcription', {}, OP, 'abrir-financeiro-1'), 201) // T01
    const t = (await planDoc()).financialTranscription
    assert.deepEqual([t.status, t.revision, t.openedBy, t.openRequestId, t.workPlanId, t.rule, t.openDeclaration.accepted, t.openDeclaration.automatedVerification], ['open', 1, OP.uid, 'abrir-financeiro-1', 'original', 'DEC-PT-011', true, false])
    assert.ok(t.openedAt instanceof Timestamp)
    const cat = recId(await addCategory(OP, categoryData('C1', 'Pessoal'))) // T09
    const item = recId(await addItem(OP, itemData('F1', cat, null))) // T10 + incompleto salvo (T11)
    status(await closeFin({ expectedTranscriptionRevision: 2 }), 409, 'stale') // T14
    status(await closeFin({ financialToken: '1.1-00000000' }), 409, 'financial-changed')
    const pending = await closeFin()
    status(pending, 422, 'review-pending') // T15
    assert.match((pending.body.pending as string[]).join(' '), /Item financeiro F1: valor previsto não informado/)
    status(await patchFin(OP, 'financial-item', item, 1, itemData('F1', cat, 0)), 200) // zero informado
    status(await closeFin({ declaration: false }), 422, 'declaration-required')
    status(await closeFin({}, 'encerrar-financeiro-1'), 200) // T16
    const after = await planDoc()
    assert.deepEqual([after.financialTranscription.status, after.financialTranscription.revision, after.financialTranscription.closedBy, after.financialTranscription.summary], ['closed', 2, OP.uid, { categories: 1, items: 1, activeItems: 1, plannedCents: 0 }])
    for (const key of ['finalizedAt', 'finalizedBy', 'finalizationRequestId', 'revision', 'values', 'origin', 'registrationStatus', 'componentReview', 'activation', 'complementaryTranscription']) assert.deepEqual(after[key], before[key], key) // T13
    status(await addItem(OP, itemData('F2', cat, 100)), 409, 'financial-transcription-closed') // T17
    status(await patchFin(OP, 'financial-item', item, 2, itemData('F1', cat, 5)), 409, 'financial-transcription-closed')
    status(await fTrans('original', 'open-financial-transcription'), 409, 'financial-transcription-closed') // T18
    assert.deepEqual(await versions(), ['original'])
    const evs = await events()
    const recs = evs.filter((e) => e.action === 'financial-category-created' || String(e.action).startsWith('financial-item-'))
    assert.ok(recs.length === 3 && recs.every((e) => e.procedure === 'financial-transcription'))
    const opened = evs.find((e) => e.action === 'financial-transcription-opened')
    const closed = evs.find((e) => e.action === 'financial-transcription-closed')
    assert.deepEqual([opened?.requestId, opened?.rule, opened?.procedure, closed?.requestId, closed?.summary.items, closed?.transcriptionRevision], ['abrir-financeiro-1', 'DEC-PT-011', 'financial-transcription', 'encerrar-financeiro-1', 1, 2])
    assert.equal(evs.filter((e) => e.action === 'finalize').length, 1, 'evento de finalização original preservado')
  })

  test('C01-T12 e concorrência — aberturas simultâneas, reenvios e encerramento duplicado', async () => {
    await finalizedEmpty()
    await setPermissions(DELEGATE, ['work-plan.edit'])
    const par = await Promise.all([1, 2, 3, 4, 5].map((n) => fTrans('original', 'open-financial-transcription', {}, n % 2 ? OP : DELEGATE, `abrir-paralelo-${n}`)))
    assert.equal(par.filter((r) => r.status === 201).length, 1, JSON.stringify(par.map((r) => r.status)))
    assert.ok(par.every((r) => r.status === 201 || (r.status === 409 && r.body.reason === 'financial-transcription-already-open')))
    const winner = (await planDoc()).financialTranscription.openRequestId as string
    const owner = (await planDoc()).financialTranscription.openedBy === OP.uid ? OP : DELEGATE
    const again = await fTrans('original', 'open-financial-transcription', {}, owner, winner)
    status(again, 200)
    assert.equal(again.body.opened, false)
    const cat = recId(await addCategory(OP, categoryData('C1', 'Pessoal')))
    status(await addItem(OP, itemData('F1', cat, 1_000)), 201)
    const token = await tokenFin()
    const closes = await Promise.all([1, 2, 3].map(() => fTrans('original', 'close-financial-transcription', { expectedTranscriptionRevision: 1, financialToken: token, declaration: true }, OP, 'encerrar-duplicado-1')))
    assert.ok(closes.every((r) => r.status === 200), JSON.stringify(closes.map((r) => r.status)))
    assert.equal(closes.filter((r) => r.body.closed === true).length, 1)
    const evs = await events()
    assert.deepEqual([evs.filter((e) => e.action === 'financial-transcription-opened').length, evs.filter((e) => e.action === 'financial-transcription-closed').length], [1, 1])
  })

  test('C01-T04/T05/T06/T07/T08/T02/T19 — elegibilidade, permissões, restrições e bloqueio de nova versão', async () => {
    await draftOriginal()
    status(await fTrans('original', 'open-financial-transcription'), 409, 'not-finalized') // cadastramento regular
    const cat = recId(await addCategory(OP, categoryData('C1', 'Pessoal')))
    status(await finalize('original', 2), 200)
    status(await fTrans('original', 'open-financial-transcription'), 409, 'financial-exists') // T05: só categoria já basta
    assert.ok(cat)
    await seed()
    await finalizedEmpty()
    status(await createVersion(OP, { baseRevision: 3 }), 201)
    status(await fTrans('original', 'open-financial-transcription'), 409, 'pending-version-exists')
    status(await finalize('v2', 1), 200)
    status(await fTrans('original', 'open-financial-transcription'), 409, 'financial-transcription-not-current') // T04
    status(await fTrans('v2', 'open-financial-transcription'), 201)
    status(await createVersion(OP, { base: 'v2', baseRevision: 2 }), 409, 'financial-transcription-open') // T19
    assert.deepEqual(await versions(), ['original', 'v2'])
    // T06: Acordo de Cooperação (em execução, finalizado) não admite incorporação financeira.
    await deps.db.doc(`oscs/${ALFA}/partnerships/${COOPERATION}`).update({ administrativeStatus: 'em-execucao' })
    await finalizedEmpty(COOPERATION)
    status(await fTrans('original', 'open-financial-transcription', {}, OP, nextRequest(), COOPERATION), 409, 'financial-not-applicable')
    await seed()
    await finalizedEmpty()
    for (const [user, permissions] of [[DELEGATE, ['work-plan.view']], [DELEGATE, ['work-plan.view', 'financial.view']], [DELEGATE, ['work-plan.view', 'work-plan.finalize']], [ADMIN, []]] as const) {
      await setPermissions(user, [...permissions])
      status(await fTrans('original', 'open-financial-transcription', {}, user), 403, 'permission-not-granted') // T02
    }
    status(await call(OP, 'POST', { oscId: GAMA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'open-financial-transcription', declaration: true }), 403, 'no-membership')
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'open-financial-transcription', declaration: true, allowFinalized: true }), 400)
    status(await fin(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'create-category', data: categoryData('C1', 'X'), mode: 'transcription' }), 400)
    status(await addCategory(OP, categoryData('C1', 'X')), 409, 'financial-transcription-pending') // sem abertura, nada é gravado
    await deps.db.doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'suspended' })
    status(await fTrans('original', 'open-financial-transcription'), 403, 'commercial-suspension') // T08
    await deps.db.doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'active' })
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}`).update({ administrativeStatus: 'arquivada' })
    status(await fTrans('original', 'open-financial-transcription'), 403, 'partnership-archived') // T07
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}`).update({ administrativeStatus: 'suspensa' })
    status(await fTrans('original', 'open-financial-transcription'), 201) // suspensão administrativa não bloqueia
  })

  test('C01-T20 — independência entre a incorporação financeira e a de metas e indicadores', async () => {
    await finalizedEmpty()
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'open-transcription', declaration: true }), 201)
    status(await addCategory(OP, categoryData('C1', 'X')), 409, 'financial-transcription-pending') // metas não habilitam o financeiro
    status(await fTrans('original', 'open-financial-transcription'), 201)
    const cat = recId(await addCategory(OP, categoryData('C1', 'Pessoal')))
    status(await addItem(OP, itemData('F1', cat, 100)), 201)
    status(await closeFin(), 200)
    const doc = await planDoc()
    assert.deepEqual([doc.financialTranscription.status, doc.complementaryTranscription.status], ['closed', 'open'], 'encerrar um não encerra o outro')
    status(await comp({ oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'create-goal', data: goalData('Meta 01') }), 201) // metas seguem abertas
    status(await createVersion(OP, { baseRevision: 3 }), 409, 'transcription-open')
    await seed()
    await finalizedEmpty()
    status(await fTrans('original', 'open-financial-transcription'), 201)
    status(await comp({ oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'create-goal', data: goalData('Meta 01') }), 409, 'complementary-transcription-pending') // o financeiro não habilita metas
  })
})

describe('DEC-PT-012/013 — finalização regular', () => {
  test('C01-T21/T22/T23/T24/T25/T26 — valor previsto obrigatório nos ativos; zero aceito; sem declaração financeira', async () => {
    await draftOriginal()
    const cat = recId(await addCategory(OP, categoryData('C1', 'Pessoal')))
    const f1 = recId(await addItem(OP, itemData('F1', cat, null))) // T23: incompleto salvo
    status(await addItem(OP, itemData('F2', cat, 0)), 201)
    status(await addItem(OP, itemData('F3', cat, null, { status: 'discontinued' })), 201)
    const before = await planDoc()
    const pending = await finalize('original', 2)
    status(pending, 422, 'finalization-pending') // T24
    assert.deepEqual((pending.body.pending as string[]).filter((p) => p.startsWith('Item financeiro')), ['Item financeiro F1: valor previsto não informado (obrigatório para itens ativos; zero informado é aceito).'])
    assert.deepEqual(await planDoc(), before, 'nada gravado na recusa')
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'finalize', expectedRevision: 2, confirm: true, ...reviewed(), financialDeclaration: true }), 400) // T21: nenhum campo financeiro novo
    status(await patchFin(OP, 'financial-item', f1, 1, itemData('F1', cat, 250_000)), 200)
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'finalize', expectedRevision: 2, confirm: true }), 400) // T22: conferência de metas continua obrigatória
    status(await finalize('original', 2), 200) // T21/T25/T26
  })

  test('C01-T27 — sem retroatividade: versão já finalizada com item sem valor é preservada; a nova versão exige o valor', async () => {
    await draftOriginal()
    const cat = recId(await addCategory(OP, categoryData('C1', 'Pessoal')))
    const item = recId(await addItem(OP, itemData('F1', cat, 100)))
    status(await finalize('original', 2), 200)
    // Simula registro histórico finalizado antes da DEC-PT-013 (item ativo sem valor).
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}/workPlans/original/financialItems/${item}`).update({ 'data.plannedValue': { state: 'not-informed' } })
    const legacy = await planDoc()
    status(await createVersion(OP, { baseRevision: 3 }), 201)
    assert.deepEqual(await planDoc(), legacy, 'finalização histórica não é invalidada nem alterada')
    assert.deepEqual((await finDocs('v2'))[0]?.data.plannedValue, { state: 'not-informed' }, 'cópia fiel, sem valor presumido')
    status(await finalize('v2', 1), 422, 'finalization-pending')
    status(await patchFin(OP, 'financial-item', item, 1, itemData('F1', cat, 100), { workPlanId: 'v2' }), 200)
    status(await finalize('v2', 1), 200)
  })
})

describe('DEC-PT-014/015/016/017 — cálculos, categorias e fontes', () => {
  test('C01-T28/T29/T30/T31/T32/T33/T34 — divergência e fração não bloqueiam; categoria própria; fontes', async () => {
    await draftOriginal()
    const own = recId(await addCategory(OP, categoryData('C1', 'Pessoal do projeto', null))) // T31
    const ref = recId(await addCategory(OP, categoryData('C2', 'Outras Despesas', 'outras-despesas'))) // T32
    status(await addItem(OP, itemData('F1', own, 1_700_000, { quantity: { state: 'informed', value: '12' }, unitValue: { state: 'informed', cents: 150_000 } })), 201) // T28: divergente salvo
    status(await addItem(OP, itemData('F2', ref, 833, { quantity: { state: 'informed', value: '2.5' }, unitValue: { state: 'informed', cents: 333 } })), 201) // T30: fração de centavo
    status(await addItem(OP, itemData('F3', ref, 100, { fundingSource: 'other' })), 422, 'invalid-financial') // T33
    status(await addItem(OP, itemData('F3', ref, 100, { fundingSource: 'other', fundingSourceDescription: 'Doação privada' })), 201)
    status(await addItem(OP, itemData('F4', ref, 100)), 201) // T34: fonte não informada
    const items = await finDocs()
    assert.deepEqual(items.find((i) => i.data.code === 'F2')?.data.plannedValue, { state: 'informed', cents: 833 }, 'valor declarado preservado, sem arredondamento automático')
    assert.deepEqual(items.find((i) => i.data.code === 'F4')?.data.fundingSource, null)
    assert.deepEqual((await finDocs('original', 'financialCategories')).find((c) => c.id === own)?.data.standardCategory, null, 'sem reclassificação automática')
    status(await finalize('original', 2), 200) // T28/T30: alertas não bloqueiam
    // Auditoria da fonte (antes/depois) na nova versão.
    status(await createVersion(OP, { baseRevision: 3 }), 201)
    const f3 = items.find((i) => i.data.code === 'F3') as ComponentDoc
    status(await patchFin(OP, 'financial-item', f3.id, 1, itemData('F3', ref, 100, { fundingSource: 'counterpart' }), { workPlanId: 'v2' }), 200)
    const ev = (await events()).filter((e) => e.action === 'financial-item-updated').pop()
    assert.deepEqual(ev?.fundingSourceChange, { before: { source: 'other', description: 'Doação privada' }, after: { source: 'counterpart', description: null } })
  })

  test('Registro anterior: "Outra fonte" sem descrição é lido e copiado sem conversão; nova gravação exige a descrição', async () => {
    await draftOriginal()
    const cat = recId(await addCategory(OP, categoryData('C1', 'Pessoal')))
    const item = recId(await addItem(OP, itemData('F1', cat, 100, { fundingSource: 'other', fundingSourceDescription: 'X' })))
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}/workPlans/original/financialItems/${item}`).update({ 'data.fundingSourceDescription': FieldValue.delete() })
    status(await finalize('original', 2), 200)
    status(await createVersion(OP, { baseRevision: 3 }), 201)
    assert.equal((await finDocs('v2'))[0]?.data.fundingSource, 'other')
    status(await patchFin(OP, 'financial-item', item, 1, itemData('F1', cat, 200, { fundingSource: 'other' }), { workPlanId: 'v2' }), 422, 'invalid-financial')
  })
})

after(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)))
})
