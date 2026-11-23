/**
 * DEV-UXPT-01 — CARACTERIZAÇÃO das Security Rules sobre documentos LEGADOS do Plano (`npm run test:rules`).
 *
 * Registra que todos os estados persistidos hoje (cadastramento, finalizado, substituído, versão legada
 * "pending-decision", incorporações abertas/encerradas) são LEGÍVEIS com `work-plan.view` na própria OSC
 * e que NENHUM pode ser alterado, "desfinalizado", ativado ou excluído pelo navegador. A UX-PT-02 não
 * altera as regras (DEC-UXPT-02.5); estes testes protegem essa premissa.
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { MEMBERS, OSCS, USERS, memberDocument, memberPath, oscDocument, oscPath } from '../support/organizationFixtures.ts'
import { PERMISSION_MEMBERS, PERMISSION_USERS } from '../support/permissionFixtures.ts'
import { partnershipDocument } from '../support/partnershipFixtures.ts'
import { componentDocument, goalData, workPlanDocument, workPlanPath } from '../support/workPlanFixtures.ts'
import { createTestEnvironment } from './setup.ts'

const ALFA = OSCS.ALFA.id
const GAMA = OSCS.GAMA.id
const P = 'parceria-legado-1'
const PG = 'parceria-legado-gama'
const OPERATOR = PERMISSION_USERS.OPERATOR.uid
const GOAL = 'g_00000000000000000001'

async function seed(env: RulesTestEnvironment) {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore()
    for (const osc of Object.values(OSCS)) await db.doc(oscPath(osc)).set(oscDocument(osc))
    for (const member of [...MEMBERS, ...PERMISSION_MEMBERS]) await db.doc(memberPath(member)).set(memberDocument(member))
    await db.doc(memberPath({ oscId: ALFA, uid: OPERATOR })).update({ permissions: ['partnerships.view', 'work-plan.view', 'work-plan.edit'] })
    await db.doc(`oscs/${ALFA}/partnerships/${P}`).set(partnershipDocument({ id: P, oscId: ALFA }))
    await db.doc(`oscs/${GAMA}/partnerships/${PG}`).set(partnershipDocument({ id: PG, oscId: GAMA }))
    // Original finalizada e substituída, com incorporações encerradas; v2 legada; v3 ativa; v4 em cadastramento.
    await db.doc(workPlanPath(ALFA, P)).set(workPlanDocument({ oscId: ALFA, partnershipId: P, status: 'finalized', activation: 'superseded', transcription: { status: 'closed' }, financialTranscription: { status: 'closed' } }))
    await db.doc(workPlanPath(ALFA, P, 'v2')).set(workPlanDocument({ oscId: ALFA, partnershipId: P, sequence: 2, status: 'finalized', activation: 'pending-decision' }))
    await db.doc(workPlanPath(ALFA, P, 'v3')).set(workPlanDocument({ oscId: ALFA, partnershipId: P, sequence: 3, status: 'finalized', activation: 'active', transcription: { status: 'open' } }))
    await db.doc(workPlanPath(ALFA, P, 'v4')).set(workPlanDocument({ oscId: ALFA, partnershipId: P, sequence: 4 }))
    await db.doc(`${workPlanPath(ALFA, P, 'v3')}/goals/${GOAL}`).set(componentDocument('goal', { id: GOAL, data: goalData('Meta 01'), inheritedFrom: 'v2' }, { oscId: ALFA, partnershipId: P, workPlanId: 'v3' }))
    await db.doc(workPlanPath(GAMA, PG)).set(workPlanDocument({ oscId: GAMA, partnershipId: PG, status: 'finalized' }))
    await db.doc(`oscs/${ALFA}/workPlanEvents/evento-legado`).set({ action: 'finalize', partnershipId: P, actorUid: OPERATOR })
  })
}

describe('Firestore — documentos legados do Plano (DEV-UXPT-01)', () => {
  let env: RulesTestEnvironment
  before(async () => { env = await createTestEnvironment() })
  after(async () => { await env.cleanup() })
  beforeEach(() => seed(env))
  const as = (uid: string) => env.authenticatedContext(uid).firestore()

  test('UXPT01-R01 — todos os estados legados são legíveis com work-plan.view na própria OSC', async () => {
    const db = as(OPERATOR)
    for (const id of ['original', 'v2', 'v3', 'v4']) await assertSucceeds(db.doc(workPlanPath(ALFA, P, id)).get())
    await assertSucceeds(db.collection(`oscs/${ALFA}/partnerships/${P}/workPlans`).get())
    await assertSucceeds(db.doc(`${workPlanPath(ALFA, P, 'v3')}/goals/${GOAL}`).get())
    // Isolamento e ausência de permissões implícitas.
    await assertFails(db.doc(workPlanPath(GAMA, PG)).get())
    await assertFails(as(USERS.MULTI.uid).doc(workPlanPath(ALFA, P)).get())
  })

  test('UXPT01-R02 (LEGADO preservado) — navegador não desfinaliza, ativa, reabre incorporação nem exclui versões', async () => {
    const db = as(OPERATOR)
    await assertFails(db.doc(workPlanPath(ALFA, P)).update({ registrationStatus: 'in-registration' }))
    await assertFails(db.doc(workPlanPath(ALFA, P, 'v2')).update({ 'activation.status': 'active' }))
    await assertFails(db.doc(workPlanPath(ALFA, P)).update({ 'complementaryTranscription.status': 'open' }))
    await assertFails(db.doc(workPlanPath(ALFA, P, 'v4')).update({ 'values.approvalReference': { state: 'informed', value: 'x' } }))
    await assertFails(db.doc(workPlanPath(ALFA, P, 'v4')).delete())
    await assertFails(db.doc(workPlanPath(ALFA, P, 'v5')).set(workPlanDocument({ oscId: ALFA, partnershipId: P, sequence: 5 })))
    await assertFails(db.doc(`${workPlanPath(ALFA, P, 'v3')}/goals/${GOAL}`).delete())
  })

  test('UXPT01-R03 — auditoria do Plano permanece ilegível e imutável pelo navegador', async () => {
    const db = as(OPERATOR)
    await assertFails(db.doc(`oscs/${ALFA}/workPlanEvents/evento-legado`).get())
    await assertFails(db.collection(`oscs/${ALFA}/workPlanEvents`).get())
    await assertFails(db.doc(`oscs/${ALFA}/workPlanEvents/evento-legado`).delete())
    await assertFails(db.doc(`oscs/${ALFA}/workPlanEvents/novo`).set({ action: 'material-correction' }))
  })
})
