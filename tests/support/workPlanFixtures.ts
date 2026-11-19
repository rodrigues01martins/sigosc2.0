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
  /** DEV-02.4: metas e indicadores PREVISTOS desta versão (dados fictícios). */
  goals?: readonly ComponentFixture[]
  indicators?: readonly ComponentFixture[]
}

export interface ComponentFixture {
  id: string
  data: Record<string, unknown>
  revision?: number
  inheritedFrom?: string | null
}

/** Meta fictícia completa e válida (sobrescrevível). */
export const goalData = (code: string, extra: Record<string, unknown> = {}) => ({
  code,
  description: `Descrição fictícia da ${code}.`,
  nature: 'quantitative',
  unit: { state: 'informed', value: 'participantes' },
  expectedQuantity: { state: 'informed', value: 200 },
  expectedResult: { state: 'not-informed' },
  completionCriterion: { state: 'not-informed' },
  referencePeriod: { state: 'not-informed' },
  status: 'active',
  order: 0,
  ...extra,
})

/** Indicador fictício completo e válido (sobrescrevível). */
export const indicatorData = (code: string, goalIds: string[] = [], extra: Record<string, unknown> = {}) => ({
  code,
  name: `Indicador fictício ${code}`,
  description: { state: 'not-informed' },
  nature: 'quantitative',
  measurementType: 'percentage',
  unit: { state: 'informed', value: '%' },
  periodicity: { state: 'informed', value: { kind: 'monthly', description: null } },
  target: { state: 'informed', value: 80 },
  expectedParameter: { state: 'not-informed' },
  rule: { method: 'ratio', description: '(concluintes ÷ inscritos) × 100', numerator: 'concluintes', denominator: 'inscritos', multiplier: 100 },
  categories: [],
  classificationCriterion: { state: 'not-informed' },
  verificationSource: { state: 'not-informed' },
  goalIds,
  status: 'active',
  order: 0,
  ...extra,
})

export function componentDocument(kind: 'goal' | 'indicator', c: ComponentFixture, p: { oscId: string; partnershipId: string; workPlanId: string }) {
  return {
    id: c.id,
    kind,
    oscId: p.oscId,
    partnershipId: p.partnershipId,
    workPlanId: p.workPlanId,
    data: c.data,
    revision: c.revision ?? 1,
    inheritedFrom: c.inheritedFrom ? { workPlanId: c.inheritedFrom, revision: 1 } : null,
    createdAt: CREATED,
    createdBy: 'uid-ficticio-operator',
    updatedAt: CREATED,
    updatedBy: 'uid-ficticio-operator',
  }
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
