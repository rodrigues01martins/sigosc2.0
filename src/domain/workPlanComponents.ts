/**
 * Metas, indicadores e resultados PREVISTOS do Plano de Trabalho (DEV-02.4) — puro, sem dependências.
 *
 * Fontes verificadas: HF-G05 / PAG-OSC05 etapa 2 ("Meta 1 (obrigatório)", "Indicador da meta 1
 * (obrigatório)", "Fórmula do indicador (obrigatório)"; composição "Metas" e "Indicadores": código,
 * nome, fórmula, meta) e PAG-OSC08 ("Código · Indicador · Meta", periodicidade por indicador; "não há
 * periodicidade universal"). Das decisões DEC-035/041/042/043/046 só os TÍTULOS estão disponíveis.
 *
 * PLANEJADO ≠ REALIZADO: aqui não existem valores apurados, percentuais de cumprimento, avaliações
 * ou evidências. Nenhuma fórmula é executada (sem `eval`, sem interpretador): a fórmula é guardada
 * como descrição estruturada até haver especificação aprovada de sintaxe, operações e arredondamento.
 *
 * Cada componente pertence a UMA versão do Plano (`workPlans/{id}/goals|indicators/{componentId}`)
 * e mantém o mesmo identificador LÓGICO nas versões seguintes (cópia integral na alteração formal).
 */
// ---------------------------------------------------------------------------
// Valores com estado de informação (zero ≠ não informado ≠ não aplicável)
// ---------------------------------------------------------------------------

export type TextValue = { readonly state: 'informed'; readonly value: string } | { readonly state: 'not-informed' } | { readonly state: 'not-applicable' }
export type NumberValue = { readonly state: 'informed'; readonly value: number } | { readonly state: 'not-informed' } | { readonly state: 'not-applicable' }

export const NOT_INFORMED = { state: 'not-informed' } as const

export const NATURES = [
  { id: 'quantitative', label: 'Quantitativa' },
  { id: 'qualitative', label: 'Qualitativa' },
] as const
export type Nature = (typeof NATURES)[number]['id']

/** Tipos de resultado numérico (DEC-043, título). Não presume percentual. */
export const MEASUREMENT_TYPES = [
  { id: 'absolute', label: 'Valor absoluto' },
  { id: 'quantity', label: 'Quantidade' },
  { id: 'percentage', label: 'Percentual' },
  { id: 'ratio', label: 'Razão' },
  { id: 'rate', label: 'Taxa' },
  { id: 'other', label: 'Outro resultado numérico' },
] as const
export type MeasurementType = (typeof MEASUREMENT_TYPES)[number]['id']

/** Periodicidade INDIVIDUAL por indicador (DEC-041, título; PAG-OSC08). "Outra" admite configuração particular. */
export const PERIODICITIES = [
  { id: 'monthly', label: 'Mensal' },
  { id: 'bimonthly', label: 'Bimestral' },
  { id: 'quarterly', label: 'Trimestral' },
  { id: 'semiannual', label: 'Semestral' },
  { id: 'annual', label: 'Anual' },
  { id: 'single', label: 'Única (ao final da parceria)' },
  { id: 'other', label: 'Outra (descrever)' },
] as const
export type PeriodicityKind = (typeof PERIODICITIES)[number]['id']
/**
 * DEC-PT-009: informada; não informada (permitido só durante o cadastramento); ou NÃO APLICÁVEL com
 * justificativa obrigatória — nunca confundida com ausência de preenchimento.
 */
export type Periodicity =
  | { readonly state: 'informed'; readonly value: { readonly kind: PeriodicityKind; readonly description: string | null } }
  | { readonly state: 'not-informed' }
  | { readonly state: 'not-applicable'; readonly justification: string }

export const PERIODICITY_JUSTIFICATION_MIN = 10

/** Método de mensuração (DEC-042, título). Componentes guardados; cálculo NÃO habilitado. */
export const RULE_METHODS = [
  { id: 'described', label: 'Regra descrita no Plano' },
  { id: 'sum', label: 'Soma' },
  { id: 'count', label: 'Contagem' },
  { id: 'ratio', label: 'Razão (numerador ÷ denominador)' },
] as const
export type RuleMethod = (typeof RULE_METHODS)[number]['id']
export interface MeasurementRule {
  readonly method: RuleMethod
  /** Fórmula ou regra como consta do Plano (texto; nunca executado). */
  readonly description: string
  readonly numerator: string | null
  readonly denominator: string | null
  /** Ex.: 100 (percentual) ou 1000 (taxa por mil). */
  readonly multiplier: number | null
}

export const COMPONENT_STATUSES = ['active', 'discontinued'] as const
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number]

export interface GoalData {
  readonly code: string
  readonly description: string
  readonly nature: Nature
  readonly unit: TextValue
  readonly expectedQuantity: NumberValue
  readonly expectedResult: TextValue
  readonly completionCriterion: TextValue
  readonly referencePeriod: TextValue
  readonly status: ComponentStatus
  readonly order: number
}

export interface IndicatorData {
  readonly code: string
  readonly name: string
  readonly description: TextValue
  readonly nature: Nature
  /** Somente indicadores quantitativos. */
  readonly measurementType: MeasurementType | null
  readonly unit: TextValue
  readonly periodicity: Periodicity
  /** Resultado previsto numérico (quantitativo). */
  readonly target: NumberValue
  /** Parâmetro esperado (texto; qualitativo ou complemento). */
  readonly expectedParameter: TextValue
  readonly rule: MeasurementRule
  /** Categorias de classificação TRANSCRITAS do Plano (qualitativo); o sistema não cria escalas. */
  readonly categories: readonly string[]
  readonly classificationCriterion: TextValue
  readonly verificationSource: TextValue
  /** Metas vinculadas (0..n, mesma versão). */
  readonly goalIds: readonly string[]
  readonly status: ComponentStatus
  readonly order: number
}

export type ComponentKind = 'goal' | 'indicator'
export interface Stored<T> {
  readonly id: string
  readonly kind: ComponentKind
  readonly data: T
  readonly revision: number
}

export const LIMITS = {
  code: 20,
  shortText: 300,
  longText: 2000,
  unit: 60,
  ruleText: 1000,
  categories: 10,
  category: 120,
  goalsPerVersion: 100,
  indicatorsPerVersion: 200,
  maxNumber: 1_000_000_000_000,
} as const

export const COMPONENT_ID_PATTERN = /^[gi]_[a-f0-9]{20}$/
export const isComponentId = (v: unknown): v is string => typeof v === 'string' && COMPONENT_ID_PATTERN.test(v)

// ---------------------------------------------------------------------------
// Validação (servidor e interface usam a mesma)
// ---------------------------------------------------------------------------

export type ComponentErrorCode = 'required' | 'invalid' | 'too-long' | 'out-of-range' | 'duplicate-code' | 'unknown-goal' | 'not-applicable-not-allowed' | 'too-many' | 'linked-indicators' | 'discontinued-goal' | 'justification-required'
export type ComponentErrors = Partial<Record<string, ComponentErrorCode>>

// eslint-disable-next-line no-control-regex -- recusa intencional de caracteres de controle
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u2028\\u2029]')
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function text(raw: unknown, max: number, { required = false, multiline = false } = {}): { value: string | null; error: ComponentErrorCode | null } {
  if (raw === undefined || raw === null || raw === '') return required ? { value: null, error: 'required' } : { value: null, error: null }
  if (typeof raw !== 'string') return { value: null, error: 'invalid' }
  const value = multiline ? raw.trim() : raw.trim().replace(/\s+/g, ' ')
  if (!value) return required ? { value: null, error: 'required' } : { value: null, error: null }
  if (CONTROL.test(value.replace(/[\n\r\t]/g, ' '))) return { value: null, error: 'invalid' }
  if (value.length > max) return { value: null, error: 'too-long' }
  return { value, error: null }
}

function textValue(raw: unknown, max: number, allowNA = true): { value: TextValue | null; error: ComponentErrorCode | null } {
  if (raw === undefined) return { value: NOT_INFORMED, error: null }
  if (!isObject(raw)) return { value: null, error: 'invalid' }
  if (raw.state === 'not-informed' && Object.keys(raw).length === 1) return { value: NOT_INFORMED, error: null }
  if (raw.state === 'not-applicable' && Object.keys(raw).length === 1) return allowNA ? { value: { state: 'not-applicable' }, error: null } : { value: null, error: 'not-applicable-not-allowed' }
  if (raw.state !== 'informed' || Object.keys(raw).length !== 2) return { value: null, error: 'invalid' }
  const t = text(raw.value, max, { required: true, multiline: max > LIMITS.shortText })
  return t.error ? { value: null, error: t.error } : { value: { state: 'informed', value: t.value as string }, error: null }
}

function numberValue(raw: unknown): { value: NumberValue | null; error: ComponentErrorCode | null } {
  if (raw === undefined) return { value: NOT_INFORMED, error: null }
  if (!isObject(raw)) return { value: null, error: 'invalid' }
  if (raw.state === 'not-informed' && Object.keys(raw).length === 1) return { value: NOT_INFORMED, error: null }
  if (raw.state === 'not-applicable' && Object.keys(raw).length === 1) return { value: { state: 'not-applicable' }, error: null }
  if (raw.state !== 'informed' || Object.keys(raw).length !== 2) return { value: null, error: 'invalid' }
  const n = raw.value
  if (typeof n !== 'number' || !Number.isFinite(n)) return { value: null, error: 'invalid' }
  if (Math.abs(n) > LIMITS.maxNumber) return { value: null, error: 'out-of-range' }
  // Até 6 casas decimais (sem arredondamento silencioso).
  if (Math.round(n * 1e6) / 1e6 !== n) return { value: null, error: 'invalid' }
  return { value: { state: 'informed', value: n }, error: null }
}

function periodicity(raw: unknown): { value: Periodicity | null; error: ComponentErrorCode | null } {
  if (raw === undefined) return { value: NOT_INFORMED, error: null }
  if (!isObject(raw)) return { value: null, error: 'invalid' }
  if (raw.state === 'not-informed' && Object.keys(raw).length === 1) return { value: NOT_INFORMED, error: null }
  if (raw.state === 'not-applicable') {
    if (Object.keys(raw).some((k) => k !== 'state' && k !== 'justification')) return { value: null, error: 'invalid' }
    const j = text(raw.justification, LIMITS.longText, { required: true, multiline: true })
    if (j.error) return { value: null, error: j.error === 'required' ? 'justification-required' : j.error }
    if ((j.value as string).length < PERIODICITY_JUSTIFICATION_MIN) return { value: null, error: 'justification-required' }
    return { value: { state: 'not-applicable', justification: j.value as string }, error: null }
  }
  if (raw.state !== 'informed' || !isObject(raw.value) || Object.keys(raw).length !== 2) return { value: null, error: 'invalid' }
  const { kind, description } = raw.value
  if (!PERIODICITIES.some((p) => p.id === kind) || Object.keys(raw.value).some((k) => k !== 'kind' && k !== 'description')) return { value: null, error: 'invalid' }
  const d = text(description, LIMITS.shortText, { required: kind === 'other' })
  if (d.error) return { value: null, error: d.error }
  return { value: { state: 'informed', value: { kind: kind as PeriodicityKind, description: kind === 'other' ? d.value : null } }, error: null }
}

function rule(raw: unknown, nature: Nature): { value: MeasurementRule | null; errors: ComponentErrors } {
  if (!isObject(raw)) return { value: null, errors: { 'rule.description': 'required' } }
  if (Object.keys(raw).some((k) => !['method', 'description', 'numerator', 'denominator', 'multiplier'].includes(k))) return { value: null, errors: { rule: 'invalid' } }
  const errors: ComponentErrors = {}
  const method = raw.method ?? 'described'
  if (!RULE_METHODS.some((m) => m.id === method) || (nature === 'qualitative' && method !== 'described')) errors['rule.method'] = 'invalid'
  const description = text(raw.description, LIMITS.ruleText, { required: true, multiline: true })
  if (description.error) errors['rule.description'] = description.error
  const ratio = method === 'ratio'
  const numerator = text(raw.numerator, LIMITS.shortText, { required: ratio })
  const denominator = text(raw.denominator, LIMITS.shortText, { required: ratio })
  if (numerator.error) errors['rule.numerator'] = numerator.error
  if (denominator.error) errors['rule.denominator'] = denominator.error
  let multiplier: number | null = null
  if (raw.multiplier !== undefined && raw.multiplier !== null && raw.multiplier !== '') {
    if (typeof raw.multiplier !== 'number' || !Number.isFinite(raw.multiplier) || raw.multiplier <= 0 || raw.multiplier > 1_000_000) errors['rule.multiplier'] = 'invalid'
    else multiplier = raw.multiplier
  }
  if (Object.keys(errors).length) return { value: null, errors }
  return {
    value: { method: method as RuleMethod, description: description.value as string, numerator: ratio ? numerator.value : null, denominator: ratio ? denominator.value : null, multiplier: method === 'described' ? null : multiplier },
    errors: {},
  }
}

const GOAL_KEYS = ['code', 'description', 'nature', 'unit', 'expectedQuantity', 'expectedResult', 'completionCriterion', 'referencePeriod', 'status', 'order'] as const
const INDICATOR_KEYS = ['code', 'name', 'description', 'nature', 'measurementType', 'unit', 'periodicity', 'target', 'expectedParameter', 'rule', 'categories', 'classificationCriterion', 'verificationSource', 'goalIds', 'status', 'order'] as const

export type Validation<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly errors: ComponentErrors }

function common(raw: Record<string, unknown>, errors: ComponentErrors) {
  const code = text(raw.code, LIMITS.code, { required: true })
  if (code.error) errors.code = code.error
  const nature = raw.nature
  if (!NATURES.some((n) => n.id === nature)) errors.nature = nature === undefined || nature === '' ? 'required' : 'invalid'
  const status = raw.status ?? 'active'
  if (!COMPONENT_STATUSES.includes(status as ComponentStatus)) errors.status = 'invalid'
  const order = raw.order ?? 0
  if (typeof order !== 'number' || !Number.isSafeInteger(order) || order < 0 || order > 10_000) errors.order = 'invalid'
  return { code: code.value as string, nature: nature as Nature, status: status as ComponentStatus, order: order as number }
}

/** Valida uma meta COMPLETA (criação ou estado resultante de uma alteração). */
export function validateGoal(input: unknown): Validation<GoalData> {
  if (!isObject(input)) return { ok: false, errors: { goal: 'invalid' } }
  if (Object.keys(input).some((k) => !(GOAL_KEYS as readonly string[]).includes(k))) return { ok: false, errors: { goal: 'invalid' } }
  const errors: ComponentErrors = {}
  const base = common(input, errors)
  const description = text(input.description, LIMITS.longText, { required: true, multiline: true })
  if (description.error) errors.description = description.error
  const unit = textValue(input.unit, LIMITS.unit)
  const expectedQuantity = numberValue(input.expectedQuantity)
  const expectedResult = textValue(input.expectedResult, LIMITS.longText)
  const completionCriterion = textValue(input.completionCriterion, LIMITS.longText)
  const referencePeriod = textValue(input.referencePeriod, LIMITS.shortText)
  for (const [k, r] of Object.entries({ unit, expectedQuantity, expectedResult, completionCriterion, referencePeriod })) if (r.error) errors[k] = r.error
  // Meta qualitativa não recebe quantidade numérica (não se converte qualitativo em número).
  if (base.nature === 'qualitative' && expectedQuantity.value?.state === 'informed') errors.expectedQuantity = 'invalid'
  if (Object.keys(errors).length) return { ok: false, errors }
  return {
    ok: true,
    data: {
      ...base,
      description: description.value as string,
      unit: unit.value as TextValue,
      expectedQuantity: expectedQuantity.value as NumberValue,
      expectedResult: expectedResult.value as TextValue,
      completionCriterion: completionCriterion.value as TextValue,
      referencePeriod: referencePeriod.value as TextValue,
    },
  }
}

/** Valida um indicador COMPLETO; `goalIds` precisam existir na MESMA versão (`knownGoals`). */
export function validateIndicator(input: unknown, knownGoals: ReadonlySet<string>): Validation<IndicatorData> {
  if (!isObject(input)) return { ok: false, errors: { indicator: 'invalid' } }
  if (Object.keys(input).some((k) => !(INDICATOR_KEYS as readonly string[]).includes(k))) return { ok: false, errors: { indicator: 'invalid' } }
  const errors: ComponentErrors = {}
  const base = common(input, errors)
  const name = text(input.name, LIMITS.shortText, { required: true })
  if (name.error) errors.name = name.error
  const quantitative = base.nature === 'quantitative'
  let measurementType: MeasurementType | null = null
  if (quantitative) {
    if (input.measurementType === undefined || input.measurementType === null || input.measurementType === '') errors.measurementType = 'required'
    else if (!MEASUREMENT_TYPES.some((m) => m.id === input.measurementType)) errors.measurementType = 'invalid'
    else measurementType = input.measurementType as MeasurementType
  } else if (input.measurementType !== undefined && input.measurementType !== null) errors.measurementType = 'invalid'
  const description = textValue(input.description, LIMITS.longText)
  const unit = textValue(input.unit, LIMITS.unit)
  const per = periodicity(input.periodicity)
  const target = numberValue(input.target)
  const expectedParameter = textValue(input.expectedParameter, LIMITS.longText)
  const classificationCriterion = textValue(input.classificationCriterion, LIMITS.longText)
  const verificationSource = textValue(input.verificationSource, LIMITS.longText)
  for (const [k, r] of Object.entries({ description, unit, periodicity: per, target, expectedParameter, classificationCriterion, verificationSource })) if (r.error) errors[k] = r.error
  // Indicador qualitativo: sem resultado numérico (não é convertido em percentual).
  if (!quantitative && target.value?.state === 'informed') errors.target = 'invalid'
  const r = rule(input.rule, base.nature)
  Object.assign(errors, r.errors)
  let categories: string[] = []
  if (input.categories !== undefined) {
    if (!Array.isArray(input.categories)) errors.categories = 'invalid'
    else if (input.categories.length > LIMITS.categories) errors.categories = 'too-many'
    else if (!quantitative || input.categories.length === 0) {
      const parsed = input.categories.map((c) => text(c, LIMITS.category, { required: true }))
      if (parsed.some((p) => p.error)) errors.categories = 'invalid'
      else categories = parsed.map((p) => p.value as string)
      if (new Set(categories.map((c) => c.toLocaleLowerCase('pt-BR'))).size !== categories.length) errors.categories = 'invalid'
    } else errors.categories = 'invalid'
  }
  let goalIds: string[] = []
  if (input.goalIds !== undefined) {
    if (!Array.isArray(input.goalIds) || input.goalIds.length > LIMITS.goalsPerVersion || !input.goalIds.every(isComponentId) || new Set(input.goalIds).size !== input.goalIds.length) errors.goalIds = 'invalid'
    else if (!input.goalIds.every((g) => knownGoals.has(g))) errors.goalIds = 'unknown-goal'
    else goalIds = [...input.goalIds] as string[]
  }
  if (Object.keys(errors).length) return { ok: false, errors }
  return {
    ok: true,
    data: {
      ...base,
      name: name.value as string,
      description: description.value as TextValue,
      measurementType,
      unit: unit.value as TextValue,
      periodicity: per.value as Periodicity,
      target: target.value as NumberValue,
      expectedParameter: expectedParameter.value as TextValue,
      rule: r.value as MeasurementRule,
      categories,
      classificationCriterion: classificationCriterion.value as TextValue,
      verificationSource: verificationSource.value as TextValue,
      goalIds,
    },
  }
}

/** Código único (sem diferenciar maiúsculas) entre os componentes do mesmo tipo e versão. */
export function isDuplicateCode(code: string, others: readonly { id: string; code: string }[], selfId: string | null): boolean {
  const key = code.toLocaleLowerCase('pt-BR')
  return others.some((o) => o.id !== selfId && o.code.toLocaleLowerCase('pt-BR') === key)
}

/**
 * Integridade dos vínculos: meta só pode ser descontinuada sem indicadores ATIVOS vinculados; um
 * indicador ativo não pode ser vinculado a meta descontinuada.
 */
export function linkIntegrity(goals: readonly Stored<GoalData>[], indicators: readonly Stored<IndicatorData>[]): { readonly ok: true } | { readonly ok: false; readonly goalId: string } {
  const discontinued = new Set(goals.filter((g) => g.data.status === 'discontinued').map((g) => g.id))
  for (const i of indicators) if (i.data.status === 'active') for (const g of i.data.goalIds) if (discontinued.has(g)) return { ok: false, goalId: g }
  return { ok: true }
}

export const COMPONENT_ERROR_MESSAGE: Record<ComponentErrorCode, string> = {
  required: 'Campo obrigatório.',
  invalid: 'Conteúdo inválido.',
  'too-long': 'Texto acima do limite de caracteres.',
  'out-of-range': 'Valor fora do intervalo aceito.',
  'duplicate-code': 'Já existe componente com este código nesta versão.',
  'unknown-goal': 'Selecione somente metas desta versão.',
  'not-applicable-not-allowed': '"Não se aplica" não é permitido neste campo.',
  'too-many': 'Quantidade acima do limite.',
  'linked-indicators': 'Há indicadores ativos vinculados a esta meta. Desvincule-os ou descontinue-os antes de descontinuar a meta.',
  'discontinued-goal': 'Não vincule indicador ativo a meta descontinuada.',
  'justification-required': 'Informe a justificativa (mínimo de 10 caracteres).',
}

// ---------------------------------------------------------------------------
// Comparação entre versões (por identificador LÓGICO)
// ---------------------------------------------------------------------------

export type ComponentDiffKind = 'unchanged' | 'changed' | 'included' | 'discontinued' | 'reactivated'
export interface ComponentDiff {
  readonly id: string
  readonly kind: ComponentKind
  readonly code: string
  readonly diff: ComponentDiffKind
  readonly fields: readonly string[]
}

const stable = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (isObject(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x))

export function diffComponents<T extends GoalData | IndicatorData>(kind: ComponentKind, before: readonly Stored<T>[], after: readonly Stored<T>[]): readonly ComponentDiff[] {
  const prev = new Map(before.map((c) => [c.id, c]))
  const out: ComponentDiff[] = []
  for (const c of after) {
    const p = prev.get(c.id)
    if (!p) {
      out.push({ id: c.id, kind, code: c.data.code, diff: c.data.status === 'active' ? 'included' : 'discontinued', fields: [] })
      continue
    }
    const fields = Object.keys(c.data).filter((k) => k !== 'order' && stable((c.data as unknown as Record<string, unknown>)[k]) !== stable((p.data as unknown as Record<string, unknown>)[k]))
    const statusChange = p.data.status !== c.data.status ? (c.data.status === 'discontinued' ? 'discontinued' : 'reactivated') : null
    out.push({ id: c.id, kind, code: c.data.code, diff: statusChange ?? (fields.length ? 'changed' : 'unchanged'), fields: fields.filter((f) => f !== 'status') })
  }
  // Ausente na versão posterior (não deveria ocorrer: a cópia é integral) → tratado como descontinuado.
  for (const p of before) if (!after.some((c) => c.id === p.id)) out.push({ id: p.id, kind, code: p.data.code, diff: 'discontinued', fields: [] })
  return out
}

export const COMPONENT_DIFF_LABEL: Record<ComponentDiffKind, string> = {
  unchanged: 'Mantido',
  changed: 'Alterado',
  included: 'Incluído',
  discontinued: 'Descontinuado',
  reactivated: 'Reativado',
}

export const GOAL_FIELD_LABEL: Record<keyof GoalData, string> = {
  code: 'Código',
  description: 'Descrição da meta',
  nature: 'Natureza',
  unit: 'Unidade de medida',
  expectedQuantity: 'Quantidade prevista',
  expectedResult: 'Resultado previsto',
  completionCriterion: 'Critério de cumprimento',
  referencePeriod: 'Período de referência',
  status: 'Situação no Plano',
  order: 'Ordem',
}

export const INDICATOR_FIELD_LABEL: Record<keyof IndicatorData, string> = {
  code: 'Código',
  name: 'Nome do indicador',
  description: 'Descrição',
  nature: 'Natureza',
  measurementType: 'Tipo de resultado numérico',
  unit: 'Unidade de medida',
  periodicity: 'Periodicidade',
  target: 'Resultado previsto (valor-alvo)',
  expectedParameter: 'Parâmetro esperado',
  rule: 'Fórmula ou regra de mensuração',
  categories: 'Categorias de classificação',
  classificationCriterion: 'Critério de classificação',
  verificationSource: 'Fonte ou meio de verificação',
  goalIds: 'Metas vinculadas',
  status: 'Situação no Plano',
  order: 'Ordem',
}

export const label = <T extends { id: string; label: string }>(list: readonly T[], id: string | null | undefined): string => list.find((x) => x.id === id)?.label ?? '—'

export function periodicityLabel(p: Periodicity): string {
  if (p.state === 'not-applicable') return `Não se aplica — ${p.justification}`
  if (p.state !== 'informed') return 'Não informada'
  return p.value.kind === 'other' ? (p.value.description ?? 'Outra') : label(PERIODICITIES, p.value.kind)
}

// ---------------------------------------------------------------------------
// DEC-PT-007 — Conferência de metas e indicadores (finalização e encerramento da incorporação)
// ---------------------------------------------------------------------------

/**
 * Situação DECLARADA de cada categoria (metas; indicadores). A ausência de registros nunca é
 * interpretada automaticamente como inexistência ou inaplicabilidade: a escolha é explícita.
 */
export const REVIEW_STATUSES = [
  { id: 'transcribed', label: 'Transcritos conforme o Plano aprovado' },
  { id: 'none-in-document', label: 'Inexistentes no Plano aprovado' },
  { id: 'not-applicable', label: 'Não aplicáveis a esta parceria' },
  { id: 'pending', label: 'Ainda pendentes de transcrição' },
] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]['id']
export interface ReviewCategory {
  readonly status: ReviewStatus
  readonly justification: string | null
}
export interface ComponentReview {
  readonly goals: ReviewCategory
  readonly indicators: ReviewCategory
}
export const REVIEW_JUSTIFICATION_MIN = 10

/** Declaração de correspondência exigida na finalização regular e no encerramento da incorporação. */
export const COMPONENTS_DECLARATION =
  'Declaro que as metas e os indicadores registrados correspondem ao Plano de Trabalho formalmente aprovado, conforme a conferência acima.'

/** DEC-PT-006: declaração de abertura da incorporação complementar. */
export const TRANSCRIPTION_DECLARATION =
  'Declaro que as metas e os indicadores que serão incorporados correspondem ao Plano de Trabalho formalmente aprovado e que esta operação se limita à transcrição de informações preexistentes, sem alteração formal de seu conteúdo.'

/** Lê a conferência enviada (formato estrito); `null` = malformada. */
export function parseReview(raw: unknown): ComponentReview | null {
  if (!isObject(raw) || Object.keys(raw).length !== 2) return null
  const category = (c: unknown): ReviewCategory | null => {
    if (!isObject(c) || Object.keys(c).some((k) => k !== 'status' && k !== 'justification')) return null
    if (!REVIEW_STATUSES.some((s) => s.id === c.status)) return null
    if (c.justification !== undefined && c.justification !== null && typeof c.justification !== 'string') return null
    const j = typeof c.justification === 'string' ? c.justification.trim() : ''
    if (j.length > LIMITS.longText || CONTROL.test(j.replace(/[\n\r\t]/g, ' '))) return null
    return { status: c.status as ReviewStatus, justification: j || null }
  }
  const goals = category(raw.goals)
  const indicators = category(raw.indicators)
  return goals && indicators ? { goals, indicators } : null
}

/**
 * Conferência obrigatória (DEC-PT-007 + DEC-PT-009 + DEC-PT-008), avaliada no SERVIDOR sobre os
 * componentes relidos na transação. Sem mínimo universal: "inexistentes"/"não aplicáveis" são
 * aceitos com justificativa e sem componentes ativos da categoria.
 */
export function checkComponentReview(review: ComponentReview, goals: readonly Stored<GoalData>[], indicators: readonly Stored<IndicatorData>[]): readonly string[] {
  const pending: string[] = []
  const category = (name: 'Metas' | 'Indicadores', c: ReviewCategory, active: number) => {
    if (c.status === 'pending') pending.push(`${name}: há componentes pendentes de transcrição.`)
    else if (c.status === 'transcribed') {
      if (active === 0) pending.push(`${name}: declaradas como transcritas, mas não há componentes ativos registrados.`)
    } else {
      if (active > 0) pending.push(`${name}: há componentes ativos registrados; a categoria não pode ser declarada inexistente ou não aplicável.`)
      if ((c.justification ?? '').length < REVIEW_JUSTIFICATION_MIN) pending.push(`${name}: informe a justificativa (mínimo de ${REVIEW_JUSTIFICATION_MIN} caracteres).`)
    }
  }
  const activeIndicators = indicators.filter((i) => i.data.status === 'active')
  category('Metas', review.goals, goals.filter((g) => g.data.status === 'active').length)
  category('Indicadores', review.indicators, activeIndicators.length)
  const unresolved = activeIndicators.filter((i) => i.data.periodicity.state === 'not-informed')
  if (unresolved.length) pending.push(`Periodicidade pendente: ${unresolved.map((i) => i.data.code).join(', ')} (informe a periodicidade ou justifique a inaplicabilidade).`)
  const integrity = linkIntegrity(goals, indicators)
  if (!integrity.ok) pending.push('Há indicador ativo vinculado a meta descontinuada.')
  return pending
}

/**
 * Impressão digital do conjunto conferido (IDs e revisões de metas e indicadores, FNV-1a 32 bits).
 * O navegador envia a que viu; o servidor recalcula na transação: alteração concorrente → 409.
 */
export function componentsToken(components: readonly { readonly kind: ComponentKind; readonly id: string; readonly revision: number }[]): string {
  const key = components
    .map((c) => `${c.kind}:${c.id}:${c.revision}`)
    .sort()
    .join('|')
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${components.length}-${hash.toString(16).padStart(8, '0')}`
}
export const COMPONENTS_TOKEN_PATTERN = /^\d{1,4}-[0-9a-f]{8}$/

// ---------------------------------------------------------------------------
// DEC-PT-010 — impacto da troca de natureza (nada é descartado em silêncio)
// ---------------------------------------------------------------------------

/** Campos INFORMADOS que deixarão de valer se o componente passar a ser qualitativo. */
export function qualitativeImpact(kind: ComponentKind, data: { readonly unit?: TextValue; readonly expectedQuantity?: NumberValue; readonly target?: NumberValue; readonly measurementType?: string | null; readonly rule?: MeasurementRule }): readonly string[] {
  const lost: string[] = []
  if (data.unit?.state === 'informed') lost.push('Unidade de medida')
  if (kind === 'goal' && data.expectedQuantity?.state === 'informed') lost.push('Quantidade prevista')
  if (kind === 'indicator') {
    if (data.target?.state === 'informed') lost.push('Resultado previsto (valor-alvo)')
    if (data.measurementType) lost.push('Tipo de resultado numérico')
    if (data.rule && data.rule.method !== 'described') lost.push('Método, numerador, denominador e multiplicador da fórmula')
  }
  return lost
}
