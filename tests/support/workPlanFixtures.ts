/** Dados FICTÍCIOS do Plano de Trabalho estruturado (DEV-02.2/02.3) — somente emuladores e testes. */
import { emptyValues, type WorkPlanValues } from '../../src/domain/workPlans.ts'

const CREATED = new Date('2026-05-01T12:00:00Z')

export interface WorkPlanFixture {
  oscId: string
  partnershipId: string
  status?: 'in-registration' | 'finalized'
  values?: Partial<WorkPlanValues>
  revision?: number
  /** DEV-02.3: sequência formal (1 = original). */
  sequence?: number
  formalAct?: Record<string, unknown>
  /** `activation.status` gravado (padrão: em cadastramento → awaiting-finalization; finalizada → active). */
  activation?: string | null
  createdBy?: string
}

export function workPlanDocument(p: WorkPlanFixture) {
  const finalized = p.status === 'finalized'
  const sequence = p.sequence ?? 1
  const id = sequence === 1 ? 'original' : `v${sequence}`
  return {
    schemaVersion: 1,
    id,
    oscId: p.oscId,
    partnershipId: p.partnershipId,
    origin:
      sequence === 1
        ? { kind: 'approved-plan-registration', formalVersion: false, sequence: 1, sourceWorkPlanId: null }
        : { kind: 'formal-alteration', formalVersion: true, sequence, sourceWorkPlanId: 'original', previousWorkPlanId: sequence === 2 ? 'original' : `v${sequence - 1}`, baseRevision: 3 },
    ...(sequence > 1
      ? {
          formalAct: { type: 'termo-aditivo', typeDescription: null, reference: '1º Termo Aditivo', actDate: '2026-09-01', description: 'Ampliação fictícia do público.', effectiveDate: null, declaredBy: 'uid-ficticio-operator', declaredAt: CREATED, automatedVerification: false, ...p.formalAct },
          activation: { status: p.activation === undefined ? (finalized ? 'active' : 'awaiting-finalization') : p.activation },
        }
      : p.activation
        ? { activation: { status: p.activation } }
        : {}),
    registrationStatus: p.status ?? 'in-registration',
    values: { ...emptyValues(), ...p.values },
    document: { status: 'not-stored', storagePath: null },
    revision: p.revision ?? 1,
    startRequestId: `req-${p.partnershipId}`,
    createdAt: CREATED,
    createdBy: p.createdBy ?? 'uid-ficticio-operator',
    updatedAt: CREATED,
    updatedBy: p.createdBy ?? 'uid-ficticio-operator',
    ...(finalized ? { finalizedAt: CREATED, finalizedBy: 'uid-ficticio-operator', finalizationRequestId: 'req-final' } : {}),
  }
}

export const workPlanPath = (oscId: string, partnershipId: string, id = 'original') => `oscs/${oscId}/partnerships/${partnershipId}/workPlans/${id}`
