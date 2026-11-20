/**
 * DEV-02.1 — Security Rules das parcerias (`npm run test:rules`, emulador, projeto fictício).
 * Consulta isolada por OSC e permissão; nenhuma escrita pelo cliente.
 * Controles positivos: os documentos existem e quem tem a permissão consegue lê-los.
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { MEMBERS, OSCS, USERS, memberDocument, memberPath, oscDocument, oscPath } from '../support/organizationFixtures.ts'
import { PERMISSION_MEMBERS, PERMISSION_USERS } from '../support/permissionFixtures.ts'
import { partnershipDocument } from '../support/partnershipFixtures.ts'
import { workPlanDocument, workPlanPath } from '../support/workPlanFixtures.ts'
import { createTestEnvironment } from './setup.ts'

const ALFA = OSCS.ALFA.id
const GAMA = OSCS.GAMA.id
const alfaPath = `oscs/${ALFA}/partnerships/parceria-alfa-1`
const gamaPath = `oscs/${GAMA}/partnerships/parceria-gama-1`

async function seed(env: RulesTestEnvironment) {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore()
    for (const osc of Object.values(OSCS)) await db.doc(oscPath(osc)).set(oscDocument(osc))
    for (const member of [...MEMBERS, ...PERMISSION_MEMBERS]) await db.doc(memberPath(member)).set(memberDocument(member))
    // SINGLE (administrador de GAMA) recebe a permissão de consulta em GAMA.
    await db.doc(memberPath({ oscId: GAMA, uid: USERS.SINGLE.uid })).update({ permissions: ['partnerships.view'] })
    await db.doc(alfaPath).set(partnershipDocument({ id: 'parceria-alfa-1', oscId: ALFA }))
    await db.doc(gamaPath).set(partnershipDocument({ id: 'parceria-gama-1', oscId: GAMA }))
    await db.doc(`oscs/${ALFA}/partnershipEvents/evento-1`).set({ action: 'create', actorUid: 'x' })
    assert.equal((await db.doc(alfaPath).get()).exists, true)
    assert.equal((await db.doc(gamaPath).get()).exists, true)
  })
}

describe('Firestore — parcerias (DEV-02.1)', () => {
  let env: RulesTestEnvironment
  before(async () => { env = await createTestEnvironment() })
  after(async () => { await env.cleanup() })
  beforeEach(() => seed(env))
  const as = (uid: string) => env.authenticatedContext(uid).firestore()
  const operator = PERMISSION_USERS.OPERATOR.uid

  test('T01 (regra) — membro ativo com partnerships.view consulta as parcerias da própria OSC', async () => {
    const doc = await assertSucceeds(as(operator).doc(alfaPath).get())
    assert.equal(doc.data()?.oscId, ALFA)
    const list = await assertSucceeds(as(operator).collection(`oscs/${ALFA}/partnerships`).orderBy('createdAt', 'desc').limit(51).get())
    assert.equal(list.size, 1)
  })

  test('T02/T08 (regra) — sem acesso às parcerias de outra OSC, por documento, lista ou grupo de coleções', async () => {
    await assertFails(as(operator).doc(gamaPath).get())
    await assertFails(as(operator).collection(`oscs/${GAMA}/partnerships`).get())
    await assertFails(as(operator).collectionGroup('partnerships').get())
    // O administrador de GAMA (com permissão) não lê ALFA.
    await assertSucceeds(as(USERS.SINGLE.uid).doc(gamaPath).get())
    await assertFails(as(USERS.SINGLE.uid).doc(alfaPath).get())
  })

  test('Sem permissão individual não há consulta (administrador sem permissões implícitas; delegado; ex-membro)', async () => {
    await assertFails(as(USERS.MULTI.uid).doc(alfaPath).get())
    await assertFails(as(PERMISSION_USERS.DELEGATE.uid).collection(`oscs/${ALFA}/partnerships`).get())
    await env.withSecurityRulesDisabled(async (admin) => {
      await admin.firestore().doc(memberPath({ oscId: ALFA, uid: PERMISSION_USERS.FORMER.uid })).update({ permissions: ['partnerships.view'] })
    })
    await assertFails(as(PERMISSION_USERS.FORMER.uid).doc(alfaPath).get())
    await assertFails(env.unauthenticatedContext().firestore().doc(alfaPath).get())
  })

  test('T14 (regra) — suspensão comercial: somente o administrador com a permissão mantém a consulta', async () => {
    await env.withSecurityRulesDisabled(async (admin) => {
      const db = admin.firestore()
      await db.doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'suspended' })
      await db.doc(memberPath({ oscId: ALFA, uid: USERS.MULTI.uid })).update({ permissions: ['partnerships.view'] })
    })
    await assertFails(as(operator).doc(alfaPath).get())
    await assertSucceeds(as(USERS.MULTI.uid).doc(alfaPath).get())
    await assertSucceeds(as(USERS.MULTI.uid).collection(`oscs/${ALFA}/partnerships`).get())
  })

  test('T13 (regra) — nenhuma escrita pelo cliente, mesmo com permissão e com campos forjados', async () => {
    const forged = partnershipDocument({ id: 'nova', oscId: ALFA })
    for (const uid of [operator, USERS.MULTI.uid, PERMISSION_USERS.DELEGATE.uid]) {
      await assertFails(as(uid).doc(`oscs/${ALFA}/partnerships/nova`).set(forged))
      await assertFails(as(uid).collection(`oscs/${ALFA}/partnerships`).add(forged))
      await assertFails(as(uid).doc(alfaPath).update({ administrativeStatus: 'arquivada' }))
      await assertFails(as(uid).doc(alfaPath).delete())
    }
  })

  test('DEV-02.1-C01 — permissões de cadastro/edição não liberam escrita direta nem leitura sem partnerships.view', async () => {
    await env.withSecurityRulesDisabled(async (admin) => {
      await admin.firestore().doc(memberPath({ oscId: ALFA, uid: PERMISSION_USERS.DELEGATE.uid })).update({ permissions: ['partnerships.create', 'partnerships.edit'] })
      await admin.firestore().doc(`oscs/${ALFA}/partnershipRequests/${operator}_pedido-1`).set({ partnershipId: 'parceria-alfa-1' })
    })
    const db = as(PERMISSION_USERS.DELEGATE.uid)
    await assertFails(db.doc(alfaPath).get()) // create/edit não implicam consulta (DEC-PAR-001)
    await assertFails(db.collection(`oscs/${ALFA}/partnerships`).add(partnershipDocument({ id: 'x', oscId: ALFA })))
    await assertFails(db.doc(alfaPath).update({ object: 'alterado' }))
    await assertFails(as(operator).doc(`oscs/${ALFA}/partnershipRequests/${operator}_pedido-1`).get())
    await assertFails(as(operator).doc(`oscs/${ALFA}/partnershipRequests/${operator}_pedido-2`).set({ partnershipId: 'x' }))
  })

  test('DEV-02.2-T01/T02 (regra) — Plano: leitura só com work-plan.view, na própria OSC; nenhuma escrita', async () => {
    const alfaPlan = workPlanPath(ALFA, 'parceria-alfa-1')
    const gamaPlan = workPlanPath(GAMA, 'parceria-gama-1')
    await env.withSecurityRulesDisabled(async (admin) => {
      const db = admin.firestore()
      await db.doc(alfaPlan).set(workPlanDocument({ oscId: ALFA, partnershipId: 'parceria-alfa-1' }))
      await db.doc(gamaPlan).set(workPlanDocument({ oscId: GAMA, partnershipId: 'parceria-gama-1' }))
      await db.doc(`oscs/${ALFA}/workPlanEvents/e1`).set({ action: 'start' })
      await db.doc(memberPath({ oscId: ALFA, uid: PERMISSION_USERS.DELEGATE.uid })).update({ permissions: ['work-plan.view', 'work-plan.edit', 'work-plan.finalize'] })
      await db.doc(memberPath({ oscId: GAMA, uid: USERS.SINGLE.uid })).update({ permissions: ['partnerships.view', 'work-plan.view'] })
    })
    // Operador só com partnerships.view: não lê o Plano (competências independentes).
    await assertFails(as(operator).doc(alfaPlan).get())
    const delegate = as(PERMISSION_USERS.DELEGATE.uid)
    await assertSucceeds(delegate.doc(alfaPlan).get())
    await assertSucceeds(delegate.collection(`oscs/${ALFA}/partnerships/parceria-alfa-1/workPlans`).get())
    await assertFails(delegate.doc(gamaPlan).get()) // outra OSC
    await assertFails(delegate.collectionGroup('workPlans').get())
    // edit/finalize não liberam escrita direta (somente servidor).
    await assertFails(delegate.doc(alfaPlan).update({ registrationStatus: 'finalized' }))
    await assertFails(delegate.doc(workPlanPath(ALFA, 'parceria-alfa-1').replace('original', 'outro')).set({ ok: true }))
    await assertFails(delegate.doc(alfaPlan).delete())
    await assertFails(delegate.doc(`oscs/${ALFA}/workPlanEvents/e1`).get())
    await assertSucceeds(as(USERS.SINGLE.uid).doc(gamaPlan).get())
    await assertFails(as(USERS.SINGLE.uid).doc(alfaPlan).get())
    // Suspensão comercial: só o administrador com a permissão mantém a consulta.
    await env.withSecurityRulesDisabled(async (admin) => {
      await admin.firestore().doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'suspended' })
    })
    await assertFails(delegate.doc(alfaPlan).get())
  })

  test('DEV-02.3 (regra) — versões posteriores: leitura com work-plan.view na própria OSC; nenhuma escrita direta', async () => {
    const v2 = `oscs/${ALFA}/partnerships/parceria-alfa-1/workPlans/v2`
    await env.withSecurityRulesDisabled(async (admin) => {
      const db = admin.firestore()
      await db.doc(v2).set({ ...workPlanDocument({ oscId: ALFA, partnershipId: 'parceria-alfa-1' }), id: 'v2', activation: { status: 'pending-decision' } })
      await db.doc(memberPath({ oscId: ALFA, uid: PERMISSION_USERS.DELEGATE.uid })).update({ permissions: ['work-plan.view', 'work-plan.edit'] })
    })
    const delegate = as(PERMISSION_USERS.DELEGATE.uid)
    await assertSucceeds(delegate.doc(v2).get())
    const list = await assertSucceeds(delegate.collection(`oscs/${ALFA}/partnerships/parceria-alfa-1/workPlans`).get())
    assert.equal(list.size, 1)
    await assertFails(as(operator).doc(v2).get()) // sem work-plan.view
    await assertFails(delegate.doc(v2).update({ activation: { status: 'active' } }))
    await assertFails(delegate.doc(`oscs/${ALFA}/partnerships/parceria-alfa-1/workPlans/v3`).set({ id: 'v3' }))
    await assertFails(delegate.doc(v2).delete())
    await assertFails(as(USERS.SINGLE.uid).doc(v2).get()) // outra OSC
  })

  test('DEV-02.4 (regra) — metas e indicadores: leitura com work-plan.view; nenhuma escrita pelo navegador; sem acesso entre OSCs', async () => {
    const base = `oscs/${ALFA}/partnerships/parceria-alfa-1/workPlans/original`
    const goal = `${base}/goals/g_0123456789abcdef0123`
    const indicator = `${base}/indicators/i_0123456789abcdef0123`
    await env.withSecurityRulesDisabled(async (admin) => {
      const db = admin.firestore()
      await db.doc(base).set(workPlanDocument({ oscId: ALFA, partnershipId: 'parceria-alfa-1' }))
      await db.doc(goal).set({ id: 'g_0123456789abcdef0123', kind: 'goal', oscId: ALFA, data: { code: 'Meta 01' } })
      await db.doc(indicator).set({ id: 'i_0123456789abcdef0123', kind: 'indicator', oscId: ALFA, data: { code: 'IND-01' } })
      await db.doc(`oscs/${GAMA}/partnerships/parceria-gama-1/workPlans/original/goals/g_0123456789abcdef0123`).set({ id: 'x' })
      await db.doc(memberPath({ oscId: ALFA, uid: PERMISSION_USERS.DELEGATE.uid })).update({ permissions: ['work-plan.view', 'work-plan.edit'] })
    })
    const delegate = as(PERMISSION_USERS.DELEGATE.uid)
    await assertSucceeds(delegate.doc(goal).get())
    await assertSucceeds(delegate.doc(indicator).get())
    assert.equal((await assertSucceeds(delegate.collection(`${base}/goals`).get())).size, 1)
    await assertFails(as(operator).doc(goal).get()) // sem work-plan.view
    for (const path of [goal, indicator]) {
      await assertFails(delegate.doc(path).update({ data: { code: 'X' } }))
      await assertFails(delegate.doc(path).delete())
    }
    await assertFails(delegate.doc(`${base}/goals/g_ffffffffffffffffffff`).set({ id: 'g_ffffffffffffffffffff' }))
    await assertFails(delegate.collection(`${base}/indicators`).add({ data: {} }))
    await assertFails(delegate.doc(`oscs/${GAMA}/partnerships/parceria-gama-1/workPlans/original/goals/g_0123456789abcdef0123`).get())
    await assertFails(as(USERS.SINGLE.uid).doc(goal).get()) // outra OSC
  })

  test('DEV-02.4-C01 (regra) — incorporação e conferência: navegador não grava estado excepcional', async () => {
    const plan = `oscs/${ALFA}/partnerships/parceria-alfa-1/workPlans/original`
    await env.withSecurityRulesDisabled(async (admin) => {
      await admin.firestore().doc(plan).set({ ...workPlanDocument({ oscId: ALFA, partnershipId: 'parceria-alfa-1', status: 'finalized' }) })
      await admin.firestore().doc(memberPath({ oscId: ALFA, uid: PERMISSION_USERS.DELEGATE.uid })).update({ permissions: ['work-plan.view', 'work-plan.edit'] })
    })
    const delegate = as(PERMISSION_USERS.DELEGATE.uid)
    await assertSucceeds(delegate.doc(plan).get())
    await assertFails(delegate.doc(plan).update({ complementaryTranscription: { status: 'open' } }))
    await assertFails(delegate.doc(plan).update({ componentReview: { goals: { status: 'transcribed' } } }))
    await assertFails(delegate.doc(`${plan}/goals/g_0123456789abcdef0123`).set({ data: {} }))
  })

  test('DEV-02.5 (regra) — planejamento financeiro: leitura com work-plan.view; nenhuma escrita; sem acesso entre OSCs', async () => {
    const base = `oscs/${ALFA}/partnerships/parceria-alfa-1/workPlans/original`
    const category = `${base}/financialCategories/c_0123456789abcdef0123`
    const item = `${base}/financialItems/f_0123456789abcdef0123`
    await env.withSecurityRulesDisabled(async (admin) => {
      const db = admin.firestore()
      await db.doc(base).set(workPlanDocument({ oscId: ALFA, partnershipId: 'parceria-alfa-1' }))
      await db.doc(category).set({ id: 'c_0123456789abcdef0123', oscId: ALFA, data: { code: 'C1' } })
      await db.doc(item).set({ id: 'f_0123456789abcdef0123', oscId: ALFA, data: { code: 'F1' } })
      await db.doc(memberPath({ oscId: ALFA, uid: PERMISSION_USERS.DELEGATE.uid })).update({ permissions: ['work-plan.view', 'work-plan.edit', 'financial.view'] })
      await db.doc(memberPath({ oscId: ALFA, uid: PERMISSION_USERS.OPERATOR.uid })).update({ permissions: ['financial.view'] })
    })
    const delegate = as(PERMISSION_USERS.DELEGATE.uid)
    await assertSucceeds(delegate.doc(category).get())
    assert.equal((await assertSucceeds(delegate.collection(`${base}/financialItems`).get())).size, 1)
    await assertFails(as(PERMISSION_USERS.OPERATOR.uid).doc(item).get()) // financial.view não substitui work-plan.view
    for (const path of [category, item]) {
      await assertFails(delegate.doc(path).update({ data: { code: 'X' } }))
      await assertFails(delegate.doc(path).delete())
    }
    await assertFails(delegate.collection(`${base}/financialItems`).add({ data: {} }))
    await assertFails(as(USERS.SINGLE.uid).doc(item).get())
  })

  test('Auditoria de parcerias ilegível e não gravável pelo cliente', async () => {
    await assertFails(as(operator).doc(`oscs/${ALFA}/partnershipEvents/evento-1`).get())
    await assertFails(as(operator).collection(`oscs/${ALFA}/partnershipEvents`).get())
    await assertFails(as(USERS.MULTI.uid).collection(`oscs/${ALFA}/partnershipEvents`).add({ action: 'create' }))
  })
})
