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
 * ou apostilamento (obrigatório)", "Data da formalização (obrigatório)".
 * DEC-PT-003 (alt. B): a finalização interna de nova versão a ATIVA como referência cadastral.
 * DEC-PT-004 (alt. A): uma única versão em cadastramento por parceria.
 * DEC-PT-005 (alt. B): data de efeitos futura não impede a ativação cadastral; é sinalizada.
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
// Vigência cadastral (DEC-PT-003/004/005)
// ---------------------------------------------------------------------------

/**
 * Situação de ativação GRAVADA em `activation.status` (somente o servidor grava):
 * - `awaiting-finalization`: versão posterior em cadastramento (ainda não vigente);
 * - `pending-decision`: LEGADO da DEV-02.3 (antes da DEC-PT-003). Em cadastramento, equivale a
 *   `awaiting-finalization`; FINALIZADA, não é ativada retroativamente (aguarda regularização);
 * - `active`: ativada na finalização interna (DEC-PT-003) e vigente no SIGOSC;
 * - `superseded`: deixou de ser a referência cadastral vigente (não significa revogação jurídica).
 * A versão original grava apenas `superseded` (quando substituída); antes disso, nada.
 */
export type StoredActivationStatus = 'awaiting-finalization' | 'pending-decision' | 'active' | 'superseded'

export function parseStoredActivation(value: unknown): StoredActivationStatus | null {
  return value === 'awaiting-finalization' || value === 'pending-decision' || value === 'active' || value === 'superseded' ? value : null
}

/** Situação APRESENTADA (derivada dos documentos; nunca informada pelo navegador). */
export type ActivationStatus = 'in-registration' | 'original-current' | 'active' | 'superseded' | 'legacy-pending'

export interface VersionSummary {
  readonly id: string
  readonly sequence: number
  readonly registrationStatus: WorkPlanRegistrationStatus
  readonly activationStatus: StoredActivationStatus | null
  /** Versão de origem (somente versões posteriores). */
  readonly previousWorkPlanId?: string | null
}

export type CurrentResolution =
  | { readonly status: 'determined'; readonly id: string }
  | { readonly status: 'none' }
  | { readonly status: 'inconsistent' }

/**
 * FONTE AUTORITATIVA da versão cadastralmente vigente: os próprios documentos de versão, lidos
 * juntos (na mesma transação, no servidor). Vigente = a ÚNICA versão posterior `active`; sem
 * nenhuma, a original FINALIZADA não substituída. Mais de uma `active`, ou original marcada como
 * substituída sem sucessora ativa → `inconsistent` (nenhuma escolha por suposição).
 */
export function resolveCurrentVersion(versions: readonly VersionSummary[]): CurrentResolution {
  const actives = versions.filter((v) => v.sequence > 1 && v.activationStatus === 'active')
  if (actives.length > 1) return { status: 'inconsistent' }
  const [active] = actives
  if (active) return active.registrationStatus === 'finalized' ? { status: 'determined', id: active.id } : { status: 'inconsistent' }
  const original = versions.find((v) => v.sequence === 1)
  if (!original || original.registrationStatus !== 'finalized') return { status: 'none' }
  if (original.activationStatus === 'superseded') return { status: 'inconsistent' }
  return { status: 'determined', id: original.id }
}

export function currentVersionId(versions: readonly VersionSummary[]): string | null {
  const resolution = resolveCurrentVersion(versions)
  return resolution.status === 'determined' ? resolution.id : null
}

export function activationStatusOf(version: VersionSummary, current: string | null): ActivationStatus {
  if (version.registrationStatus === 'in-registration') return 'in-registration'
  if (version.id === current) return version.sequence === 1 ? 'original-current' : 'active'
  if (version.sequence > 1 && (version.activationStatus === 'pending-decision' || version.activationStatus === 'awaiting-finalization')) return 'legacy-pending'
  return 'superseded'
}

export const ACTIVATION_LABEL: Record<ActivationStatus, string> = {
  'in-registration': 'Em cadastramento: ainda não vigente',
  'original-current': 'Vigente no SIGOSC',
  active: 'Vigente no SIGOSC',
  superseded: 'Substituída no SIGOSC',
  'legacy-pending': 'Finalizada sem ativação: aguarda regularização',
}

// ---------------------------------------------------------------------------
// Produção de efeitos administrativos (DEC-PT-005) — distinta da vigência cadastral
// ---------------------------------------------------------------------------

export type EffectsStatus = 'not-informed' | 'future' | 'reached'

/**
 * Compara DATAS CIVIS (AAAA-MM-DD). `today` deve ser a data civil de Brasília
 * (America/Sao_Paulo), calculada no servidor ou por `todayInBrasilia` — nunca pelo fuso do navegador.
 */
export function effectsStatus(effectiveDate: string | null | undefined, today: string): EffectsStatus {
  if (!effectiveDate) return 'not-informed'
  return effectiveDate > today ? 'future' : 'reached'
}

// ---------------------------------------------------------------------------
// Referência para registros futuros (DEC-039) — sem presumir eficácia jurídica
// ---------------------------------------------------------------------------

export interface VersionTimelineEntry extends VersionSummary {
  readonly effectiveDate: string | null
  readonly activatedAt: Date | null
}

export interface CurrentReference {
  readonly status: 'determined' | 'none' | 'inconsistent'
  readonly workPlanId: string | null
  readonly sequence: number | null
  /** Data/hora do servidor em que passou a ser a referência cadastral (null na original). */
  readonly activatedAt: Date | null
  /** Data de efeitos DECLARADA no ato (null = não informada; nunca presumida). */
  readonly effectiveDate: string | null
  readonly effects: EffectsStatus | 'not-applicable'
}

export function currentReference(versions: readonly VersionTimelineEntry[], today: string): CurrentReference {
  const resolution = resolveCurrentVersion(versions)
  if (resolution.status !== 'determined') return { status: resolution.status, workPlanId: null, sequence: null, activatedAt: null, effectiveDate: null, effects: 'not-applicable' }
  const v = versions.find((x) => x.id === resolution.id) as VersionTimelineEntry
  return {
    status: 'determined',
    workPlanId: v.id,
    sequence: v.sequence,
    activatedAt: v.sequence > 1 ? v.activatedAt : null,
    effectiveDate: v.sequence > 1 ? v.effectiveDate : null,
    effects: v.sequence > 1 ? effectsStatus(v.effectiveDate, today) : 'not-applicable',
  }
}

export type ApplicableVersion =
  | { readonly status: 'determined'; readonly workPlanId: string; readonly basis: 'effective-date' | 'before-first-alteration' }
  | { readonly status: 'indeterminate'; readonly reason: 'inconsistent' | 'no-finalized-version' | 'legacy-pending' | 'effective-date-not-informed' | 'effective-dates-out-of-order' }

/**
 * Versão ADMINISTRATIVAMENTE aplicável numa data civil — somente quando determinável com
 * segurança: todas as alterações ativadas precisam ter data de efeitos declarada e em ordem.
 * A data de ativação cadastral NÃO é usada como data de eficácia. Na dúvida: `indeterminate`
 * (o módulo consumidor deve exigir conferência). Antes dos efeitos da primeira alteração,
 * aplica-se a original (o período anterior à aprovação do Plano não é avaliado aqui).
 */
export function applicableVersionOn(versions: readonly VersionTimelineEntry[], date: string): ApplicableVersion {
  if (resolveCurrentVersion(versions).status === 'inconsistent') return { status: 'indeterminate', reason: 'inconsistent' }
  if (versions.some((v) => activationStatusOf(v, null) === 'legacy-pending')) return { status: 'indeterminate', reason: 'legacy-pending' }
  const original = versions.find((v) => v.sequence === 1 && v.registrationStatus === 'finalized')
  if (!original) return { status: 'indeterminate', reason: 'no-finalized-version' }
  const chain = versions.filter((v) => v.sequence > 1 && (v.activationStatus === 'active' || v.activationStatus === 'superseded')).sort((a, b) => a.sequence - b.sequence)
  if (chain.some((v) => !v.effectiveDate)) return { status: 'indeterminate', reason: 'effective-date-not-informed' }
  for (let i = 1; i < chain.length; i++) if ((chain[i]?.effectiveDate ?? '') < (chain[i - 1]?.effectiveDate ?? '')) return { status: 'indeterminate', reason: 'effective-dates-out-of-order' }
  const applicable = chain.filter((v) => (v.effectiveDate as string) <= date).pop()
  return applicable ? { status: 'determined', workPlanId: applicable.id, basis: 'effective-date' } : { status: 'determined', workPlanId: original.id, basis: 'before-first-alteration' }
}

// ---------------------------------------------------------------------------
// Autorização das operações de versionamento
// ---------------------------------------------------------------------------

export type VersionDenial =
  | WorkPlanDenial
  | 'base-not-current'
  | 'base-not-finalized'
  | 'pending-version-exists'
  | 'legacy-version-pending'
  | 'versions-inconsistent'
  /** DEV-02.4: metas/indicadores em versão FINALIZADA sem componentes — aguarda decisão administrativa. */
  | 'complementary-transcription-pending'
export type VersionDecision = WorkPlanDecision | { readonly allowed: false; readonly reason: VersionDenial }

/**
 * Criar nova versão (alteração formal) — DEC-PT-004: `work-plan.edit`; OSC sem suspensão
 * comercial; parceria não arquivada; base = versão VIGENTE (identificada com segurança) e
 * finalizada; nenhuma versão em cadastramento; nenhuma versão LEGADA finalizada sem ativação.
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
  const resolution = resolveCurrentVersion(versions)
  if (resolution.status === 'inconsistent') return { allowed: false, reason: 'versions-inconsistent' }
  const base = versions.find((v) => v.id === baseId)
  if (!base || base.registrationStatus !== 'finalized') return { allowed: false, reason: 'base-not-finalized' }
  if (versions.some((v) => v.registrationStatus === 'in-registration')) return { allowed: false, reason: 'pending-version-exists' }
  if (versions.some((v) => activationStatusOf(v, null) === 'legacy-pending')) return { allowed: false, reason: 'legacy-version-pending' }
  if (resolution.status !== 'determined' || resolution.id !== baseId) return { allowed: false, reason: 'base-not-current' }
  return decision
}

/**
 * Finalização de versão POSTERIOR = finalização + ativação cadastral (DEC-PT-003), numa só
 * operação. Além das regras comuns da finalização, a versão de origem deve ser a vigente.
 */
export function checkActivationChain(versions: readonly VersionSummary[], targetId: string): { readonly ok: true; readonly supersededId: string } | { readonly ok: false; readonly reason: VersionDenial } {
  const resolution = resolveCurrentVersion(versions)
  if (resolution.status === 'inconsistent') return { ok: false, reason: 'versions-inconsistent' }
  const target = versions.find((v) => v.id === targetId)
  if (!target || target.sequence <= 1) return { ok: false, reason: 'base-not-current' }
  if (resolution.status !== 'determined' || target.previousWorkPlanId !== resolution.id) return { ok: false, reason: 'base-not-current' }
  return { ok: true, supersededId: resolution.id }
}

export const VERSION_MESSAGE: Partial<Record<VersionDenial, string>> = {
  'base-not-finalized': 'A nova versão parte da versão vigente finalizada. Finalize o cadastro da versão vigente antes de registrar uma alteração formal.',
  'base-not-current': 'A versão de origem não é mais a versão vigente no SIGOSC. Recarregue a página e confira as versões.',
  'pending-version-exists':
    'Já existe uma versão em cadastramento. Finalize-a — a finalização a torna vigente no SIGOSC — antes de registrar nova alteração formal.',
  'legacy-version-pending':
    'Há versão finalizada antes da regra de ativação (DEC-PT-003) que não foi ativada. Nova alteração formal fica bloqueada até a regularização administrativa.',
  'versions-inconsistent': 'Não foi possível identificar com segurança a versão vigente. Nenhuma alteração foi feita; procure o suporte.',
  'complementary-transcription-pending':
    'Esta versão já foi finalizada sem metas e indicadores estruturados. A transcrição complementar em Plano finalizado depende de decisão administrativa; nenhuma alteração foi feita.',
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
