/**
 * Tipos da estrutura Multi-Tenant (DEV-01.2).
 *
 * Modelo no Firestore (somente leitura pelo cliente):
 *   oscs/{oscId}                 → dados institucionais mínimos da OSC
 *   oscs/{oscId}/members/{uid}   → vínculo AUTORITATIVO do usuário com a OSC
 *
 * O contexto organizacional exibido na interface NÃO substitui as Security
 * Rules: toda leitura é novamente autorizada pelo Firestore.
 */

export const MEMBERSHIP_STATUSES = ['active', 'inactive'] as const
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number]

/** Situação cadastral/ativação da OSC (definida pela administração da plataforma). */
export const REGISTRATION_STATUSES = ['pending', 'active', 'suspended', 'inactive'] as const
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number]

/** Situação comercial — independente da situação das parcerias. */
export const COMMERCIAL_STATUSES = ['pending', 'active', 'suspended', 'cancelled'] as const
export type CommercialStatus = (typeof COMMERCIAL_STATUSES)[number]

/** Dados institucionais mínimos legíveis por membros ATIVOS. */
export interface OrganizationSummary {
  readonly id: string
  readonly name: string
  readonly registrationStatus: RegistrationStatus
  readonly commercialStatus: CommercialStatus
  /** Campo autoritativo do administrador único (ou `null` se não designado). */
  readonly administratorUid: string | null
}

/** Motivo para um vínculo não poder ser usado como OSC ativa. */
export type UnselectableReason =
  | 'membership-inactive'
  | 'organization-not-active'
  | 'organization-unavailable'

/** Vínculo do usuário autenticado, já validado e enriquecido para a interface. */
export interface Membership {
  readonly oscId: string
  readonly status: MembershipStatus
  /** Somente para vínculos ATIVOS cuja OSC pôde ser lida; caso contrário `null`. */
  readonly organization: OrganizationSummary | null
  /** Derivado EXCLUSIVAMENTE de `oscs/{oscId}.administratorUid` (fonte autoritativa). */
  readonly isAdministrator: boolean
  readonly selectable: boolean
  readonly unselectableReason: UnselectableReason | null
}

export type OrganizationErrorKind =
  /** Regras de segurança negaram a consulta (ex.: regras novas ainda não publicadas). */
  | 'permission-denied'
  | 'network'
  /** Recurso do Firestore ausente no projeto (ex.: índice de grupo de coleções). */
  | 'not-configured'
  | 'unknown'

export type OrganizationResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: OrganizationErrorKind }

export interface OrganizationService {
  /** `false` quando o Firestore não foi inicializado (configuração inválida). */
  readonly available: boolean
  /** Lista os vínculos do usuário diretamente do servidor (nunca do cache). */
  loadMemberships(uid: string): Promise<OrganizationResult<Membership[]>>
  /** Revalida um único vínculo no servidor; `null` se o vínculo não existe mais. */
  revalidateMembership(uid: string, oscId: string): Promise<OrganizationResult<Membership | null>>
}

/** Erros de seleção da OSC ativa. */
export type SelectionErrorKind = 'not-selectable' | 'not-found' | OrganizationErrorKind

/** Estado do contexto organizacional. */
export type OrganizationState =
  | { readonly status: 'signed-out' }
  /** Firestore indisponível (configuração inválida). */
  | { readonly status: 'unavailable' }
  | { readonly status: 'loading'; readonly uid: string }
  | { readonly status: 'error'; readonly uid: string; readonly error: OrganizationErrorKind }
  | {
      readonly status: 'ready'
      readonly uid: string
      readonly memberships: readonly Membership[]
      readonly activeOscId: string | null
      /** OSC em revalidação durante a troca de contexto. */
      readonly pendingOscId: string | null
      readonly selectionError: SelectionErrorKind | null
    }
