/** Adaptador do Firestore — Plano de Trabalho (DEV-02.2). SOMENTE uma leitura no servidor (sem cache ou escrita). */
import { doc, getDocFromServer, type Firestore } from 'firebase/firestore'
import { ORIGINAL_WORK_PLAN_ID } from '../../domain/workPlans.ts'
import type { WorkPlansSdk } from './workPlanService.ts'

export const firestoreWorkPlansSdk: WorkPlansSdk<Firestore> = {
  async getWorkPlan(db, oscId, partnershipId) {
    const snapshot = await getDocFromServer(doc(db, 'oscs', oscId, 'partnerships', partnershipId, 'workPlans', ORIGINAL_WORK_PLAN_ID))
    return snapshot.exists() ? { path: snapshot.ref.path, data: snapshot.data() } : null
  },
}
