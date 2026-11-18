import type { WorkPlanRegistrationStatus, WorkPlanValues } from '../../domain/workPlans.ts'
import type { PartnershipErrorKind } from '../partnerships/types.ts'

/**
 * Registro estruturado do Plano de Trabalho aprovado (DEV-02.2), lido de
 * `oscs/{oscId}/partnerships/{partnershipId}/workPlans/original`. Somente LEITURA pelo cliente.
 */
export interface WorkPlan {
  readonly id: string
  readonly oscId: string
  readonly partnershipId: string
  readonly registrationStatus: WorkPlanRegistrationStatus
  readonly values: WorkPlanValues
  /** Documento aprovado: armazenamento indisponível nesta versão. */
  readonly documentStatus: 'not-stored'
  readonly revision: number
  readonly createdAt: Date | null
  readonly createdBy: string | null
  readonly updatedAt: Date | null
  readonly updatedBy: string | null
  readonly finalizedAt: Date | null
  readonly finalizedBy: string | null
}

export type WorkPlanResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: PartnershipErrorKind }

export interface WorkPlanService {
  readonly available: boolean
  /** `null` = Plano ainda não estruturado no SIGOSC. */
  get(oscId: string, partnershipId: string): Promise<WorkPlanResult<WorkPlan | null>>
}
