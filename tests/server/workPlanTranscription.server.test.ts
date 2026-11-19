/**
 * DEV-02.4-C01 — Incorporação complementar, conferência e periodicidade no AMBIENTE CONFIÁVEL (`npm run test:server`).
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
import { handleWorkPlansRequest } from '../../api/_lib/workPlansService.ts'
import { MEMBERS, OSCS, USERS, memberDocument, memberPath, oscDocument, oscPath } from '../support/organizationFixtures.ts'
import { PARTNERSHIPS, partnershipDocument, partnershipPath } from '../support/partnershipFixtures.ts'
import { PERMISSION_MEMBERS, PERMISSION_USERS } from '../support/permissionFixtures.ts'
import { goalData, indicatorData } from '../support/workPlanFixtures.ts'
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
/** Finalização com a conferência coerente com os componentes REAIS da versão (DEC-PT-007). */
const tokenOf = async (workPlanId: string) =>
  componentsToken([...(await componentsOf(workPlanId)).map((c) => ({ kind: 'goal' as const, id: c.id, revision: c.revision })), ...(await componentsOf(workPlanId, 'indicators')).map((c) => ({ kind: 'indicator' as const, id: c.id, revision: c.revision }))])
async function finalize(workPlanId: string, expectedRevision: number, review: unknown = null) {
  const token = await tokenOf(workPlanId)
  const auto = review ?? (token.startsWith('0-') ? REVIEW_NONE : REVIEW_TRANSCRIBED)
  return call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId, requestId: nextRequest(), action: 'finalize', expectedRevision, confirm: true, ...reviewed(auto, token) })
}


const transcription = (workPlanId: string, action: 'open-transcription' | 'close-transcription', extra: Record<string, unknown> = {}, user: { uid: string } = OP, requestId = nextRequest()) =>
  call(user, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId, requestId, action, ...(action === 'open-transcription' ? { declaration: true } : {}), ...extra })
const close = async (workPlanId = 'original', review: unknown = REVIEW_TRANSCRIBED, extra: Record<string, unknown> = {}, requestId = nextRequest()) =>
  transcription(workPlanId, 'close-transcription', { expectedTranscriptionRevision: 1, review, componentsToken: await tokenOf(workPlanId), declaration: true, ...extra }, OP, requestId)
const planDoc = async (id = 'original', partnershipId = RUNNING) => (await deps.db.doc(`oscs/${ALFA}/partnerships/${partnershipId}/workPlans/${id}`).get()).data() as ComponentDoc
const NA = { state: 'not-applicable', justification: 'Indicador apurado uma única vez no encerramento.' }
async function finalizedEmpty(partnershipId = RUNNING) {
  await draftOriginal(partnershipId)
  status(await call(OP, 'POST', { oscId: ALFA, partnershipId, requestId: nextRequest(), action: 'finalize', expectedRevision: 2, confirm: true, ...reviewed() }), 200)
}

describe('DEC-PT-006 — incorporação complementar', () => {
  test('C01-T01/T02/T04/T05/T06/T07/T12/T13/T14 — abrir, transcrever, conferir, encerrar; finalização original intocada', async () => {
    await finalizedEmpty()
    const before = await planDoc()
    status(await addGoal(OP, goalData('Meta 01')), 409, 'complementary-transcription-pending') // T01: edição comum continua bloqueada
    status(await transcription('original', 'open-transcription', { declaration: false }), 422, 'declaration-required') // T04
    const opened = await transcription('original', 'open-transcription', {}, OP, 'abrir-incorporacao-1')
    status(opened, 201)
    const t = (await planDoc()).complementaryTranscription
    assert.deepEqual([t.status, t.revision, t.openedBy, t.rule, t.openDeclaration.accepted, t.openDeclaration.automatedVerification], ['open', 1, OP.uid, 'DEC-PT-006', true, false])
    const g = idOf(await addGoal(OP, goalData('Meta 01'))) // T06
    const i1 = idOf(await addIndicator(OP, indicatorData('IND-01', [g], { periodicity: { state: 'not-informed' } }))) // T07
    status(await close(), 422, 'review-pending') // periodicidade pendente (DEC-PT-009)
    status(await patch(OP, 'indicator', i1, 1, indicatorData('IND-01', [g], { periodicity: NA })), 200)
    status(await close('original', REVIEW_TRANSCRIBED, { componentsToken: '2-00000000' }), 409, 'components-changed')
    status(await close('original', REVIEW_TRANSCRIBED, { expectedTranscriptionRevision: 2 }), 409, 'stale')
    status(await close('original', REVIEW_TRANSCRIBED, { declaration: false }), 422, 'declaration-required')
    status(await close('original', REVIEW_NONE), 422, 'review-pending')
    status(await close('original', REVIEW_TRANSCRIBED, {}, 'encerrar-incorporacao-1'), 200) // T12
    const after = await planDoc()
    assert.deepEqual([after.complementaryTranscription.status, after.complementaryTranscription.revision, after.complementaryTranscription.closedBy, after.complementaryTranscription.counts], ['closed', 2, OP.uid, { goals: 1, indicators: 1 }])
    // T05: finalização original, identidade, sequência, revisão e valores intactos.
    for (const key of ['finalizedAt', 'finalizedBy', 'finalizationRequestId', 'revision', 'values', 'origin', 'registrationStatus', 'componentReview', 'activation']) assert.deepEqual(after[key], before[key], key)
    // T13: encerrada → sem novas gravações; reabertura recusada.
    status(await addGoal(OP, goalData('Meta 02')), 409, 'transcription-closed')
    status(await patch(OP, 'goal', g, 1, goalData('Meta 01', { description: 'Outra' })), 409, 'transcription-closed')
    status(await transcription('original', 'open-transcription'), 409, 'transcription-closed')
    assert.deepEqual(await versions(), ['original']) // T14
    const evs = await events()
    const comps = evs.filter((e) => String(e.action).startsWith('goal-') || String(e.action).startsWith('indicator-'))
    assert.ok(comps.every((e) => e.procedure === 'complementary-transcription'))
    assert.equal(comps.find((e) => e.action === 'indicator-updated')?.periodicityNotApplicable, NA.justification)
    const openEv = evs.find((e) => e.action === 'complementary-transcription-opened')
    const closeEv = evs.find((e) => e.action === 'complementary-transcription-closed')
    assert.deepEqual([openEv?.requestId, openEv?.actorUid, openEv?.workPlanId, closeEv?.requestId, closeEv?.counts], ['abrir-incorporacao-1', OP.uid, 'original', 'encerrar-incorporacao-1', { goals: 1, indicators: 1 }])
    assert.ok(closeEv?.at instanceof Timestamp)
    assert.equal(evs.filter((e) => e.action === 'finalize').length, 1, 'evento de finalização original preservado e único')
  })

  test('C01-T08/T09 — abertura e encerramento idempotentes; uma única incorporação ativa sob concorrência', async () => {
    await finalizedEmpty()
    status(await transcription('original', 'open-transcription', {}, OP, 'abrir-mesmo-pedido'), 201)
    const again = await transcription('original', 'open-transcription', {}, OP, 'abrir-mesmo-pedido')
    status(again, 200)
    assert.equal(again.body.opened, false)
    status(await transcription('original', 'open-transcription'), 409, 'transcription-already-open') // T09
    await seed()
    await finalizedEmpty()
    await setPermissions(DELEGATE, ['work-plan.edit'])
    const par = await Promise.all([transcription('original', 'open-transcription', {}, OP, 'paralelo-op-1'), transcription('original', 'open-transcription', {}, DELEGATE, 'paralelo-dl-1'), transcription('original', 'open-transcription', {}, OP, 'paralelo-op-2')])
    assert.equal(par.filter((r) => r.status === 201).length, 1, JSON.stringify(par.map((r) => r.status)))
    assert.ok(par.every((r) => r.status === 201 || (r.status === 409 && r.body.reason === 'transcription-already-open')))
    assert.equal((await events()).filter((e) => e.action === 'complementary-transcription-opened').length, 1)
    // Retomada por outro usuário autorizado; encerramento idempotente.
    status(await addGoal(DELEGATE, goalData('Meta 01')), 201)
    status(await close('original', { goals: REVIEW_TRANSCRIBED.goals, indicators: REVIEW_NONE.indicators }, {}, 'encerrar-mesmo-pedido'), 200)
    const repeat = await close('original', { goals: REVIEW_TRANSCRIBED.goals, indicators: REVIEW_NONE.indicators }, {}, 'encerrar-mesmo-pedido')
    status(repeat, 200)
    assert.equal(repeat.body.closed, false)
    assert.equal((await events()).filter((e) => e.action === 'complementary-transcription-closed').length, 1)
  })

  test('C01-T10/T11 e 3.7 — versão substituída, já estruturada, em cadastramento; nova versão bloqueada com incorporação aberta', async () => {
    await draftOriginal()
    status(await transcription('original', 'open-transcription'), 409, 'not-finalized')
    status(await addGoal(OP, goalData('Meta 01')), 201)
    status(await finalize('original', 2, { goals: REVIEW_TRANSCRIBED.goals, indicators: REVIEW_NONE.indicators }), 200)
    status(await transcription('original', 'open-transcription'), 409, 'components-exist') // T11
    await seed()
    await finalizedEmpty()
    status(await createVersion(OP, { baseRevision: 3 }), 201)
    status(await transcription('original', 'open-transcription'), 409, 'pending-version-exists') // cadeia íntegra
    status(await finalize('v2', 1), 200)
    status(await transcription('original', 'open-transcription'), 409, 'transcription-not-current') // T10
    await seed()
    await finalizedEmpty()
    status(await transcription('original', 'open-transcription'), 201)
    status(await addGoal(OP, goalData('Meta 01')), 201)
    status(await createVersion(OP, { baseRevision: 3 }), 409, 'transcription-open') // 3.7: sem versão híbrida
    assert.deepEqual(await versions(), ['original'])
  })

  test('C01-T03/T29 — permissões, suspensão comercial, arquivada, suspensa admite, isolamento e operações forjadas', async () => {
    await finalizedEmpty()
    for (const [user, permissions] of [[DELEGATE, ['work-plan.view']], [DELEGATE, ['work-plan.view', 'work-plan.finalize']], [ADMIN, []]] as const) {
      await setPermissions(user, [...permissions])
      status(await transcription('original', 'open-transcription', {}, user), 403, 'permission-not-granted')
    }
    status(await call(OP, 'POST', { oscId: GAMA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'open-transcription', declaration: true }), 403, 'no-membership')
    // Forjar: sem workPlanId, chave extra, ou "habilitar" pela requisição de componente.
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, requestId: nextRequest(), action: 'open-transcription', declaration: true }), 400)
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'open-transcription', declaration: true, status: 'open' }), 400)
    status(await comp(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'create-goal', data: goalData('Meta 01'), procedure: 'complementary-transcription' }), 400)
    await deps.db.doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'suspended' })
    status(await transcription('original', 'open-transcription'), 403, 'commercial-suspension')
    await deps.db.doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'active' })
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}`).update({ administrativeStatus: 'arquivada' })
    status(await transcription('original', 'open-transcription'), 403, 'partnership-archived')
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}`).update({ administrativeStatus: 'suspensa' })
    status(await transcription('original', 'open-transcription'), 201) // DEC-PAR-003: suspensão administrativa não bloqueia
    // Arquivada DURANTE a incorporação: gravações de componentes bloqueadas.
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}`).update({ administrativeStatus: 'arquivada' })
    status(await addGoal(OP, goalData('Meta 01')), 403, 'partnership-archived')
  })
})

describe('DEC-PT-007 — conferência na finalização regular', () => {
  test('C01-T15/T16/T17/T18/T19/T27 — conferência exigida, sem mínimo universal; atômica com a finalização', async () => {
    await draftOriginal()
    const g = idOf(await addGoal(OP, goalData('Meta 01')))
    const i = idOf(await addIndicator(OP, indicatorData('IND-01', [g], { periodicity: { state: 'not-informed' } })))
    const before = await planDoc()
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'finalize', expectedRevision: 2, confirm: true }), 400) // T15: sem conferência
    const pending = await finalize('original', 2, { goals: { status: 'pending', justification: null }, indicators: REVIEW_TRANSCRIBED.indicators })
    status(pending, 422, 'finalization-pending') // T18
    assert.ok((pending.body.pending as string[]).some((p) => /Metas: há componentes pendentes/.test(p)))
    assert.ok((pending.body.pending as string[]).some((p) => /Periodicidade pendente: IND-01/.test(p))) // T27
    status(await finalize('original', 2, REVIEW_NONE), 422, 'finalization-pending') // T17: há componentes ativos
    assert.deepEqual(await planDoc(), before, 'nada gravado nas recusas')
    status(await patch(OP, 'indicator', i, 1, indicatorData('IND-01', [g])), 200)
    // Conferência obsoleta: o navegador viu a revisão 1 do indicador.
    const stale = componentsToken([{ kind: 'goal', id: g, revision: 1 }, { kind: 'indicator', id: i, revision: 1 }])
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'finalize', expectedRevision: 2, confirm: true, ...reviewed(REVIEW_TRANSCRIBED, stale) }), 409, 'components-changed')
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), action: 'finalize', expectedRevision: 2, confirm: true, ...reviewed(REVIEW_TRANSCRIBED, await tokenOf('original')), declaration: false }), 422, 'declaration-required')
    status(await finalize('original', 2, REVIEW_TRANSCRIBED), 200) // T16
    const after = await planDoc()
    assert.deepEqual([after.registrationStatus, after.componentReview.rule, after.componentReview.goals.status, after.componentReview.counts, after.componentReview.declaration.accepted, after.componentReview.reviewedBy], ['finalized', 'DEC-PT-007', 'transcribed', { goals: 1, indicators: 1 }, true, OP.uid])
    const ev = (await events()).find((e) => e.action === 'components-reviewed')
    assert.deepEqual([ev?.workPlanId, ev?.revision, ev?.counts], ['original', 3, { goals: 1, indicators: 1 }])
    // T19: sem mínimo universal — Plano sem metas nem indicadores, com justificativas.
    await seed()
    await draftOriginal()
    status(await finalize('original', 2, { goals: { status: 'not-applicable', justification: '' }, indicators: REVIEW_NONE.indicators }), 422, 'finalization-pending')
    status(await finalize('original', 2, { goals: { status: 'not-applicable', justification: 'Parceria de cooperação sem metas no Plano.' }, indicators: REVIEW_NONE.indicators }), 200)
  })

  test('C01-T20 — finalizações anteriores preservadas (sem conferência retroativa); versão posterior exige a sua', async () => {
    await finalizedEmpty()
    // Simula versão finalizada antes da DEC-PT-007 (sem componentReview).
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}/workPlans/original`).update({ componentReview: FieldValue.delete() })
    const legacy = await planDoc()
    status(await createVersion(OP, { baseRevision: 3 }), 201)
    assert.deepEqual(await planDoc(), legacy)
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'v2', requestId: nextRequest(), action: 'finalize', expectedRevision: 1, confirm: true }), 400)
    status(await finalize('v2', 1), 200)
    assert.equal((await planDoc()).componentReview, undefined, 'original não recebe conferência retroativa')
  })
})

describe('DEC-PT-008/009/010 — vínculos, periodicidade e campos opcionais', () => {
  test('C01-T21/T22/T23/T24/T25/T26/T28 — vínculos flexíveis, periodicidades e opcionais preservados na cópia', async () => {
    await draftOriginal()
    const g1 = idOf(await addGoal(OP, goalData('Meta 01', { completionCriterion: { state: 'informed', value: 'Lista de presença' } })))
    const g2 = idOf(await addGoal(OP, goalData('Meta 02', { nature: 'qualitative', expectedQuantity: { state: 'not-informed' }, unit: { state: 'not-informed' } })))
    status(await addIndicator(OP, indicatorData('IND-01', [g1, g2])), 201) // T21
    status(await addIndicator(OP, indicatorData('IND-02', [], { periodicity: { state: 'informed', value: { kind: 'other', description: 'No 6º e no 18º mês' } } })), 201) // T22/T25
    status(await addIndicator(OP, indicatorData('IND-03', [], { periodicity: NA })), 201) // T26
    status(await addIndicator(OP, indicatorData('IND-04', [], { periodicity: { state: 'not-applicable', justification: 'curta' } })), 422, 'invalid-component')
    status(await addIndicator(OP, indicatorData('IND-05', [], { periodicity: { state: 'informed', value: { kind: 'annual', description: null } } })), 201) // T24
    // T23: meta de OUTRA parceria/versão não é aceita.
    await draftOriginal(SUSPENDED)
    const foreign = idOf(await addGoal(OP, goalData('Meta 01'), { partnershipId: SUSPENDED }))
    status(await addIndicator(OP, indicatorData('IND-06', [foreign])), 422, 'invalid-component')
    status(await finalize('original', 2), 200)
    status(await createVersion(OP, { baseRevision: 3 }), 201)
    const copied = await componentsOf('v2', 'indicators')
    assert.deepEqual(copied.find((c) => c.data.code === 'IND-01')?.data.goalIds, [g1, g2])
    assert.deepEqual(copied.find((c) => c.data.code === 'IND-03')?.data.periodicity, NA)
    assert.deepEqual((await componentsOf('v2')).find((c) => c.id === g1)?.data.completionCriterion, { state: 'informed', value: 'Lista de presença' }) // T28
    assert.equal(copied.filter((c) => c.data.code === 'IND-01').length, 1, 'indicador compartilhado não é duplicado')
  })
})

after(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)))
})
