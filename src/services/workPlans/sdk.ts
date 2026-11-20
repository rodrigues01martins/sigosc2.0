/** Adaptador do Firestore — Plano de Trabalho (DEV-02.2/02.3). SOMENTE LEITURAS no servidor (sem cache ou escrita). */
import { collection, doc, getDocFromServer, getDocsFromServer, limit, query, type Firestore } from 'firebase/firestore'
import { LIMITS } from '../../domain/workPlanComponents.ts'
import { FIN_LIMITS } from '../../domain/workPlanFinancial.ts'
import { ORIGINAL_WORK_PLAN_ID } from '../../domain/workPlans.ts'
import type { WorkPlansSdk } from './workPlanService.ts'

export const firestoreWorkPlansSdk: WorkPlansSdk<Firestore> = {
  async getWorkPlan(db, oscId, partnershipId) {
    const snapshot = await getDocFromServer(doc(db, 'oscs', oscId, 'partnerships', partnershipId, 'workPlans', ORIGINAL_WORK_PLAN_ID))
    return snapshot.exists() ? { path: snapshot.ref.path, data: snapshot.data() } : null
  },
  async listWorkPlans(db, oscId, partnershipId) {
    const snapshot = await getDocsFromServer(query(collection(db, 'oscs', oscId, 'partnerships', partnershipId, 'workPlans'), limit(200)))
    return snapshot.docs.map((d) => ({ path: d.ref.path, data: d.data() }))
  },
  async listComponents(db, oscId, partnershipId, workPlanId) {
    const base = ['oscs', oscId, 'partnerships', partnershipId, 'workPlans', workPlanId] as const
    const [goals, indicators] = await Promise.all([
      getDocsFromServer(query(collection(db, ...base, 'goals'), limit(LIMITS.goalsPerVersion))),
      getDocsFromServer(query(collection(db, ...base, 'indicators'), limit(LIMITS.indicatorsPerVersion))),
    ])
    const raw = (s: typeof goals) => s.docs.map((d) => ({ path: d.ref.path, data: d.data() }))
    return { goals: raw(goals), indicators: raw(indicators) }
  },
  async listFinancial(db, oscId, partnershipId, workPlanId) {
    const base = ['oscs', oscId, 'partnerships', partnershipId, 'workPlans', workPlanId] as const
    const [categories, items] = await Promise.all([
      getDocsFromServer(query(collection(db, ...base, 'financialCategories'), limit(FIN_LIMITS.categoriesPerVersion))),
      getDocsFromServer(query(collection(db, ...base, 'financialItems'), limit(FIN_LIMITS.itemsPerVersion))),
    ])
    const raw = (s: typeof categories) => s.docs.map((d) => ({ path: d.ref.path, data: d.data() }))
    return { categories: raw(categories), items: raw(items) }
  },
}
