/**
 * DEV-02.3 e DEV-02.3-C01 — Versionamento e vigência do Plano no AMBIENTE CONFIÁVEL (`npm run test:server`).
 * Emuladores de Auth e Firestore; Admin SDK, código REAL de `api/` e política de PRODUÇÃO.
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp } from 'firebase-admin/firestore'
import type { ApiResponse, ServerDeps } from '../../api/_lib/permissionsService.ts'
import { getServerDeps } from '../../api/_lib/serverDeps.ts'
import { handleWorkPlansRequest } from '../../api/_lib/workPlansService.ts'
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
const nextRequest = () => `pedido-${++counter}-versao`
const call = (user: { uid: string }, method: 'POST' | 'PATCH', body: Record<string, unknown>) =>
  handleWorkPlansRequest({ method, authorization: `Bearer ${tokens.get(user.uid) ?? ''}`, query: new URLSearchParams(), rawBody: JSON.stringify(body) }, deps, { today: TODAY })
const informed = (value: string | number) => ({ state: 'informed', value })
const REQUIRED = { approvalDate: informed('2026-02-10'), executionStart: informed('2026-03-01'), executionEnd: informed('2028-02-28') }
const ACT = { type: 'termo-aditivo', reference: '1º Termo Aditivo', actDate: '2026-09-01', description: 'Ampliação do público atendido.', effectiveDate: '2026-10-01' }
const status = (response: ApiResponse, expected: number, reason?: string) => {
  assert.equal(response.status, expected, JSON.stringify(response))
  if (reason) assert.equal(response.body.reason ?? response.body.error, reason, JSON.stringify(response))
}
const docOf = async (id: string, partnershipId = RUNNING, oscId = ALFA) => (await deps.db.doc(`oscs/${oscId}/partnerships/${partnershipId}/workPlans/${id}`).get()).data()
const versions = async (partnershipId = RUNNING) => (await deps.db.collection(`oscs/${ALFA}/partnerships/${partnershipId}/workPlans`).get()).docs.map((d) => d.id).sort()
const events = async () => (await deps.db.collection(`oscs/${ALFA}/workPlanEvents`).get()).docs.map((d) => d.data())

/** Original finalizado pela API real (com valores em todos os estados de informação). */
async function finalizedOriginal(partnershipId = RUNNING) {
  status(await call(OP, 'POST', { oscId: ALFA, partnershipId, requestId: nextRequest(), action: 'start' }), 201)
  status(await call(OP, 'PATCH', { oscId: ALFA, partnershipId, requestId: nextRequest(), expectedRevision: 1, changes: { ...REQUIRED, estimatedBeneficiaries: informed(0), geographicScope: { state: 'not-applicable' }, justification: informed('Atendimento original.') } }), 200)
  status(await call(OP, 'POST', { oscId: ALFA, partnershipId, requestId: nextRequest(), action: 'finalize', expectedRevision: 2, confirm: true }), 200)
}
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
const update = (user: { uid: string }, workPlanId: string, changes: Record<string, unknown>, expectedRevision: number) =>
  call(user, 'PATCH', { oscId: ALFA, partnershipId: RUNNING, workPlanId, requestId: nextRequest(), expectedRevision, changes })
const finalize = (user: { uid: string }, workPlanId: string, expectedRevision: number) =>
  call(user, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId, requestId: nextRequest(), action: 'finalize', expectedRevision, confirm: true })

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

describe('Criação de nova versão (alteração formal)', () => {
  test('DEV-02.3-T02/T03/T04/T06 — versão integral a partir da vigente; original intacto; ato formal declarado', async () => {
    await finalizedOriginal()
    const before = await docOf('original')
    const r = await createVersion(OP)
    status(r, 201)
    assert.deepEqual(r.body.workPlan, { id: 'v2', revision: 1, registrationStatus: 'in-registration', sequence: 2 })
    const v2 = await docOf('v2')
    assert.ok(v2)
    assert.deepEqual(v2.values, before?.values, 'cópia integral, inclusive zero, não aplicável e não informado')
    assert.deepEqual(v2.origin, { kind: 'formal-alteration', formalVersion: true, sequence: 2, sourceWorkPlanId: 'original', previousWorkPlanId: 'original', baseRevision: 3 })
    assert.deepEqual([v2.registrationStatus, v2.revision, v2.activation.status, v2.createdBy, v2.partnershipId, v2.oscId], ['in-registration', 1, 'awaiting-finalization', OP.uid, RUNNING, ALFA])
    assert.equal(v2.formalAct.type, 'termo-aditivo')
    assert.equal(v2.formalAct.actDate, '2026-09-01')
    assert.equal(v2.formalAct.effectiveDate, '2026-10-01')
    assert.deepEqual([v2.formalAct.declaredBy, v2.formalAct.automatedVerification], [OP.uid, false])
    assert.ok(v2.formalAct.declaredAt instanceof Timestamp)
    assert.deepEqual(v2.document, { status: 'not-stored', storagePath: null })
    const after = await docOf('original')
    assert.deepEqual(after, before, 'versão anterior não modificada pela criação')
    const event = (await events()).find((e) => e.action === 'version-created')
    assert.deepEqual([event?.workPlanId, event?.previousWorkPlanId, event?.sequence, event?.actType, event?.actorUid], ['v2', 'original', 2, 'termo-aditivo', OP.uid])
  })

  test('DEV-02.3-T07 — ato formal: tipo e data obrigatórios (homologados); outro ato identificado; data não futura', async () => {
    await finalizedOriginal()
    const invalid = async (act: unknown, field: string, code: string) => {
      const r = await createVersion(OP, { act })
      status(r, 422, 'invalid-formal-act')
      assert.equal((r.body.fields as Record<string, string>)[field], code, JSON.stringify(r.body))
    }
    await invalid({ actDate: '2026-09-01' }, 'type', 'required')
    await invalid({ type: 'termo-aditivo' }, 'actDate', 'required')
    await invalid({ type: 'portaria-inventada', actDate: '2026-09-01' }, 'type', 'invalid')
    await invalid({ type: 'outro-ato', actDate: '2026-09-01' }, 'typeDescription', 'required')
    await invalid({ type: 'apostilamento', actDate: '2026-12-01' }, 'actDate', 'in-future')
    await invalid({ type: 'apostilamento', actDate: '2026-09-01', effectiveDate: '2026-13-01' }, 'effectiveDate', 'invalid-date')
    await invalid({ type: 'apostilamento', actDate: '2026-09-01', validatedBySigosc: true }, 'formalAct', 'invalid')
    status(await createVersion(OP, { act: null }), 422, 'invalid-formal-act')
    assert.deepEqual(await versions(), ['original'])
    status(await createVersion(OP, { act: { type: 'outro-ato', typeDescription: 'Despacho de readequação', actDate: '2026-09-01' } }), 201)
  })

  test('Base: somente a versão vigente finalizada; revisão da base conferida; uma versão pendente por vez', async () => {
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, requestId: nextRequest(), action: 'start' }), 201)
    status(await createVersion(OP, { baseRevision: 1 }), 409, 'base-not-finalized')
    await update(OP, 'original', REQUIRED, 1)
    status(await finalize(OP, 'original', 2), 200)
    status(await createVersion(OP, { baseRevision: 2 }), 409, 'stale')
    status(await createVersion(OP), 201)
    status(await createVersion(OP), 409, 'pending-version-exists')
    status(await update(OP, 'v2', { justification: informed('Nova redação.') }, 1), 200)
    status(await finalize(OP, 'v2', 2), 200)
    // DEC-PT-003/004: v2 ativada → a original deixa de ser base; v3 parte da v2.
    status(await createVersion(OP), 409, 'base-not-current')
    status(await createVersion(OP, { base: 'v2', baseRevision: 3 }), 201)
    status(await createVersion(OP, { base: 'v2', baseRevision: 3 }), 409, 'pending-version-exists')
    assert.deepEqual(await versions(), ['original', 'v2', 'v3'])
  })

  test('DEV-02.3-T17/T18 — reenvio idempotente e criação concorrente: nunca duas versões', async () => {
    await finalizedOriginal()
    const first = await createVersion(OP, { requestId: 'nova-versao-1' })
    status(first, 201)
    const again = await createVersion(OP, { requestId: 'nova-versao-1' })
    status(again, 200)
    assert.deepEqual([again.body.created, (again.body.workPlan as { id: string }).id], [false, 'v2'])
    await seed()
    await finalizedOriginal()
    await setPermissions(DELEGATE, ['work-plan.edit'])
    const parallel = await Promise.all([
      createVersion(OP, { requestId: 'paralela-op-1' }),
      createVersion(DELEGATE, { requestId: 'paralela-dl-1' }),
      createVersion(OP, { requestId: 'paralela-op-1' }),
      createVersion(OP, { requestId: 'paralela-op-2' }),
    ])
    assert.equal(parallel.filter((r) => r.status === 201).length, 1, JSON.stringify(parallel.map((r) => r.status)))
    assert.ok(parallel.every((r) => r.status === 201 || r.status === 200 || (r.status === 409 && r.body.reason === 'pending-version-exists')), JSON.stringify(parallel.map((r) => r.body)))
    assert.deepEqual(await versions(), ['original', 'v2'])
    assert.equal((await events()).filter((e) => e.action === 'version-created').length, 1)
  })
})

describe('Cadastro, finalização e correção por versão', () => {
  test('DEV-02.3-T05/T08/T09 — editar a nova versão sem tocar o original; finalizar com edit; edição comum bloqueada depois', async () => {
    await finalizedOriginal()
    await createVersion(OP)
    const original = await docOf('original')
    status(await update(OP, 'v2', { estimatedBeneficiaries: informed(120), targetAudience: informed('Famílias do território.') }, 1), 200)
    status(await call(OP, 'PATCH', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'v2', requestId: nextRequest(), expectedRevision: 2, formalAct: { ...ACT, reference: '1º TA/2026' } }), 200)
    status(await call(OP, 'PATCH', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: nextRequest(), expectedRevision: 3, formalAct: ACT }), 409, 'already-finalized')
    status(await finalize(DELEGATE, 'v2', 3), 403, 'permission-not-granted')
    status(await finalize(OP, 'v2', 3), 200)
    const v2 = await docOf('v2')
    assert.deepEqual([v2?.registrationStatus, v2?.finalizedBy, v2?.revision, v2?.formalAct.reference], ['finalized', OP.uid, 4, '1º TA/2026'])
    const { activation: originalActivation, ...originalRest } = (await docOf('original')) ?? {}
    assert.deepEqual(originalRest, original, 'original preservado: só os metadados de vigência mudam')
    assert.equal(originalActivation.status, 'superseded')
    status(await update(OP, 'v2', { estimatedBeneficiaries: informed(130) }, 4), 409, 'already-finalized')
    status(await call(OP, 'PATCH', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'v2', requestId: nextRequest(), expectedRevision: 4, formalAct: ACT }), 409, 'already-finalized')
  })

  test('DEV-02.3-T14/T15/T16 — correção material identifica a versão; outra versão não muda; histórico preservado e filtrável', async () => {
    await finalizedOriginal()
    const correctOriginal = await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: 'correcao-original-1', action: 'correct', expectedRevision: 3, changes: { approvalDate: informed('2026-02-12') }, justification: 'Data transcrita incorretamente.', declaration: true })
    status(correctOriginal, 200)
    status(await createVersion(OP, { baseRevision: 4 }), 201)
    assert.deepEqual((await docOf('v2'))?.values.approvalDate, { state: 'informed', value: '2026-02-12' }) // cópia do vigente corrigido
    await finalize(OP, 'v2', 1)
    const v2Before = await docOf('v2')
    const originalBefore = await docOf('original')
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'v2', requestId: 'correcao-v2-0001', action: 'correct', expectedRevision: 2, changes: { estimatedBeneficiaries: informed(15) }, justification: 'Quantidade transcrita errada na versão 2.', declaration: true }), 200)
    assert.deepEqual(await docOf('original'), originalBefore, 'correção da v2 não altera o original')
    const v2 = await docOf('v2')
    assert.deepEqual([v2?.values.estimatedBeneficiaries, v2?.registrationStatus, v2?.finalizedBy, v2?.revision], [informed(15), 'finalized', v2Before?.finalizedBy, 3])
    const corrections = (await events()).filter((e) => e.action === 'material-correction')
    assert.deepEqual(corrections.map((e) => [e.workPlanId, e.sequence, e.fromRevision, e.toRevision]).sort(), [['original', 1, 3, 4], ['v2', 2, 2, 3]])
    const history = async (workPlanId?: string) =>
      handleWorkPlansRequest({ method: 'GET', authorization: `Bearer ${tokens.get(OP.uid) ?? ''}`, query: new URLSearchParams({ oscId: ALFA, partnershipId: RUNNING, ...(workPlanId ? { workPlanId } : {}) }), rawBody: '' }, deps)
    const all = await history()
    assert.deepEqual((all.body.entries as { workPlanId: string }[]).map((e) => e.workPlanId), ['original', 'v2'])
    assert.deepEqual(((await history('v2')).body.entries as { workPlanId: string }[]).map((e) => e.workPlanId), ['v2'])
    status(await history('v99'), 200)
    status(await handleWorkPlansRequest({ method: 'GET', authorization: `Bearer ${tokens.get(OP.uid) ?? ''}`, query: new URLSearchParams({ oscId: ALFA, partnershipId: RUNNING, workPlanId: '../x' }), rawBody: '' }, deps), 400)
    // Correção da versão em cadastramento é recusada (edição comum se aplica).
    await seed()
    await finalizedOriginal()
    await createVersion(OP)
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'v2', requestId: nextRequest(), action: 'correct', expectedRevision: 1, changes: { estimatedBeneficiaries: informed(1) }, justification: 'Tentativa indevida aqui.', declaration: true }), 409, 'not-finalized')
  })
})

describe('Restrições e isolamento', () => {
  test('DEV-02.3-T19/T20/T21 — suspensão comercial e arquivada bloqueiam; parceria suspensa admite', async () => {
    await finalizedOriginal(SUSPENDED)
    status(await createVersion(OP, { partnershipId: SUSPENDED }), 201)
    await finalizedOriginal()
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}`).update({ administrativeStatus: 'arquivada' })
    status(await createVersion(OP), 403, 'partnership-archived')
    status(await update(OP, 'v2', { justification: informed('x') }, 1).then((r) => r), 403) // ainda não existe v2 em RUNNING: negação vem antes
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}`).update({ administrativeStatus: 'em-execucao' })
    await deps.db.doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'suspended' })
    status(await createVersion(OP), 403, 'commercial-suspension')
    assert.deepEqual(await versions(), ['original'])
  })

  test('DEV-02.3-T22 / T23 — sem acesso entre OSCs; permissões: view, ID descontinuado e administrador não criam versão', async () => {
    await finalizedOriginal()
    status(await createVersion(OP, { oscId: GAMA }), 403, 'no-membership')
    status(await createVersion(OP, { partnershipId: 'pGamaColaboracao09x' }), 404, 'not-found')
    for (const [user, permissions] of [[DELEGATE, ['work-plan.view']], [DELEGATE, ['work-plan.view', 'work-plan.finalize']], [ADMIN, []]] as const) {
      await setPermissions(user, [...permissions])
      status(await createVersion(user), 403, 'permission-not-granted')
    }
    assert.deepEqual(await versions(), ['original'])
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, requestId: nextRequest(), action: 'create-version', baseWorkPlanId: '../../x', baseRevision: 3, formalAct: ACT }), 400)
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, requestId: nextRequest(), action: 'create-version', baseWorkPlanId: 'original', baseRevision: 3, formalAct: ACT, sequence: 9 }), 400)
  })
})

// ============================================================================ DEV-02.3-C01
const finalizeReq = (user: { uid: string }, workPlanId: string, expectedRevision: number, requestId = nextRequest(), extra: Record<string, unknown> = {}) =>
  call(user, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId, requestId, action: 'finalize', expectedRevision, confirm: true, ...extra })
/** Original finalizado + v2 criada (revisão 1) com o ato indicado. */
async function withDraftV2(act: Record<string, unknown> = ACT) {
  await finalizedOriginal()
  status(await createVersion(OP, { act }), 201)
}
const without = (value: Record<string, unknown> | undefined, key: string) => Object.fromEntries(Object.entries(value ?? {}).filter(([k]) => k !== key))
const activations = async () => (await events()).filter((e) => e.action === 'version-activated')
const stateOf = async () => Object.fromEntries((await deps.db.collection(`oscs/${ALFA}/partnerships/${RUNNING}/workPlans`).get()).docs.map((d) => [d.id, [d.get('registrationStatus'), d.get('activation.status') ?? null]]))

describe('DEV-02.3-C01 — DEC-PT-003: ativação automática na finalização', () => {
  test('C01-T01/T02/T03/T19/T20 — finalizar v2 a ativa; original substituída e preservada; uma só vigente; sem aprovação jurídica', async () => {
    await withDraftV2()
    const original = await docOf('original')
    const r = await finalizeReq(OP, 'v2', 1, 'finalizar-v2-0001')
    status(r, 200)
    assert.deepEqual(r.body.workPlan, { id: 'v2', revision: 2, registrationStatus: 'finalized', sequence: 2, activationStatus: 'active', supersededWorkPlanId: 'original', activatedAt: null, effectiveDate: '2026-10-01' })
    assert.equal(JSON.stringify(r.body).match(/jur[ií]dic|aprova/i), null, 'resposta não afirma aprovação jurídica')
    const v2 = await docOf('v2')
    assert.deepEqual([v2?.registrationStatus, v2?.activation.status, v2?.activation.rule, v2?.activation.activatedBy, v2?.activation.supersededWorkPlanId], ['finalized', 'active', 'DEC-PT-003', OP.uid, 'original'])
    assert.ok(v2?.activation.activatedAt instanceof Timestamp, 'hora do servidor')
    assert.deepEqual(v2?.activation.activatedAt, v2?.finalizedAt, 'finalização e ativação no mesmo instante (mesma transação)')
    const after = await docOf('original')
    assert.deepEqual([after?.activation.status, after?.activation.supersededByWorkPlanId], ['superseded', 'v2'])
    assert.deepEqual(without(after, 'activation'), original, 'T20: valores, revisão e finalização da original intactos')
    assert.deepEqual(await stateOf(), { original: ['finalized', 'superseded'], v2: ['finalized', 'active'] })
    const [ev] = await activations()
    assert.deepEqual(
      [ev?.workPlanId, ev?.previousWorkPlanId, ev?.sequence, ev?.actorUid, ev?.actorAuthority, ev?.requestId, ev?.revision, ev?.rule, ev?.effectiveDate, ev?.effectsAtActivation],
      ['v2', 'original', 2, OP.uid, 'member', 'finalizar-v2-0001', 2, 'DEC-PT-003', '2026-10-01', 'reached'],
    )
    assert.equal((await events()).filter((e) => e.action === 'finalize' && e.workPlanId === 'v2').length, 1, 'finalização e ativação rastreáveis separadamente')
  })

  test('C01-T04/T05/T14 — atomicidade: falha em qualquer etapa não deixa ativação parcial; revisão obsoleta recusada', async () => {
    await withDraftV2()
    status(await update(OP, 'v2', { executionEnd: { state: 'not-informed' } }, 1), 200)
    const snapshot = async () => ({ docs: await stateOf(), original: await docOf('original'), v2: await docOf('v2'), events: (await events()).length })
    const before = await snapshot()
    status(await finalizeReq(OP, 'v2', 2), 422, 'finalization-pending')
    assert.deepEqual(await snapshot(), before)
    status(await finalizeReq(OP, 'v2', 1), 409, 'stale')
    assert.deepEqual(await snapshot(), before)
    // Estado inconsistente gravado por fora (duas ativas): recusa sem gravar nada.
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}/workPlans/v9`).set({ id: 'v9', oscId: ALFA, partnershipId: RUNNING, origin: { sequence: 9 }, registrationStatus: 'finalized', activation: { status: 'active' } })
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}/workPlans/v8`).set({ id: 'v8', oscId: ALFA, partnershipId: RUNNING, origin: { sequence: 8 }, registrationStatus: 'finalized', activation: { status: 'active' } })
    status(await update(OP, 'v2', { executionEnd: informed('2028-02-28') }, 2), 200)
    const before2 = await snapshot()
    status(await finalizeReq(OP, 'v2', 3), 409, 'versions-inconsistent')
    assert.deepEqual(await snapshot(), before2)
  })

  test('C01-T06/T07/T08 — exige work-plan.edit e confirmação; não há ação manual de ativação', async () => {
    await withDraftV2()
    for (const [user, permissions] of [[DELEGATE, ['work-plan.view']], [DELEGATE, ['work-plan.view', 'work-plan.finalize']], [ADMIN, []]] as const) {
      await setPermissions(user, [...permissions])
      status(await finalizeReq(user, 'v2', 1), 403, 'permission-not-granted')
    }
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'v2', requestId: nextRequest(), action: 'finalize', expectedRevision: 1 }), 400)
    status(await finalizeReq(OP, 'v2', 1, nextRequest(), { confirm: false }), 400)
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'v2', requestId: nextRequest(), action: 'activate' }), 400)
    status(await finalizeReq(OP, 'v2', 1, nextRequest(), { activation: { status: 'active' } }), 400)
    assert.deepEqual(await stateOf(), { original: ['finalized', null], v2: ['in-registration', 'awaiting-finalization'] })
  })
})

describe('DEV-02.3-C01 — DEC-PT-004: sequência, concorrência e idempotência', () => {
  test('C01-T09/T10/T11 — original → v2 → v3 → v4; uma em cadastramento por vez; sempre a partir da vigente', async () => {
    await withDraftV2()
    status(await createVersion(OP), 409, 'pending-version-exists') // T10
    status(await finalizeReq(OP, 'v2', 1), 200)
    status(await createVersion(OP, { baseRevision: 3 }), 409, 'base-not-current') // T09: original não é mais a vigente
    status(await createVersion(OP, { base: 'v2', baseRevision: 2 }), 201) // T11
    assert.deepEqual((await docOf('v3'))?.origin.previousWorkPlanId, 'v2')
    assert.deepEqual((await docOf('v3'))?.values, (await docOf('v2'))?.values)
    status(await finalizeReq(OP, 'v3', 1), 200)
    status(await createVersion(OP, { base: 'v3', baseRevision: 2 }), 201)
    assert.deepEqual(await stateOf(), { original: ['finalized', 'superseded'], v2: ['finalized', 'superseded'], v3: ['finalized', 'active'], v4: ['in-registration', 'awaiting-finalization'] })
    assert.deepEqual([(await docOf('v2'))?.activation.supersededByWorkPlanId, (await docOf('v2'))?.activation.supersededWorkPlanId], ['v3', 'original'])
  })

  test('C01-T12/T13 — reenvio idempotente; finalizações simultâneas: uma única ativação', async () => {
    await withDraftV2()
    const first = await finalizeReq(OP, 'v2', 1, 'finalizar-repetido-1')
    status(first, 200)
    const again = await finalizeReq(OP, 'v2', 1, 'finalizar-repetido-1')
    status(again, 200)
    assert.equal(again.body.finalized, false)
    const w = again.body.workPlan as Record<string, unknown>
    assert.deepEqual([w.id, w.revision, w.activationStatus, w.supersededWorkPlanId, w.effectiveDate], ['v2', 2, 'active', 'original', '2026-10-01'])
    assert.equal(typeof w.activatedAt, 'string')
    assert.equal((await activations()).length, 1)
    assert.equal((await docOf('v2'))?.revision, 2)
    // Outra pessoa / outro pedido depois: não reativa nem substitui outra versão.
    await setPermissions(DELEGATE, ['work-plan.edit'])
    status(await finalizeReq(DELEGATE, 'v2', 2), 409, 'already-finalized')
    // T13: concorrência real.
    await seed()
    await withDraftV2()
    await setPermissions(DELEGATE, ['work-plan.edit'])
    const parallel = await Promise.all([finalizeReq(OP, 'v2', 1, 'simultaneo-op-1'), finalizeReq(DELEGATE, 'v2', 1, 'simultaneo-dl-1'), finalizeReq(OP, 'v2', 1, 'simultaneo-op-1'), finalizeReq(OP, 'v2', 1, 'simultaneo-op-2')])
    assert.equal(parallel.filter((r) => r.status === 200 && r.body.finalized === true).length, 1, JSON.stringify(parallel.map((r) => [r.status, r.body])))
    assert.ok(parallel.every((r) => r.status === 200 || (r.status === 409 && ['already-finalized', 'stale'].includes(String(r.body.reason ?? r.body.error)))), JSON.stringify(parallel.map((r) => r.body)))
    assert.equal((await activations()).length, 1)
    assert.deepEqual(await stateOf(), { original: ['finalized', 'superseded'], v2: ['finalized', 'active'] })
  })
})

describe('DEV-02.3-C01 — DEC-PT-005: efeitos administrativos', () => {
  test('C01-T15/T17/T18 — efeitos futuros ativam e sinalizam; ausência não é presumida; data alcançada sem aviso', async () => {
    await withDraftV2({ ...ACT, effectiveDate: '2027-03-01' })
    const r = await finalizeReq(OP, 'v2', 1)
    status(r, 200)
    assert.deepEqual([(r.body.workPlan as Record<string, unknown>).activationStatus, (r.body.workPlan as Record<string, unknown>).effectiveDate], ['active', '2027-03-01'])
    assert.equal((await activations())[0]?.effectsAtActivation, 'future')
    assert.equal((await docOf('v2'))?.formalAct.effectiveDate, '2027-03-01', 'data mantida para módulos futuros')
    await seed()
    await withDraftV2(without(ACT, 'effectiveDate'))
    const n = await finalizeReq(OP, 'v2', 1)
    status(n, 200)
    assert.equal((n.body.workPlan as Record<string, unknown>).effectiveDate, null)
    const [ev] = await activations()
    assert.deepEqual([ev?.effectiveDate, ev?.effectsAtActivation], [null, 'not-informed'])
    assert.equal((await docOf('v2'))?.formalAct.effectiveDate, null, 'data de finalização não vira data de efeitos')
    await seed()
    await withDraftV2({ ...ACT, effectiveDate: TODAY })
    status(await finalizeReq(OP, 'v2', 1), 200)
    assert.equal((await activations())[0]?.effectsAtActivation, 'reached')
  })
})

describe('DEV-02.3-C01 — preservação, segurança e legado', () => {
  test('C01-T22 — correção material segue vinculada à versão (inclusive a substituída)', async () => {
    await withDraftV2()
    status(await finalizeReq(OP, 'v2', 1), 200)
    status(await call(OP, 'POST', { oscId: ALFA, partnershipId: RUNNING, workPlanId: 'original', requestId: 'correcao-substituida-1', action: 'correct', expectedRevision: 3, changes: { approvalDate: informed('2026-02-11') }, justification: 'Erro de transcrição na versão original.', declaration: true }), 200)
    assert.deepEqual([(await docOf('original'))?.values.approvalDate, (await docOf('original'))?.activation.status], [informed('2026-02-11'), 'superseded'])
    assert.deepEqual((await docOf('v2'))?.values.approvalDate, informed('2026-02-10'))
    assert.deepEqual((await events()).filter((e) => e.action === 'material-correction').map((e) => e.workPlanId), ['original'])
    assert.deepEqual(await stateOf(), { original: ['finalized', 'superseded'], v2: ['finalized', 'active'] })
  })

  test('C01-T23/T24 — outra OSC e sem autorização não ativam; suspensão comercial e arquivada bloqueiam; suspensa admite', async () => {
    await withDraftV2()
    status(await call(OP, 'POST', { oscId: GAMA, partnershipId: RUNNING, workPlanId: 'v2', requestId: nextRequest(), action: 'finalize', expectedRevision: 1, confirm: true }), 403, 'no-membership')
    await deps.db.doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'suspended' })
    status(await finalizeReq(OP, 'v2', 1), 403, 'commercial-suspension')
    await deps.db.doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'active' })
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}`).update({ administrativeStatus: 'arquivada' })
    status(await finalizeReq(OP, 'v2', 1), 403, 'partnership-archived')
    assert.deepEqual(await stateOf(), { original: ['finalized', null], v2: ['in-registration', 'awaiting-finalization'] })
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}`).update({ administrativeStatus: 'suspensa' })
    status(await finalizeReq(OP, 'v2', 1), 200)
    assert.deepEqual(await stateOf(), { original: ['finalized', 'superseded'], v2: ['finalized', 'active'] })
  })

  test('Legado (pending-decision): finalizado não é ativado retroativamente e protege a criação; em cadastramento ativa ao finalizar', async () => {
    await finalizedOriginal()
    const legacy = (await docOf('original')) ?? {}
    // v2 gravada pela DEV-02.3 e finalizada ANTES da DEC-PT-003.
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}/workPlans/v2`).set({
      ...legacy, id: 'v2', origin: { kind: 'formal-alteration', formalVersion: true, sequence: 2, sourceWorkPlanId: 'original', previousWorkPlanId: 'original', baseRevision: 3 },
      formalAct: { ...ACT, typeDescription: null, declaredBy: OP.uid, automatedVerification: false }, activation: { status: 'pending-decision' }, revision: 2, finalizationRequestId: 'legado-final-1', finalizedBy: OP.uid,
    })
    const snapshot = await stateOf()
    status(await createVersion(OP), 409, 'legacy-version-pending')
    status(await createVersion(OP, { base: 'v2', baseRevision: 2 }), 409, 'legacy-version-pending')
    status(await finalizeReq(OP, 'v2', 2), 409, 'already-finalized')
    status(await finalizeReq(OP, 'v2', 2, 'legado-final-1'), 200) // reenvio do pedido original: só devolve o estado
    assert.deepEqual(await stateOf(), snapshot, 'nenhuma ativação retroativa automática')
    assert.equal((await activations()).length, 0)
    // Legado em cadastramento: a finalização (agora DEC-PT-003) o ativa.
    await seed()
    await finalizedOriginal()
    status(await createVersion(OP), 201)
    await deps.db.doc(`oscs/${ALFA}/partnerships/${RUNNING}/workPlans/v2`).update({ 'activation.status': 'pending-decision' })
    status(await finalizeReq(OP, 'v2', 1), 200)
    assert.deepEqual(await stateOf(), { original: ['finalized', 'superseded'], v2: ['finalized', 'active'] })
  })
})

after(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)))
})
