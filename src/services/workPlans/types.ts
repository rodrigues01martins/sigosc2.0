import type { FormalAct, StoredActivationStatus } from '../../domain/workPlanVersions.ts'
import type { WorkPlanRegistrationStatus, WorkPlanValues } from '../../domain/workPlans.ts'
import type { PartnershipErrorKind } from '../partnerships/types.ts'

/**
 * Registro estruturado do Plano de Trabalho aprovado (DEV-02.2), lido de
 * `oscs/{oscId}/partnerships/{partnershipId}/workPlans/original`. Somente LEITURA pelo cliente.
 */
export interface WorkPlan {
  /** `original`, `v2`, `v3`… (DEV-02.3). */
  readonly id: string
  /** Sequência FORMAL na cadeia de versões (1 = original); distinta da `revision` técnica. */
  readonly sequence: number
  readonly previousWorkPlanId: string | null
  /** Ato formal declarado (somente versões posteriores). */
  readonly formalAct: (FormalAct & { readonly declaredBy: string | null; readonly declaredAt: Date | null }) | null
  /** Situação de ativação GRAVADA pelo servidor (DEC-PT-003); a original só grava `superseded`. */
  readonly activationStatus: StoredActivationStatus | null
  /** Metadados de vigência cadastral (hora do SERVIDOR); não representam eficácia jurídica. */
  readonly activation: {
    readonly activatedAt: Date | null
    readonly supersededWorkPlanId: string | null
    readonly supersededAt: Date | null
    readonly supersededByWorkPlanId: string | null
  }
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
  /** Todas as versões da parceria, em ordem de sequência (lista vazia = não estruturado). */
  listVersions(oscId: string, partnershipId: string): Promise<WorkPlanResult<readonly WorkPlan[]>>
}
