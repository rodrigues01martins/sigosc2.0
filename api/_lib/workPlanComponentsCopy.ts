/**
 * Cópia dos componentes de planejamento (metas e indicadores) para nova versão (DEV-02.4).
 * Módulo separado para não criar dependência circular com `workPlansService.ts`.
 */
import type { DocumentReference, DocumentSnapshot, FieldValue, Transaction } from 'firebase-admin/firestore'
import { LIMITS, validateGoal, validateIndicator, type GoalData, type IndicatorData, type Stored } from '../../src/domain/workPlanComponents.ts'

/**
 * Cópia INTEGRAL dos componentes na criação de nova versão (DEC-034): mesmos IDs lógicos, dados
 * idênticos, revisão reiniciada e origem registrada. Chamado dentro da transação de `create-version`
 * (leituras antes das escritas). Os documentos da versão anterior não são tocados.
 */
export async function readComponentsForCopy(tx: Transaction, planRef: DocumentReference) {
  const [goals, indicators] = await Promise.all([
    tx.get(planRef.collection('goals').limit(LIMITS.goalsPerVersion + 1)),
    tx.get(planRef.collection('indicators').limit(LIMITS.indicatorsPerVersion + 1)),
  ])
  return { goals: goals.docs, indicators: indicators.docs }
}

export function copyComponents(
  tx: Transaction,
  source: { goals: DocumentSnapshot[]; indicators: DocumentSnapshot[] },
  target: DocumentReference,
  meta: { oscId: string; partnershipId: string; workPlanId: string; baseWorkPlanId: string; uid: string; now: FieldValue },
) {
  for (const [collection, docs] of [['goals', source.goals], ['indicators', source.indicators]] as const) {
    for (const d of docs) {
      tx.create(target.collection(collection).doc(d.id), {
        id: d.id,
        kind: d.get('kind'),
        oscId: meta.oscId,
        partnershipId: meta.partnershipId,
        workPlanId: meta.workPlanId,
        data: d.get('data'),
        revision: 1,
        inheritedFrom: { workPlanId: meta.baseWorkPlanId, revision: d.get('revision') ?? 1 },
        createdAt: meta.now,
        createdBy: meta.uid,
        updatedAt: meta.now,
        updatedBy: meta.uid,
        lastUpdateRequestId: null,
        creationRequestId: null,
      })
    }
  }
  return source.goals.length + source.indicators.length
}

/**
 * Componentes relidos e REVALIDADOS (conferência da finalização e do encerramento da incorporação).
 * Qualquer documento fora do formato → `null` (a operação é recusada; nada é presumido).
 */
export function storedComponents(source: { goals: DocumentSnapshot[]; indicators: DocumentSnapshot[] }): { goals: Stored<GoalData>[]; indicators: Stored<IndicatorData>[] } | null {
  const known = new Set(source.goals.map((d) => d.id))
  const revisionOf = (d: DocumentSnapshot) => {
    const r: unknown = d.get('revision')
    return typeof r === 'number' && Number.isSafeInteger(r) && r >= 1 ? r : 1
  }
  const goals: Stored<GoalData>[] = []
  for (const d of source.goals) {
    const v = validateGoal(d.get('data'))
    if (!v.ok) return null
    goals.push({ id: d.id, kind: 'goal', data: v.data, revision: revisionOf(d) })
  }
  const indicators: Stored<IndicatorData>[] = []
  for (const d of source.indicators) {
    const v = validateIndicator(d.get('data'), known)
    if (!v.ok) return null
    indicators.push({ id: d.id, kind: 'indicator', data: v.data, revision: revisionOf(d) })
  }
  return { goals, indicators }
}
