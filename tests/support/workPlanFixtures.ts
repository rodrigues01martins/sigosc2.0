/** Dados FICTÍCIOS do Plano de Trabalho estruturado (DEV-02.2) — somente emuladores e testes. */
import { emptyValues, type WorkPlanValues } from '../../src/domain/workPlans.ts'

const CREATED = new Date('2026-05-01T12:00:00Z')

export function workPlanDocument(p: { oscId: string; partnershipId: string; status?: 'in-registration' | 'finalized'; values?: Partial<WorkPlanValues>; revision?: number }) {
  const finalized = p.status === 'finalized'
  return {
    schemaVersion: 1,
    id: 'original',
    oscId: p.oscId,
    partnershipId: p.partnershipId,
    origin: { kind: 'approved-plan-registration', formalVersion: false, sequence: 1, sourceWorkPlanId: null },
    registrationStatus: p.status ?? 'in-registration',
    values: { ...emptyValues(), ...p.values },
    document: { status: 'not-stored', storagePath: null },
    revision: p.revision ?? 1,
    startRequestId: `req-${p.partnershipId}`,
    createdAt: CREATED,
    createdBy: 'uid-ficticio-operator',
    updatedAt: CREATED,
    updatedBy: 'uid-ficticio-operator',
    ...(finalized ? { finalizedAt: CREATED, finalizedBy: 'uid-ficticio-operator', finalizationRequestId: 'req-final' } : {}),
  }
}

export const workPlanPath = (oscId: string, partnershipId: string) => `oscs/${oscId}/partnerships/${partnershipId}/workPlans/original`
