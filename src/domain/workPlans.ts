/**
 * Domínio do Plano de Trabalho aprovado (DEV-02.2) — puro e sem dependências.
 *
 * O SIGOSC registra a REPRESENTAÇÃO ESTRUTURADA de um Plano de Trabalho já aprovado pela
 * administração pública para uma parceria formalizada (DEC-006, DEC-033). O registro não
 * substitui o documento formal, não é aprovação jurídica e não cria versão formal (DEC-034):
 * o primeiro registro é a ORIGEM da futura cadeia de versões, sem ser apresentado como tal.
 *
 * Fontes: HF-G05 / PAG-OSC05 (etapa "identificação do Plano aprovado": data da aprovação pelo
 * órgão público e período de execução, ambos obrigatórios; seção "Objeto e Público"); títulos
 * das decisões DEC-006, 032, 033, 034, 035, 037, 038 e 039 informados no pedido da DEV-02.2.
 */
import { evaluate, type AuthorizationContext, type Authority, type DenialReason } from './authorization.ts'
import { allowsNewOperationalRecords, isValidDate, type AdministrativeStatus, type InstrumentId } from './partnerships.ts'

// ---------------------------------------------------------------------------
// Situação do cadastro estruturado (não é situação jurídica nem da parceria)
// ---------------------------------------------------------------------------

/** "Não estruturado" = ausência do registro; os demais são gravados no documento. */
export const REGISTRATION_STATUSES = ['in-registration', 'finalized'] as const
export type WorkPlanRegistrationStatus = (typeof REGISTRATION_STATUSES)[number]
export type WorkPlanSituation = 'not-structured' | WorkPlanRegistrationStatus

export const SITUATION_LABEL: Record<WorkPlanSituation, string> = {
  'not-structured': 'Não estruturado',
  'in-registration': 'Em cadastramento',
  finalized: 'Estruturado e finalizado internamente',
}

/** Identificador estável do primeiro registro estruturado (origem da futura cadeia de versões). */
export const ORIGINAL_WORK_PLAN_ID = 'original'

// ---------------------------------------------------------------------------
// Estados de informação (DEV-02.2 §7)
// ---------------------------------------------------------------------------

/**
 * - `informed`: há valor registrado (zero é um valor informado);
 * - `not-informed`: o campo se aplica, mas ainda não tem informação (NUNCA convertido em zero);
 * - `not-applicable`: o campo não se aplica (declarado pelo usuário, só onde o campo admite).
 */
export const VALUE_STATES = ['informed', 'not-informed', 'not-applicable'] as const
export type ValueState = (typeof VALUE_STATES)[number]
export type FieldValue =
  | { readonly state: 'informed'; readonly value: string | number }
  | { readonly state: 'not-informed' }
  | { readonly state: 'not-applicable' }

export type FieldKind = 'date' | 'text' | 'integer'

export interface FieldDefinition {
  readonly id: WorkPlanField
  readonly group: WorkPlanGroup
  readonly label: string
  readonly kind: FieldKind
  /** Exigido para a FINALIZAÇÃO (não para salvar o cadastro em andamento). */
  readonly requiredForFinalization: boolean
  readonly allowsNotApplicable: boolean
  readonly max?: number
  /** H = protótipo homologado; D = título de decisão aprovada; T = proposta técnica (opcional). */
  readonly source: string
  readonly hint?: string
}

export const GROUPS = [
  { id: 'approval', label: 'Identificação do Plano aprovado' },
  { id: 'execution', label: 'Informações gerais de execução' },
  { id: 'scope', label: 'Abrangência e público atendido' },
  { id: 'context', label: 'Justificativa e informações complementares' },
] as const
export type WorkPlanGroup = (typeof GROUPS)[number]['id']

export const FIELDS = [
  { id: 'approvalDate', group: 'approval', label: 'Data da aprovação pelo órgão público', kind: 'date', requiredForFinalization: true, allowsNotApplicable: false, source: 'H (HF-G05, PAG-OSC05, etapa 1)', hint: 'Aprovação externa ao SIGOSC.' },
  { id: 'approvalReference', group: 'approval', label: 'Identificação do ato ou documento de aprovação', kind: 'text', requiredForFinalization: false, allowsNotApplicable: false, max: 300, source: 'T (grupo 10; DEC-006)', hint: 'Ex.: número do parecer, despacho ou processo.' },
  { id: 'executionStart', group: 'execution', label: 'Início do período de execução', kind: 'date', requiredForFinalization: true, allowsNotApplicable: false, source: 'H (HF-G05, PAG-OSC05, etapa 1)' },
  { id: 'executionEnd', group: 'execution', label: 'Término do período de execução', kind: 'date', requiredForFinalization: true, allowsNotApplicable: false, source: 'H (HF-G05, PAG-OSC05, etapa 1)' },
  { id: 'executionMethod', group: 'execution', label: 'Forma de execução', kind: 'text', requiredForFinalization: false, allowsNotApplicable: false, max: 4000, source: 'T (grupo 6; DEC-032)' },
  { id: 'targetAudience', group: 'scope', label: 'Público atendido', kind: 'text', requiredForFinalization: false, allowsNotApplicable: true, max: 2000, source: 'H (composição "Objeto e Público")' },
  { id: 'estimatedBeneficiaries', group: 'scope', label: 'Quantidade estimada de beneficiários', kind: 'integer', requiredForFinalization: false, allowsNotApplicable: true, source: 'T (grupo 5; DEC-032)', hint: 'Zero é um valor informado; deixe vazio se não informado.' },
  { id: 'geographicScope', group: 'scope', label: 'Abrangência territorial', kind: 'text', requiredForFinalization: false, allowsNotApplicable: true, max: 1000, source: 'T (grupo 5; DEC-032)' },
  { id: 'justification', group: 'context', label: 'Justificativa e contextualização', kind: 'text', requiredForFinalization: false, allowsNotApplicable: false, max: 8000, source: 'T (grupo 4; DEC-032)' },
  { id: 'complementaryNotes', group: 'context', label: 'Informações complementares', kind: 'text', requiredForFinalization: false, allowsNotApplicable: false, max: 8000, source: 'D (DEC-032, campos complementares)' },
] as const satisfies readonly (Omit<FieldDefinition, 'id'> & { id: string })[]

export type WorkPlanField = (typeof FIELDS)[number]['id']
/** Mesma lista, com o tipo geral (campos opcionais como `hint` e `max` acessíveis). */
export const FIELD_DEFINITIONS: readonly FieldDefinition[] = FIELDS
export const FIELD_IDS: readonly WorkPlanField[] = FIELDS.map((f) => f.id)
export const fieldDefinition = (id: WorkPlanField): FieldDefinition => FIELDS.find((f) => f.id === id) as FieldDefinition

export type WorkPlanValues = Record<WorkPlanField, FieldValue>

/** Valores iniciais do cadastro: tudo "não informado" (nada é criado sem documentação). */
export function emptyValues(): WorkPlanValues {
  return Object.fromEntries(FIELD_IDS.map((id) => [id, { state: 'not-informed' }])) as WorkPlanValues
}

export const MAX_BENEFICIARIES = 1_000_000_000
const DATE = isValidDate
// eslint-disable-next-line no-control-regex -- recusa intencional de caracteres de controle
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u2028\\u2029]')

export type FieldErrorCode = 'invalid' | 'invalid-date' | 'in-future' | 'too-long' | 'not-applicable-not-allowed' | 'out-of-range' | 'end-before-start'

/** Normaliza e valida UM valor recebido (cliente ou servidor). `null` quando inválido. */
export function parseFieldValue(id: WorkPlanField, raw: unknown, today: string): { value: FieldValue | null; error: FieldErrorCode | null } {
  const def = fieldDefinition(id)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { value: null, error: 'invalid' }
  const record = raw as Record<string, unknown>
  const keys = Object.keys(record)
  if (record.state === 'not-informed' && keys.length === 1) return { value: { state: 'not-informed' }, error: null }
  if (record.state === 'not-applicable' && keys.length === 1) {
    return def.allowsNotApplicable ? { value: { state: 'not-applicable' }, error: null } : { value: null, error: 'not-applicable-not-allowed' }
  }
  if (record.state !== 'informed' || keys.length !== 2 || !('value' in record)) return { value: null, error: 'invalid' }
  const v = record.value
  switch (def.kind) {
    case 'date':
      if (!DATE(v)) return { value: null, error: 'invalid-date' }
      if (id === 'approvalDate' && v > today) return { value: null, error: 'in-future' }
      return { value: { state: 'informed', value: v }, error: null }
    case 'integer':
      if (typeof v !== 'number' || !Number.isSafeInteger(v)) return { value: null, error: 'invalid' }
      if (v < 0 || v > MAX_BENEFICIARIES) return { value: null, error: 'out-of-range' }
      return { value: { state: 'informed', value: v }, error: null }
    case 'text': {
      if (typeof v !== 'string') return { value: null, error: 'invalid' }
      const text = v.trim()
      // Texto vazio não é "informado": use o estado "não informado".
      if (text.length === 0 || CONTROL.test(text.replace(/[\n\r\t]/g, ' '))) return { value: null, error: 'invalid' }
      if (text.length > (def.max ?? 4000)) return { value: null, error: 'too-long' }
      return { value: { state: 'informed', value: text }, error: null }
    }
  }
}

export type ChangesResult =
  | { readonly ok: true; readonly changes: Partial<WorkPlanValues> }
  | { readonly ok: false; readonly errors: Partial<Record<WorkPlanField | 'changes', FieldErrorCode | 'required'>> }

/** Valida um conjunto de alterações do cadastro EM ANDAMENTO (campos desconhecidos → recusado). */
export function validateChanges(input: Record<string, unknown>, current: WorkPlanValues, today: string): ChangesResult {
  const keys = Object.keys(input)
  if (keys.length === 0) return { ok: false, errors: { changes: 'required' } }
  if (!keys.every((k) => (FIELD_IDS as readonly string[]).includes(k))) return { ok: false, errors: { changes: 'invalid' } }
  const errors: Partial<Record<WorkPlanField, FieldErrorCode>> = {}
  const changes: Partial<WorkPlanValues> = {}
  for (const key of keys as WorkPlanField[]) {
    const { value, error } = parseFieldValue(key, input[key], today)
    if (error) errors[key] = error
    else if (value) changes[key] = value
  }
  // Coerência do período de execução considerando o estado resultante.
  const merged = { ...current, ...changes }
  const start = merged.executionStart
  const end = merged.executionEnd
  if (!errors.executionEnd && start.state === 'informed' && end.state === 'informed' && String(end.value) < String(start.value)) {
    errors.executionEnd = 'end-before-start'
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, changes }
}

export function fieldErrorMessage(code: FieldErrorCode | 'required'): string {
  switch (code) {
    case 'required':
      return 'Nenhuma alteração informada.'
    case 'invalid':
      return 'Valor inválido.'
    case 'invalid-date':
      return 'Informe uma data válida.'
    case 'in-future':
      return 'A data da aprovação não pode ser futura.'
    case 'too-long':
      return 'Texto acima do limite de caracteres.'
    case 'not-applicable-not-allowed':
      return 'Este campo não admite "não se aplica".'
    case 'out-of-range':
      return 'Informe um número inteiro igual ou maior que zero.'
    case 'end-before-start':
      return 'O término do período de execução não pode ser anterior ao início.'
  }
}

// ---------------------------------------------------------------------------
// Requisitos para a finalização interna (DEC-038)
// ---------------------------------------------------------------------------

export interface PartnershipFacts {
  readonly instrument: InstrumentId
  readonly termStart: string
  readonly termEnd: string
  readonly formalizationDate: string
  readonly administrativeStatus: AdministrativeStatus
  readonly workPlanApprovalDeclared: boolean
}

export interface FinalizationCheck {
  /** Impedimentos: a finalização é recusada enquanto existirem. */
  readonly pending: readonly string[]
  /** Pontos de conferência que não impedem a finalização (situação documental). */
  readonly warnings: readonly string[]
}

const fmt = (d: string) => d.split('-').reverse().join('/')

export function checkFinalization(values: WorkPlanValues, partnership: PartnershipFacts): FinalizationCheck {
  const pending: string[] = []
  const warnings: string[] = []
  for (const def of FIELDS) {
    if (def.requiredForFinalization && values[def.id].state !== 'informed') pending.push(`${def.label}: não informado.`)
  }
  const start = values.executionStart
  const end = values.executionEnd
  if (start.state === 'informed' && end.state === 'informed' && String(end.value) < String(start.value)) {
    pending.push('O término do período de execução é anterior ao início.')
  }
  if (!partnership.workPlanApprovalDeclared) pending.push('A aprovação do Plano de Trabalho não foi declarada no cadastro da parceria.')
  if (start.state === 'informed' && end.state === 'informed') {
    if (String(start.value) < partnership.termStart || String(end.value) > partnership.termEnd) {
      warnings.push(`Período de execução fora da vigência da parceria (${fmt(partnership.termStart)} a ${fmt(partnership.termEnd)}). Confira o Plano aprovado.`)
    }
  }
  const approval = values.approvalDate
  if (approval.state === 'informed' && String(approval.value) > partnership.formalizationDate) {
    warnings.push('Data da aprovação posterior à formalização da parceria. Confira o documento.')
  }
  return { pending, warnings }
}

// ---------------------------------------------------------------------------
// Autorização (DEV-02.2 §10; DEC-PT-001 e DEC-PT-002)
// ---------------------------------------------------------------------------

export const VIEW_PERMISSION = 'work-plan.view'
/** DEC-PT-001: competência ÚNICA para iniciar, alterar, finalizar e corrigir erro material. */
export const EDIT_PERMISSION = 'work-plan.edit'
/** Identificador DESCONTINUADO (DEC-PT-001): nunca autoriza operações; mantido só para documentação. */
export const DISCONTINUED_FINALIZE_PERMISSION = 'work-plan.finalize'

export type WorkPlanDenial = DenialReason | 'partnership-archived' | 'already-finalized' | 'not-finalized'
export type WorkPlanDecision = { readonly allowed: true; readonly authority: Authority } | { readonly allowed: false; readonly reason: WorkPlanDenial }

export type WorkPlanOperation = 'start' | 'update' | 'finalize' | 'correct'

/**
 * Gravações do Plano (todas exigem `work-plan.edit`; `view` não implica `edit` nem o inverso):
 * - iniciar, alterar e finalizar → somente enquanto o cadastro NÃO estiver finalizado;
 * - corrigir erro material (DEC-PT-002) → somente DEPOIS da finalização;
 * - todas negadas na suspensão comercial (avaliador) e em parceria ARQUIVADA (somente consulta);
 *   parceria suspensa ou encerrada não bloqueia (DEC-PAR-003).
 */
export function decideWorkPlanOperation(
  context: AuthorizationContext,
  operation: WorkPlanOperation,
  partnershipStatus: AdministrativeStatus,
  registration: WorkPlanSituation,
): WorkPlanDecision {
  const decision = evaluate(context, { kind: 'operate', permission: EDIT_PERMISSION })
  if (!decision.allowed) return decision
  if (!allowsNewOperationalRecords(partnershipStatus)) return { allowed: false, reason: 'partnership-archived' }
  if (operation === 'correct') return registration === 'finalized' ? decision : { allowed: false, reason: 'not-finalized' }
  if (registration === 'finalized') return { allowed: false, reason: 'already-finalized' }
  return decision
}

export const WORK_PLAN_MESSAGE: Partial<Record<WorkPlanDenial, string>> = {
  'commercial-suspension': 'A OSC está com a situação comercial suspensa. Novos registros estão bloqueados.',
  'partnership-archived': 'Parceria arquivada: o Plano de Trabalho está disponível somente para consulta.',
  'already-finalized':
    'O cadastro estruturado já foi finalizado internamente e está preservado. Edições comuns não são possíveis; use a correção de erro material, quando cabível. Alterações formais dependem do versionamento (incremento futuro).',
  'not-finalized': 'A correção de erro material só se aplica a Plano finalizado. Enquanto em cadastramento, use a edição comum.',
}

// ---------------------------------------------------------------------------
// Correção de erro material (DEC-PT-002)
// ---------------------------------------------------------------------------

/** Declaração exigida do usuário (registrada na auditoria; NÃO é validação automatizada). */
export const CORRECTION_DECLARATION =
  'Declaro que esta correção corresponde à informação constante do Plano de Trabalho efetivamente aprovado, não representando alteração formal de seu conteúdo.'

export const JUSTIFICATION_LIMITS = { min: 10, max: 2000 } as const

export interface CorrectionItem {
  readonly field: WorkPlanField
  readonly before: FieldValue
  readonly after: FieldValue
}

export type CorrectionErrorCode =
  | FieldErrorCode
  | 'required'
  | 'no-change'
  | 'justification-required'
  | 'justification-too-short'
  | 'justification-too-long'
  | 'declaration-required'
  | 'breaks-finalization'

/** `correctionReason` = justificativa da correção (distinta do CAMPO `justification` do Plano). */
export type CorrectionErrorKey = WorkPlanField | 'changes' | 'correctionReason' | 'declaration'

export type CorrectionValidation =
  | { readonly ok: true; readonly items: readonly CorrectionItem[]; readonly justification: string; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly errors: Partial<Record<CorrectionErrorKey, CorrectionErrorCode>>; readonly pending?: readonly string[] }

/** Normaliza a justificativa (texto significativo, sem caracteres de controle). */
export function cleanJustification(raw: unknown): { value: string | null; error: CorrectionErrorCode | null } {
  if (typeof raw !== 'string') return { value: null, error: 'justification-required' }
  const text = raw.trim().replace(/[ \t]+/g, ' ')
  if (text.length === 0) return { value: null, error: 'justification-required' }
  if (CONTROL.test(text.replace(/[\n\r]/g, ' '))) return { value: null, error: 'invalid' }
  // "Significativo": ao menos o mínimo de caracteres não brancos.
  if (text.replace(/\s/g, '').length < JUSTIFICATION_LIMITS.min) return { value: null, error: 'justification-too-short' }
  if (text.length > JUSTIFICATION_LIMITS.max) return { value: null, error: 'justification-too-long' }
  return { value: text, error: null }
}

/**
 * Valida uma correção material: campos permitidos e válidos (mesmas regras do cadastro), ao
 * menos um valor efetivamente diferente, justificativa significativa, declaração aceita e
 * resultado ainda compatível com os requisitos de finalização (o Plano continua finalizado).
 */
export function validateCorrection(
  input: { changes: unknown; justification: unknown; declaration: unknown },
  current: WorkPlanValues,
  partnership: PartnershipFacts,
  today: string,
): CorrectionValidation {
  const errors: Partial<Record<CorrectionErrorKey, CorrectionErrorCode>> = {}
  const changes = typeof input.changes === 'object' && input.changes !== null && !Array.isArray(input.changes) ? (input.changes as Record<string, unknown>) : null
  let items: CorrectionItem[] = []
  if (!changes) errors.changes = 'required'
  else {
    const validation = validateChanges(changes, current, today)
    if (!validation.ok) Object.assign(errors, validation.errors)
    else {
      items = (Object.entries(validation.changes) as [WorkPlanField, FieldValue][])
        .filter(([field, after]) => JSON.stringify(current[field]) !== JSON.stringify(after))
        .map(([field, after]) => ({ field, before: current[field], after }))
      if (items.length === 0) errors.changes = 'no-change'
    }
  }
  const justification = cleanJustification(input.justification)
  if (justification.error) errors.correctionReason = justification.error
  if (input.declaration !== true) errors.declaration = 'declaration-required'
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const merged = { ...current, ...Object.fromEntries(items.map((i) => [i.field, i.after])) } as WorkPlanValues
  const check = checkFinalization(merged, partnership)
  if (check.pending.length > 0) return { ok: false, errors: { changes: 'breaks-finalization' }, pending: check.pending }
  return { ok: true, items, justification: justification.value as string, warnings: check.warnings }
}

export function correctionErrorMessage(code: CorrectionErrorCode): string {
  switch (code) {
    case 'no-change':
      return 'Nenhum valor foi efetivamente alterado.'
    case 'justification-required':
      return 'Informe a justificativa da correção.'
    case 'justification-too-short':
      return `A justificativa deve ter ao menos ${JUSTIFICATION_LIMITS.min} caracteres significativos.`
    case 'justification-too-long':
      return `A justificativa deve ter no máximo ${JUSTIFICATION_LIMITS.max} caracteres.`
    case 'declaration-required':
      return 'Confirme a declaração de correspondência ao Plano aprovado.'
    case 'breaks-finalization':
      return 'A correção deixaria o Plano sem os requisitos da finalização (campos obrigatórios ou período coerente).'
    default:
      return fieldErrorMessage(code)
  }
}
