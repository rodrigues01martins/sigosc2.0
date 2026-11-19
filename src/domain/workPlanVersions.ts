/**
 * Versionamento do Plano de Trabalho aprovado (DEV-02.3) — puro e sem dependências.
 *
 * DEC-034: alteração FORMAL de componentes do Plano gera nova versão INTEGRAL, preservando as
 * anteriores e permitindo identificar as diferenças. DEC-039: registros futuros referenciam a
 * versão de origem. DEC-038: finalização interna ≠ aprovação jurídica.
 *
 * Três operações distintas (nunca o mesmo fluxo):
 *  A. edição do cadastro em andamento (não cria versão);
 *  B. correção de erro material (DEC-PT-002; não cria versão);
 *  C. nova versão por alteração formal (este módulo).
 *
 * Fontes: HF-G05 / PAG-OSC05 (JOR-06): "Registro de alteração já formalizada", "Ato formal: aditivo
 * ou apostilamento (obrigatório)", "Data da formalização (obrigatório)". O momento em que uma nova
 * versão passa a ser VIGENTE não está expressamente homologado: a ativação fica protegida.
 */
import { DENIAL_MESSAGE, evaluate, type AuthorizationContext } from './authorization.ts'
import { allowsNewOperationalRecords, isValidDate, type AdministrativeStatus } from './partnerships.ts'
import {
  EDIT_PERMISSION,
  FIELD_DEFINITIONS,
  FIELD_IDS,
  ORIGINAL_WORK_PLAN_ID,
  WORK_PLAN_MESSAGE,
  checkFinalization,
  type FieldValue,
  type FinalizationCheck,
  type PartnershipFacts,
  type WorkPlanDecision,
  type WorkPlanDenial,
  type WorkPlanField,
  type WorkPlanRegistrationStatus,
  type WorkPlanValues,
} from './workPlans.ts'

// ---------------------------------------------------------------------------
// Identificação das versões
// ---------------------------------------------------------------------------

/**
 * Sequência FORMAL da cadeia (1 = original, 2, 3…), distinta da `revision` técnica de cada
 * documento (concorrência). IDs estáveis e determinísticos: `original`, `v2`, `v3`…
 */
export const VERSION_ID_PATTERN = /^(original|v([2-9]|[1-9]\d{1,3}))$/

export function versionIdFor(sequence: number): string {
  return sequence === 1 ? ORIGINAL_WORK_PLAN_ID : `v${sequence}`
}

export function isVersionId(value: unknown): value is string {
  return typeof value === 'string' && VERSION_ID_PATTERN.test(value)
}

export function versionLabel(sequence: number): string {
  return sequence === 1 ? 'Versão original' : `Versão ${sequence}`
}

// ---------------------------------------------------------------------------
// Ato formal (informação DECLARADA pelo usuário; não validada pelo SIGOSC)
// ---------------------------------------------------------------------------

/** HF-G05: "aditivo ou apostilamento"; "outro ato formal" evita presumir que toda alteração é aditivo. */
export const FORMAL_ACT_TYPES = [
  { id: 'termo-aditivo', label: 'Termo aditivo' },
  { id: 'apostilamento', label: 'Apostilamento' },
  { id: 'outro-ato', label: 'Outro ato formal' },
] as const
export type FormalActType = (typeof FORMAL_ACT_TYPES)[number]['id']

export function formalActTypeLabel(type: FormalActType, description: string | null): string {
  return type === 'outro-ato' && description ? description : (FORMAL_ACT_TYPES.find((t) => t.id === type)?.label ?? type)
}

export const FORMAL_ACT_LIMITS = { typeDescription: 120, reference: 120, description: 4000 } as const

export interface FormalAct {
  readonly type: FormalActType
  /** Obrigatória somente quando `type` = "outro-ato". */
  readonly typeDescription: string | null
  readonly reference: string | null
  /** Data do ato ou de sua aprovação (H: "Data da formalização", obrigatória). */
  readonly actDate: string
  readonly description: string | null
  /** Data de produção de efeitos, apenas quando constar do documento. */
  readonly effectiveDate: string | null
}

export const FORMAL_ACT_FIELDS = ['type', 'typeDescription', 'reference', 'actDate', 'description', 'effectiveDate'] as const
export type FormalActField = (typeof FORMAL_ACT_FIELDS)[number]
export type FormalActErrorCode = 'required' | 'invalid' | 'invalid-date' | 'in-future' | 'too-long'

// eslint-disable-next-line no-control-regex -- recusa intencional de caracteres de controle
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u2028\\u2029]')

function optionalText(raw: unknown, max: number, multiline = false): { value: string | null; error: FormalActErrorCode | null } {
  if (raw === undefined || raw === null || raw === '') return { value: null, error: null }
  if (typeof raw !== 'string') return { value: null, error: 'invalid' }
  const text = multiline ? raw.trim() : raw.trim().replace(/\s+/g, ' ')
  if (text === '') return { value: null, error: null }
  if (CONTROL.test(text.replace(/[\n\r\t]/g, ' '))) return { value: null, error: 'invalid' }
  if (text.length > max) return { value: null, error: 'too-long' }
  return { value: text, error: null }
}

export type FormalActValidation =
  | { readonly ok: true; readonly act: FormalAct }
  | { readonly ok: false; readonly errors: Partial<Record<FormalActField | 'formalAct', FormalActErrorCode>> }

export function validateFormalAct(input: unknown, today: string): FormalActValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, errors: { formalAct: 'required' } }
  const raw = input as Record<string, unknown>
  if (!Object.keys(raw).every((k) => (FORMAL_ACT_FIELDS as readonly string[]).includes(k))) return { ok: false, errors: { formalAct: 'invalid' } }
  const errors: Partial<Record<FormalActField, FormalActErrorCode>> = {}
  const type = raw.type
  if (type === undefined || type === null || type === '') errors.type = 'required'
  else if (!FORMAL_ACT_TYPES.some((t) => t.id === type)) errors.type = 'invalid'
  const typeDescription = optionalText(raw.typeDescription, FORMAL_ACT_LIMITS.typeDescription)
  if (typeDescription.error) errors.typeDescription = typeDescription.error
  else if (type === 'outro-ato' && !typeDescription.value) errors.typeDescription = 'required'
  const reference = optionalText(raw.reference, FORMAL_ACT_LIMITS.reference)
  if (reference.error) errors.reference = reference.error
  const description = optionalText(raw.description, FORMAL_ACT_LIMITS.description, true)
  if (description.error) errors.description = description.error
  if (!raw.actDate) errors.actDate = 'required'
  else if (!isValidDate(raw.actDate)) errors.actDate = 'invalid-date'
  else if (raw.actDate > today) errors.actDate = 'in-future'
  let effectiveDate: string | null = null
  if (raw.effectiveDate !== undefined && raw.effectiveDate !== null && raw.effectiveDate !== '') {
    if (!isValidDate(raw.effectiveDate)) errors.effectiveDate = 'invalid-date'
    else effectiveDate = raw.effectiveDate
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    act: {
      type: type as FormalActType,
      typeDescription: type === 'outro-ato' ? typeDescription.value : null,
      reference: reference.value,
      actDate: raw.actDate as string,
      description: description.value,
      effectiveDate,
    },
  }
}

export function formalActErrorMessage(field: FormalActField | 'formalAct', code: FormalActErrorCode): string {
  switch (code) {
    case 'required':
      if (field === 'type') return 'Selecione o tipo do ato formal.'
      if (field === 'actDate') return 'Informe a data do ato ou de sua aprovação.'
      if (field === 'typeDescription') return 'Identifique o ato formal.'
      return 'Informe os dados do ato formal.'
    case 'invalid':
      return 'Conteúdo inválido.'
    case 'invalid-date':
      return 'Informe uma data válida.'
    case 'in-future':
      return 'A data do ato não pode ser futura: registre somente alterações já formalizadas.'
    case 'too-long':
      return 'Texto acima do limite de caracteres.'
  }
}

// ---------------------------------------------------------------------------
// Situação de vigência (regra de ativação NÃO homologada → protegida)
// ---------------------------------------------------------------------------

/**
 * - `original-current`: versão original finalizada, vigente no SIGOSC enquanto nenhuma versão
 *   posterior for ativada (único critério aplicável sem nova decisão administrativa);
 * - `pending-decision`: versão posterior registrada; sua vigência depende de decisão
 *   administrativa ainda não homologada (ativação bloqueada);
 * - `active` / `superseded`: estados PREPARADOS para quando a regra de ativação for aprovada.
 */
export type ActivationStatus = 'original-current' | 'pending-decision' | 'active' | 'superseded'

export interface VersionSummary {
  readonly id: string
  readonly sequence: number
  readonly registrationStatus: WorkPlanRegistrationStatus
  /** Somente versões posteriores gravam `activation.status`; o original não. */
  readonly activationStatus: 'pending-decision' | 'active' | 'superseded' | null
}

/**
 * Critério EFETIVAMENTE utilizado: a versão vigente é a de maior sequência com ativação
 * registrada (`active`); na ausência de ativação, a versão original FINALIZADA. Como a
 * ativação está bloqueada, hoje a vigente é sempre a original finalizada (ou nenhuma).
 */
export function currentVersionId(versions: readonly VersionSummary[]): string | null {
  const active = versions.filter((v) => v.sequence > 1 && v.activationStatus === 'active').sort((a, b) => b.sequence - a.sequence)[0]
  if (active) return active.id
  const original = versions.find((v) => v.sequence === 1)
  return original?.registrationStatus === 'finalized' ? original.id : null
}

export function activationStatusOf(version: VersionSummary, current: string | null): ActivationStatus {
  if (version.sequence === 1) return current === version.id ? 'original-current' : 'superseded'
  return version.activationStatus ?? 'pending-decision'
}

export const ACTIVATION_LABEL: Record<ActivationStatus, string> = {
  'original-current': 'Vigente no SIGOSC',
  'pending-decision': 'Vigência não definida: aguarda decisão administrativa',
  active: 'Vigente no SIGOSC',
  superseded: 'Substituída',
}

// ---------------------------------------------------------------------------
// Autorização das operações de versionamento
// ---------------------------------------------------------------------------

export type VersionDenial = WorkPlanDenial | 'base-not-current' | 'base-not-finalized' | 'pending-version-exists' | 'vigency-rule-pending'
export type VersionDecision = WorkPlanDecision | { readonly allowed: false; readonly reason: VersionDenial }

/**
 * Criar nova versão (alteração formal): `work-plan.edit`; OSC sem suspensão comercial; parceria
 * não arquivada; base = versão VIGENTE identificada com segurança e finalizada; e nenhuma versão
 * posterior já registrada (no máximo uma versão pendente por vez — impede cadeias paralelas e
 * duas versões "vigentes" inadvertidas enquanto a regra de ativação não for homologada).
 */
export function decideVersionCreation(
  context: AuthorizationContext,
  partnershipStatus: AdministrativeStatus,
  versions: readonly VersionSummary[],
  baseId: string,
): VersionDecision {
  const decision = evaluate(context, { kind: 'operate', permission: EDIT_PERMISSION })
  if (!decision.allowed) return decision
  if (!allowsNewOperationalRecords(partnershipStatus)) return { allowed: false, reason: 'partnership-archived' }
  const base = versions.find((v) => v.id === baseId)
  if (!base || base.registrationStatus !== 'finalized') return { allowed: false, reason: 'base-not-finalized' }
  if (currentVersionId(versions) !== baseId) return { allowed: false, reason: 'base-not-current' }
  if (versions.some((v) => v.sequence > base.sequence)) return { allowed: false, reason: 'pending-version-exists' }
  return decision
}

/**
 * Ativar uma versão como vigente: PREPARADO e BLOQUEADO. A regra que define quando uma versão
 * posterior passa a vigorar (finalização interna? data de efeitos? ato de terceiro?) não está
 * homologada; a operação é negada a todos depois das verificações comuns.
 */
export function decideActivation(context: AuthorizationContext, partnershipStatus: AdministrativeStatus): VersionDecision {
  const decision = evaluate(context, { kind: 'operate', permission: EDIT_PERMISSION })
  if (!decision.allowed) return decision
  if (!allowsNewOperationalRecords(partnershipStatus)) return { allowed: false, reason: 'partnership-archived' }
  return { allowed: false, reason: 'vigency-rule-pending' }
}

export const VERSION_MESSAGE: Partial<Record<VersionDenial, string>> = {
  'base-not-finalized': 'A nova versão parte da versão vigente finalizada. Finalize o cadastro da versão vigente antes de registrar uma alteração formal.',
  'base-not-current': 'A nova versão deve partir da versão vigente identificada. Recarregue a página e tente novamente.',
  'pending-version-exists':
    'Já existe uma versão posterior registrada cuja vigência aguarda decisão administrativa. Uma nova alteração formal só poderá ser registrada depois dessa definição.',
  'vigency-rule-pending': 'A ativação de uma nova versão como vigente depende de decisão administrativa ainda não homologada.',
}

/** Finalização de versão posterior: requisitos do Plano + ato formal válido (H: tipo e data). */
export function checkVersionFinalization(values: WorkPlanValues, partnership: PartnershipFacts, act: FormalAct | null, today: string): FinalizationCheck {
  const check = checkFinalization(values, partnership)
  if (act === null) return check
  // Só os dados do ato (a autoria declaredBy/declaredAt, gravada pelo servidor, não é conferida aqui).
  const validation = validateFormalAct(Object.fromEntries(FORMAL_ACT_FIELDS.map((k) => [k, act[k]])), today)
  if (validation.ok) return check
  return { pending: [...check.pending, 'Ato formal: tipo e data do ato devem estar informados corretamente.'], warnings: check.warnings }
}

// ---------------------------------------------------------------------------
// Comparação entre versões completas (resultado direto dos dados armazenados)
// ---------------------------------------------------------------------------

export type DiffKind =
  | 'unchanged'
  | 'formatting-only'
  | 'changed'
  | 'included'
  | 'removed'
  | 'became-not-applicable'
  | 'no-longer-applicable'

export const DIFF_LABEL: Record<DiffKind, string> = {
  unchanged: 'Mantido',
  'formatting-only': 'Mantido (só formatação)',
  changed: 'Alterado',
  included: 'Incluído',
  removed: 'Passou a não informado',
  'became-not-applicable': 'Passou a não aplicável',
  'no-longer-applicable': 'Deixou de ser não aplicável',
}

export interface FieldDiff {
  readonly field: WorkPlanField
  readonly kind: DiffKind
  readonly before: FieldValue
  readonly after: FieldValue
}

const normalizeText = (v: string | number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v)

function classify(before: FieldValue, after: FieldValue): DiffKind {
  if (before.state === after.state) {
    if (before.state !== 'informed' || after.state !== 'informed') return 'unchanged'
    if (before.value === after.value) return 'unchanged'
    // Mesmo conteúdo após normalizar espaços: diferença apenas de formatação, não material.
    return normalizeText(before.value) === normalizeText(after.value) ? 'formatting-only' : 'changed'
  }
  if (after.state === 'not-applicable') return 'became-not-applicable'
  if (before.state === 'not-applicable') return 'no-longer-applicable'
  if (before.state === 'not-informed') return 'included'
  return 'removed'
}

/** Compara duas versões INTEGRAIS campo a campo (somente componentes implementados). */
export function diffVersions(before: WorkPlanValues, after: WorkPlanValues): readonly FieldDiff[] {
  return FIELD_IDS.map((field) => ({ field, kind: classify(before[field], after[field]), before: before[field], after: after[field] }))
}

export function isMaterialDiff(kind: DiffKind): boolean {
  return kind !== 'unchanged' && kind !== 'formatting-only'
}

export const FIELD_LABEL: Record<WorkPlanField, string> = Object.fromEntries(FIELD_DEFINITIONS.map((f) => [f.id, f.label])) as Record<WorkPlanField, string>

/** Mensagem única para negações do Plano (versionamento → cadastro → autorização geral). */
export function denialMessage(reason: VersionDenial, fallback: string): string {
  if (reason in VERSION_MESSAGE) return VERSION_MESSAGE[reason] as string
  if (reason in WORK_PLAN_MESSAGE) return WORK_PLAN_MESSAGE[reason as WorkPlanDenial] as string
  if (reason in DENIAL_MESSAGE) return DENIAL_MESSAGE[reason as keyof typeof DENIAL_MESSAGE]
  return fallback
}
