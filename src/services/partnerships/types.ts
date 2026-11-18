import type { AdministrativeStatus, GlobalValueStatus, InstrumentId } from '../../domain/partnerships.ts'
import type { OrganizationErrorKind } from '../organizations/types.ts'

/**
 * Parceria formalizada (DEV-02.1), lida de `oscs/{oscId}/partnerships/{id}`.
 * Somente LEITURA pelo cliente: as Security Rules exigem a permissão de consulta.
 */
export interface Partnership {
  readonly id: string
  readonly oscId: string
  readonly instrument: InstrumentId
  readonly instrumentNumber: string
  readonly publicPartner: string
  readonly object: string
  readonly administrativeProcess: string | null
  readonly formalizationDate: string
  readonly termStart: string
  readonly termEnd: string
  /** DEC-PAR-005: informado, não informado ou não aplicável (AC) — nunca confundidos com zero. */
  readonly globalValueStatus: GlobalValueStatus
  /** Centavos somente quando `informed`. */
  readonly globalValueCents: number | null
  readonly administrativeStatus: AdministrativeStatus
  /** DEC-PAR-006: situação declarada no cadastro (data e autor), quando registrada. */
  readonly administrativeStatusDeclaredAt: Date | null
  readonly administrativeStatusDeclaredBy: string | null
  /** Revisão para alteração cadastral com controle de concorrência (documentos antigos = 1). */
  readonly revision: number
  /** O Plano de Trabalho aprovado foi DECLARADO no cadastro; o documento não está no SIGOSC. */
  readonly workPlanApprovalDeclared: boolean
  readonly createdAt: Date | null
  readonly createdBy: string | null
  readonly updatedAt: Date | null
  readonly updatedBy: string | null
}

export type PartnershipErrorKind = OrganizationErrorKind

export type PartnershipResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: PartnershipErrorKind }

/** Página de resultados: `next` é um cursor opaco (ou `null` quando não há mais registros). */
export interface PartnershipPage {
  readonly items: readonly Partnership[]
  readonly next: unknown
}

export interface PartnershipService {
  readonly available: boolean
  listPage(oscId: string, cursor: unknown): Promise<PartnershipResult<PartnershipPage>>
  get(oscId: string, partnershipId: string): Promise<PartnershipResult<Partnership | null>>
}

/** Identificadores de documento aceitos na URL (formato do Firestore, sem barras). */
export const PARTNERSHIP_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
