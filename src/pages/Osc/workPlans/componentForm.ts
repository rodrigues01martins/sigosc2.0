/**
 * Formulários de metas e indicadores (DEV-02.4) — conversão PURA entre o que se digita e o
 * componente completo validado pelo domínio. Campo vazio = "não informado"; "Não se aplica" =
 * não aplicável; 0 digitado = zero informado (nunca confundidos).
 */
import {
  MEASUREMENT_TYPES,
  NATURES,
  PERIODICITIES,
  REVIEW_STATUSES,
  RULE_METHODS,
  label,
  periodicityLabel,
  type ComponentReview,
  type GoalData,
  type ReviewStatus,
  type IndicatorData,
  type NumberValue,
  type TextValue,
} from '../../../domain/workPlanComponents.ts'

export interface Optional {
  text: string
  na: boolean
}
const optional = (v: TextValue | NumberValue): Optional => ({ text: v.state === 'informed' ? (typeof v.value === 'number' ? formatNumber(v.value) : v.value) : '', na: v.state === 'not-applicable' })
const NUMBER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 })
export const formatNumber = (n: number) => NUMBER.format(n)

export function toText(o: Optional): TextValue {
  if (o.na) return { state: 'not-applicable' }
  return o.text.trim() ? { state: 'informed', value: o.text } : { state: 'not-informed' }
}

/**
 * Número no padrão brasileiro: vírgula decimal e ponto de milhar ("1.234,5"; "1.200" = mil e duzentos).
 * Sem vírgula, ponto só é decimal fora do agrupamento de milhar ("12.5"). Inválido → 'invalid'.
 */
export function parseNumber(raw: string): number | 'invalid' | null {
  const t = raw.replace(/\s/g, '')
  if (t === '') return null
  const grouped = /^-?\d{1,3}(\.\d{3})+$/.test(t)
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : grouped ? t.replace(/\./g, '') : t
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return 'invalid'
  return Number(normalized)
}

export function toNumber(o: Optional): NumberValue | 'invalid' {
  if (o.na) return { state: 'not-applicable' }
  const n = parseNumber(o.text)
  if (n === 'invalid') return 'invalid'
  return n === null ? { state: 'not-informed' } : { state: 'informed', value: n }
}

// ---------------------------------------------------------------------------- metas

export interface GoalForm {
  code: string
  description: string
  nature: string
  unit: Optional
  expectedQuantity: Optional
  expectedResult: Optional
  completionCriterion: Optional
  referencePeriod: Optional
  status: 'active' | 'discontinued'
}

export function goalFormFrom(data: GoalData | null, suggestedCode: string): GoalForm {
  const empty: Optional = { text: '', na: false }
  if (!data) return { code: suggestedCode, description: '', nature: '', unit: empty, expectedQuantity: empty, expectedResult: empty, completionCriterion: empty, referencePeriod: empty, status: 'active' }
  return {
    code: data.code,
    description: data.description,
    nature: data.nature,
    unit: optional(data.unit),
    expectedQuantity: optional(data.expectedQuantity),
    expectedResult: optional(data.expectedResult),
    completionCriterion: optional(data.completionCriterion),
    referencePeriod: optional(data.referencePeriod),
    status: data.status,
  }
}

/** Monta a meta COMPLETA (ou devolve o erro de número malformado). */
export function goalFromForm(f: GoalForm, order: number): Record<string, unknown> | { invalidNumber: 'expectedQuantity' } {
  const quantity = f.nature === 'qualitative' ? ({ state: 'not-informed' } as const) : toNumber(f.expectedQuantity)
  if (quantity === 'invalid') return { invalidNumber: 'expectedQuantity' }
  return {
    code: f.code,
    description: f.description,
    nature: f.nature || undefined,
    unit: f.nature === 'qualitative' ? { state: 'not-informed' } : toText(f.unit),
    expectedQuantity: quantity,
    expectedResult: toText(f.expectedResult),
    completionCriterion: toText(f.completionCriterion),
    referencePeriod: toText(f.referencePeriod),
    status: f.status,
    order,
  }
}

// ---------------------------------------------------------------------------- indicadores

export interface IndicatorForm {
  code: string
  name: string
  nature: string
  measurementType: string
  goalIds: string[]
  target: Optional
  unit: Optional
  expectedParameter: Optional
  /** '' = não informada; 'not-applicable' = não se aplica (DEC-PT-009, com justificativa). */
  periodicityKind: string
  periodicityDescription: string
  periodicityJustification: string
  ruleMethod: string
  ruleDescription: string
  numerator: string
  denominator: string
  multiplier: string
  categories: string
  classificationCriterion: Optional
  verificationSource: Optional
  description: Optional
  status: 'active' | 'discontinued'
}

export function indicatorFormFrom(data: IndicatorData | null, suggestedCode: string, presetGoal: string | null): IndicatorForm {
  const empty: Optional = { text: '', na: false }
  if (!data)
    return {
      code: suggestedCode,
      name: '',
      nature: '',
      measurementType: '',
      goalIds: presetGoal ? [presetGoal] : [],
      target: empty,
      unit: empty,
      expectedParameter: empty,
      periodicityKind: '',
      periodicityDescription: '',
      periodicityJustification: '',
      ruleMethod: 'described',
      ruleDescription: '',
      numerator: '',
      denominator: '',
      multiplier: '',
      categories: '',
      classificationCriterion: empty,
      verificationSource: empty,
      description: empty,
      status: 'active',
    }
  return {
    code: data.code,
    name: data.name,
    nature: data.nature,
    measurementType: data.measurementType ?? '',
    goalIds: [...data.goalIds],
    target: optional(data.target),
    unit: optional(data.unit),
    expectedParameter: optional(data.expectedParameter),
    periodicityKind: data.periodicity.state === 'informed' ? data.periodicity.value.kind : data.periodicity.state === 'not-applicable' ? 'not-applicable' : '',
    periodicityDescription: data.periodicity.state === 'informed' ? (data.periodicity.value.description ?? '') : '',
    periodicityJustification: data.periodicity.state === 'not-applicable' ? data.periodicity.justification : '',
    ruleMethod: data.rule.method,
    ruleDescription: data.rule.description,
    numerator: data.rule.numerator ?? '',
    denominator: data.rule.denominator ?? '',
    multiplier: data.rule.multiplier === null ? '' : formatNumber(data.rule.multiplier),
    categories: data.categories.join('\n'),
    classificationCriterion: optional(data.classificationCriterion),
    verificationSource: optional(data.verificationSource),
    description: optional(data.description),
    status: data.status,
  }
}

export function indicatorFromForm(f: IndicatorForm, order: number): Record<string, unknown> | { invalidNumber: 'target' | 'rule.multiplier' } {
  const quantitative = f.nature === 'quantitative'
  const target = quantitative ? toNumber(f.target) : ({ state: 'not-informed' } as const)
  if (target === 'invalid') return { invalidNumber: 'target' }
  const multiplier = quantitative && f.ruleMethod !== 'described' ? parseNumber(f.multiplier) : null
  if (multiplier === 'invalid') return { invalidNumber: 'rule.multiplier' }
  const method = quantitative ? f.ruleMethod || 'described' : 'described'
  return {
    code: f.code,
    name: f.name,
    description: toText(f.description),
    nature: f.nature || undefined,
    measurementType: quantitative ? f.measurementType || undefined : null,
    unit: quantitative ? toText(f.unit) : { state: 'not-informed' },
    periodicity:
      f.periodicityKind === 'not-applicable'
        ? { state: 'not-applicable', justification: f.periodicityJustification }
        : f.periodicityKind
          ? { state: 'informed', value: { kind: f.periodicityKind, description: f.periodicityKind === 'other' ? f.periodicityDescription : null } }
          : { state: 'not-informed' },
    target,
    expectedParameter: toText(f.expectedParameter),
    rule: { method, description: f.ruleDescription, numerator: method === 'ratio' ? f.numerator : null, denominator: method === 'ratio' ? f.denominator : null, multiplier },
    categories: quantitative ? [] : f.categories.split('\n').map((c) => c.trim()).filter(Boolean),
    classificationCriterion: toText(f.classificationCriterion),
    verificationSource: toText(f.verificationSource),
    goalIds: f.goalIds,
    status: f.status,
    order,
  }
}

// ---------------------------------------------------------------------------- exibição

export const show = (v: TextValue | NumberValue, unit?: TextValue): string => {
  if (v.state === 'not-informed') return 'Não informado'
  if (v.state === 'not-applicable') return 'Não se aplica'
  const u = unit?.state === 'informed' ? ` ${unit.value}` : ''
  return typeof v.value === 'number' ? `${formatNumber(v.value)}${u}` : v.value
}

export const natureLabel = (n: string) => label(NATURES, n)
export const measurementLabel = (m: string | null) => label(MEASUREMENT_TYPES, m)
export const methodLabel = (m: string) => label(RULE_METHODS, m)
export { periodicityLabel, PERIODICITIES, MEASUREMENT_TYPES, NATURES, RULE_METHODS }

/** Próximo código sugerido ("Meta 03", "IND-04"), editável pelo usuário. */
export function nextCode(prefix: 'Meta ' | 'IND-', codes: readonly string[]): string {
  const used = new Set(codes.map((c) => c.toLocaleLowerCase('pt-BR')))
  for (let n = 1; n < 1000; n++) {
    const code = `${prefix}${String(n).padStart(2, '0')}`
    if (!used.has(code.toLocaleLowerCase('pt-BR'))) return code
  }
  return ''
}

export function ruleSummary(d: IndicatorData): string {
  const r = d.rule
  const parts = [r.description]
  if (r.method === 'ratio') parts.push(`numerador: ${r.numerator ?? '—'}; denominador: ${r.denominator ?? '—'}${r.multiplier !== null ? `; multiplicador: ${formatNumber(r.multiplier)}` : ''}`)
  else if (r.method !== 'described') parts.push(`${methodLabel(r.method)}${r.multiplier !== null ? ` × ${formatNumber(r.multiplier)}` : ''}`)
  return parts.join(' — ')
}

// ---------------------------------------------------------------------------- conferência (DEC-PT-007)

export interface ReviewDraft {
  goals: { status: ReviewStatus | ''; justification: string }
  indicators: { status: ReviewStatus | ''; justification: string }
}
export const emptyReview = (): ReviewDraft => ({ goals: { status: '', justification: '' }, indicators: { status: '', justification: '' } })

/** Rascunho → conferência enviada. Categoria sem escolha = PENDENTE (nunca presumida). */
export function reviewFromDraft(d: ReviewDraft): ComponentReview {
  const c = (x: ReviewDraft['goals']) => ({ status: x.status || 'pending', justification: x.status === 'none-in-document' || x.status === 'not-applicable' ? x.justification.trim() || null : null }) as const
  return { goals: c(d.goals), indicators: c(d.indicators) }
}
export { REVIEW_STATUSES }
