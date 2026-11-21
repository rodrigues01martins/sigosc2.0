/**
 * Planejamento financeiro do Plano de Trabalho aprovado (DEV-02.5) — puro, sem dependências.
 *
 * Fontes verificadas (HF-G05): PAG-OSC05 etapa 3 ("Item F1 do planejamento financeiro (obrigatório)",
 * "Valor previsto do item F1 (obrigatório)"; "Itens do planejamento financeiro na nova versão") e
 * PAG-OSC09 ("Modelo híbrido: categorias padronizadas e itens configurados no Plano de Trabalho";
 * categorias Recursos Humanos, Serviços de Terceiros, Material de Consumo e "Outras despesas";
 * Acordo de Cooperação = "Sem transferência de recursos"). DEC-021/051/052/053/059/062/063: só os títulos.
 *
 * PLANEJADO ≠ REALIZADO: aqui não há receitas recebidas, despesas, saldos ou comprovantes.
 * Valores monetários em CENTAVOS INTEIROS; somas exatas; quantidades em decimal EXATO (texto com
 * até 4 casas) — nada de ponto flutuante como fundamento de cálculo, nada de arredondamento silencioso.
 */
import { hasFinancialTransfer, type InstrumentId } from './partnerships.ts'

// ---------------------------------------------------------------------------
// Estados de informação (zero ≠ não informado ≠ não aplicável)
// ---------------------------------------------------------------------------

export type MoneyValue = { readonly state: 'informed'; readonly cents: number } | { readonly state: 'not-informed' } | { readonly state: 'not-applicable' }
export type QuantityValue = { readonly state: 'informed'; readonly value: string } | { readonly state: 'not-informed' } | { readonly state: 'not-applicable' }
export type FinText = { readonly state: 'informed'; readonly value: string } | { readonly state: 'not-informed' } | { readonly state: 'not-applicable' }
const NOT_INFORMED = { state: 'not-informed' } as const

/** R$ 1 trilhão (mesmo limite técnico do valor global da parceria, DEC-PAR-005); somas checadas. */
export const MAX_CENTS = 100_000_000_000_000
export const QUANTITY_PATTERN = /^(0|[1-9]\d{0,11})(\.\d{1,4})?$/

export const FIN_LIMITS = {
  code: 20,
  name: 120,
  description: 2000,
  shortText: 300,
  unit: 60,
  categoriesPerVersion: 30,
  itemsPerVersion: 150,
} as const

// ---------------------------------------------------------------------------
// Categorias (modelo híbrido) e fontes previstas
// ---------------------------------------------------------------------------

/**
 * Categorias de REFERÊNCIA (DEC-PT-016, alt. A; HF-G05/PAG-OSC09). Não são classificação jurídica universal:
 * a associação é explícita e opcional; categorias próprias do Plano são preservadas sem reclassificação.
 */
export const STANDARD_CATEGORIES = [
  { id: 'recursos-humanos', label: 'Recursos Humanos' },
  { id: 'servicos-terceiros', label: 'Serviços de Terceiros' },
  { id: 'material-consumo', label: 'Material de Consumo' },
  { id: 'outras-despesas', label: 'Outras Despesas' },
] as const
export type StandardCategoryId = (typeof STANDARD_CATEGORIES)[number]['id']

/**
 * Fonte PREVISTA do recurso (DEC-PT-017, alt. A): opcional ("Não informada" = null, que NÃO significa zero,
 * ausência de recursos, inaplicabilidade nem receita). "Outra fonte" exige descrição livre nas gravações.
 */
export const FUNDING_SOURCES = [
  { id: 'public-transfer', label: 'Repasse público' },
  { id: 'counterpart', label: 'Contrapartida' },
  { id: 'other', label: 'Outra fonte' },
] as const
export type FundingSource = (typeof FUNDING_SOURCES)[number]['id']

export const FIN_STATUSES = ['active', 'discontinued'] as const
export type FinStatus = (typeof FIN_STATUSES)[number]

export interface FinancialCategoryData {
  readonly code: string
  /** Nome conforme o Plano aprovado (preserva a classificação adotada no documento). */
  readonly name: string
  /** Categoria padronizada correspondente (null = classificação própria do Plano). */
  readonly standardCategory: StandardCategoryId | null
  readonly status: FinStatus
  readonly order: number
}

export interface FinancialItemData {
  readonly code: string
  readonly categoryId: string
  readonly description: string
  readonly unit: FinText
  readonly quantity: QuantityValue
  readonly unitValue: MoneyValue
  /** Valor previsto do item (global ou total), como consta do Plano. Nunca substituído automaticamente. */
  readonly plannedValue: MoneyValue
  readonly fundingSource: FundingSource | null
  /** DEC-PT-017: descrição da "Outra fonte" (null nas demais; ausente em registros anteriores). */
  readonly fundingSourceDescription: string | null
  readonly period: FinText
  readonly details: FinText
  /** Memória de cálculo TEXTUAL (nunca executada). */
  readonly calculationMemory: FinText
  readonly status: FinStatus
  readonly order: number
}

export type FinancialKind = 'financial-category' | 'financial-item'
export interface FinStored<T> {
  readonly id: string
  readonly kind: FinancialKind
  readonly data: T
  readonly revision: number
}

export const FIN_ID_PATTERN = /^[cf]_[a-f0-9]{20}$/
export const isFinancialId = (v: unknown): v is string => typeof v === 'string' && FIN_ID_PATTERN.test(v)

// ---------------------------------------------------------------------------
// Dinheiro e quantidade: leitura EXATA (texto → inteiro), sem ponto flutuante
// ---------------------------------------------------------------------------

/**
 * Valor em reais no padrão brasileiro → centavos: "1.234,56", "1234,5", "1.200" (mil e duzentos),
 * "R$ 0,00". Ponto sem vírgula só é aceito como separador de milhar (evita ler "1.200" como 1,20).
 * Mais de 2 casas decimais é RECUSADO (sem arredondamento silencioso).
 */
export function parseBrlToCents(input: string): number | 'invalid' | null {
  const t = input.replace(/\s|R\$/g, '')
  if (t === '') return null
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(t)
  if (!m) return 'invalid'
  const reais = (m[1] as string).replace(/\./g, '')
  const centavos = (m[2] ?? '').padEnd(2, '0')
  if (reais.length > 13) return 'invalid'
  const cents = Number(reais) * 100 + Number(centavos)
  return Number.isSafeInteger(cents) && cents <= MAX_CENTS ? cents : 'invalid'
}

/** Centavos → "R$ 1.234,56" (formatação por inteiros; sem divisão em ponto flutuante). */
export function formatCents(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const reais = Math.floor(abs / 100)
  const cent = String(abs % 100).padStart(2, '0')
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${negative ? '-' : ''}R$ ${grouped},${cent}`
}

/** Quantidade no padrão brasileiro ("1.200", "12,5", "0,25") → decimal canônico ("1200", "12.5", "0.25"). */
export function parseQuantity(input: string): string | 'invalid' | null {
  const t = input.replace(/\s/g, '')
  if (t === '') return null
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,4}))?$/.exec(t)
  if (!m) return 'invalid'
  const int = (m[1] as string).replace(/\./g, '').replace(/^0+(?=\d)/, '')
  const frac = (m[2] ?? '').replace(/0+$/, '')
  const value = frac ? `${int}.${frac}` : int
  return QUANTITY_PATTERN.test(value) ? value : 'invalid'
}

export function formatQuantity(value: string): string {
  const [int, frac] = value.split('.')
  return `${(int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${frac ? `,${frac}` : ''}`
}

/**
 * quantidade × valor unitário, EXATO (BigInt). Se o produto não resultar em centavos inteiros
 * (ex.: 0,333 × R$ 0,01), devolve `null`: não há valor derivado sem regra de arredondamento.
 */
export function derivedTotalCents(quantity: string, unitCents: number): number | null {
  if (!QUANTITY_PATTERN.test(quantity) || !Number.isSafeInteger(unitCents) || unitCents < 0) return null
  const [int, frac = ''] = quantity.split('.')
  const scale = 10n ** BigInt(frac.length)
  const scaled = BigInt(`${int}${frac}`) * BigInt(unitCents)
  if (scaled % scale !== 0n) return null
  const total = scaled / scale
  return total <= BigInt(MAX_CENTS) ? Number(total) : null
}

/**
 * Produto EXATO em reais, com todas as casas necessárias ("R$ 8,325"), por aritmética inteira (BigInt).
 * Usado só para INFORMAR quando não há centavos exatos (DEC-PT-015); nunca vira valor previsto.
 */
export function exactProductBrl(quantity: string, unitCents: number): string {
  if (!QUANTITY_PATTERN.test(quantity) || !Number.isSafeInteger(unitCents) || unitCents < 0) return '—'
  const [int, frac = ''] = quantity.split('.')
  const digits = (BigInt(`${int}${frac}`) * BigInt(unitCents)).toString().padStart(frac.length + 3, '0')
  // escala total = casas da quantidade + 2 (centavos)
  const scale = frac.length + 2
  const reais = digits.slice(0, digits.length - scale).replace(/^0+(?=\d)/, '')
  const decimals = digits.slice(digits.length - scale).replace(/0+$/, '').padEnd(2, '0')
  return `R$ ${reais.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimals}`
}

// ---------------------------------------------------------------------------
// Validação (servidor e interface usam a mesma)
// ---------------------------------------------------------------------------

export type FinErrorCode = 'required' | 'invalid' | 'too-long' | 'out-of-range' | 'duplicate-code' | 'unknown-category' | 'discontinued-category' | 'category-has-items' | 'too-many'
export type FinErrors = Partial<Record<string, FinErrorCode>>
export type FinValidation<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly errors: FinErrors }

// eslint-disable-next-line no-control-regex -- recusa intencional de caracteres de controle
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u2028\\u2029]')
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function text(raw: unknown, max: number, required = false, multiline = false): { value: string | null; error: FinErrorCode | null } {
  if (raw === undefined || raw === null || raw === '') return { value: null, error: required ? 'required' : null }
  if (typeof raw !== 'string') return { value: null, error: 'invalid' }
  const value = multiline ? raw.trim() : raw.trim().replace(/\s+/g, ' ')
  if (!value) return { value: null, error: required ? 'required' : null }
  if (CONTROL.test(value.replace(/[\n\r\t]/g, ' '))) return { value: null, error: 'invalid' }
  if (value.length > max) return { value: null, error: 'too-long' }
  return { value, error: null }
}

function stated<T>(raw: unknown, informed: (r: Record<string, unknown>) => { value: T | null; error: FinErrorCode | null }): { value: T | typeof NOT_INFORMED | { state: 'not-applicable' } | null; error: FinErrorCode | null } {
  if (raw === undefined) return { value: NOT_INFORMED, error: null }
  if (!isObject(raw)) return { value: null, error: 'invalid' }
  if (raw.state === 'not-informed' && Object.keys(raw).length === 1) return { value: NOT_INFORMED, error: null }
  if (raw.state === 'not-applicable' && Object.keys(raw).length === 1) return { value: { state: 'not-applicable' }, error: null }
  if (raw.state !== 'informed' || Object.keys(raw).length !== 2) return { value: null, error: 'invalid' }
  return informed(raw)
}

const money = (raw: unknown) =>
  stated<MoneyValue>(raw, (r) => (typeof r.cents === 'number' && Number.isSafeInteger(r.cents) && r.cents >= 0 && r.cents <= MAX_CENTS ? { value: { state: 'informed', cents: r.cents }, error: null } : { value: null, error: 'invalid' }))
const quantity = (raw: unknown) =>
  stated<QuantityValue>(raw, (r) => (typeof r.value === 'string' && QUANTITY_PATTERN.test(r.value) ? { value: { state: 'informed', value: r.value }, error: null } : { value: null, error: 'invalid' }))
const finText = (raw: unknown, max: number) =>
  stated<FinText>(raw, (r) => {
    const t = text(r.value, max, true, max > FIN_LIMITS.shortText)
    return t.error ? { value: null, error: t.error } : { value: { state: 'informed', value: t.value as string }, error: null }
  })

function base(raw: Record<string, unknown>, errors: FinErrors) {
  const code = text(raw.code, FIN_LIMITS.code, true)
  if (code.error) errors.code = code.error
  const status = raw.status ?? 'active'
  if (!FIN_STATUSES.includes(status as FinStatus)) errors.status = 'invalid'
  const order = raw.order ?? 0
  if (typeof order !== 'number' || !Number.isSafeInteger(order) || order < 0 || order > 10_000) errors.order = 'invalid'
  return { code: code.value as string, status: status as FinStatus, order: order as number }
}

const CATEGORY_KEYS = ['code', 'name', 'standardCategory', 'status', 'order']
const ITEM_KEYS = ['code', 'categoryId', 'description', 'unit', 'quantity', 'unitValue', 'plannedValue', 'fundingSource', 'fundingSourceDescription', 'period', 'details', 'calculationMemory', 'status', 'order']

export function validateFinancialCategory(input: unknown): FinValidation<FinancialCategoryData> {
  if (!isObject(input) || Object.keys(input).some((k) => !CATEGORY_KEYS.includes(k))) return { ok: false, errors: { category: 'invalid' } }
  const errors: FinErrors = {}
  const b = base(input, errors)
  const name = text(input.name, FIN_LIMITS.name, true)
  if (name.error) errors.name = name.error
  const std = input.standardCategory ?? null
  if (std !== null && !STANDARD_CATEGORIES.some((c) => c.id === std)) errors.standardCategory = 'invalid'
  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, data: { ...b, name: name.value as string, standardCategory: std as StandardCategoryId | null } }
}

/**
 * Valida um item COMPLETO; `categories` = categorias da MESMA versão (id → situação).
 * `mode: 'write'` (padrão) aplica as regras de gravação vigentes; `'read'` preserva a leitura de registros
 * anteriores (ex.: "Outra fonte" sem descrição, gravada antes da DEC-PT-017) sem convertê-los.
 */
export function validateFinancialItem(input: unknown, categories: ReadonlyMap<string, FinStatus>, mode: 'write' | 'read' = 'write'): FinValidation<FinancialItemData> {
  if (!isObject(input) || Object.keys(input).some((k) => !ITEM_KEYS.includes(k))) return { ok: false, errors: { item: 'invalid' } }
  const errors: FinErrors = {}
  const b = base(input, errors)
  const description = text(input.description, FIN_LIMITS.description, true, true)
  if (description.error) errors.description = description.error
  const categoryId = input.categoryId
  if (typeof categoryId !== 'string' || categoryId === '') errors.categoryId = 'required'
  else if (!isFinancialId(categoryId) || !categoryId.startsWith('c_') || !categories.has(categoryId)) errors.categoryId = 'unknown-category'
  else if (b.status === 'active' && categories.get(categoryId) === 'discontinued') errors.categoryId = 'discontinued-category'
  const unit = finText(input.unit, FIN_LIMITS.unit)
  const qty = quantity(input.quantity)
  const unitValue = money(input.unitValue)
  const plannedValue = money(input.plannedValue)
  const period = finText(input.period, FIN_LIMITS.shortText)
  const details = finText(input.details, FIN_LIMITS.description)
  const memory = finText(input.calculationMemory, FIN_LIMITS.description)
  for (const [k, r] of Object.entries({ unit, quantity: qty, unitValue, plannedValue, period, details, calculationMemory: memory })) if (r.error) errors[k] = r.error
  const source = input.fundingSource ?? null
  if (source !== null && !FUNDING_SOURCES.some((f) => f.id === source)) errors.fundingSource = 'invalid'
  const sourceDescription = text(input.fundingSourceDescription, FIN_LIMITS.shortText)
  if (sourceDescription.error) errors.fundingSourceDescription = sourceDescription.error
  else if (source === 'other' && !sourceDescription.value && mode === 'write') errors.fundingSourceDescription = 'required'
  else if (source !== 'other' && sourceDescription.value) errors.fundingSourceDescription = 'invalid'
  if (Object.keys(errors).length) return { ok: false, errors }
  return {
    ok: true,
    data: {
      ...b,
      categoryId: categoryId as string,
      description: description.value as string,
      unit: unit.value as FinText,
      quantity: qty.value as QuantityValue,
      unitValue: unitValue.value as MoneyValue,
      plannedValue: plannedValue.value as MoneyValue,
      fundingSource: source as FundingSource | null,
      fundingSourceDescription: source === 'other' ? sourceDescription.value : null,
      period: period.value as FinText,
      details: details.value as FinText,
      calculationMemory: memory.value as FinText,
    },
  }
}

export const FIN_ERROR_MESSAGE: Record<FinErrorCode, string> = {
  required: 'Campo obrigatório.',
  invalid: 'Conteúdo inválido.',
  'too-long': 'Texto acima do limite de caracteres.',
  'out-of-range': 'Valor fora do intervalo aceito.',
  'duplicate-code': 'Já existe registro com este código nesta versão.',
  'unknown-category': 'Selecione uma categoria desta versão.',
  'discontinued-category': 'A categoria está descontinuada nesta versão.',
  'category-has-items': 'Há itens ativos nesta categoria. Reclassifique ou descontinue-os antes de descontinuar a categoria.',
  'too-many': 'Quantidade acima do limite técnico por versão.',
}

/** Código único (sem diferenciar maiúsculas) por tipo e versão. */
export function isDuplicateFinancialCode(code: string, others: readonly { id: string; code: string }[], selfId: string | null): boolean {
  const key = code.toLocaleLowerCase('pt-BR')
  return others.some((o) => o.id !== selfId && o.code.toLocaleLowerCase('pt-BR') === key)
}

/** Integridade: categoria só é descontinuada sem itens ATIVOS; item ativo nunca aponta para categoria descontinuada/ausente. */
export function financialIntegrity(categories: readonly FinStored<FinancialCategoryData>[], items: readonly FinStored<FinancialItemData>[]): { readonly ok: true } | { readonly ok: false; readonly categoryId: string } {
  const status = new Map(categories.map((c) => [c.id, c.data.status]))
  for (const i of items) if (i.data.status === 'active' && status.get(i.data.categoryId) !== 'active') return { ok: false, categoryId: i.data.categoryId }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Totais PREVISTOS (somente itens ativos; sem saldo, sem realizado)
// ---------------------------------------------------------------------------

export interface PlannedTotals {
  /** Soma exata dos valores previstos INFORMADOS dos itens ativos. */
  readonly informedCents: number
  /** Itens ativos sem valor previsto informado (o total é parcial quando > 0). */
  readonly pendingItems: number
  /** Itens ativos com valor "não se aplica". */
  readonly notApplicableItems: number
  readonly itemCount: number
}

function sumTotals(items: readonly FinStored<FinancialItemData>[]): PlannedTotals {
  let cents = 0n
  let pending = 0
  let na = 0
  let count = 0
  for (const i of items) {
    if (i.data.status !== 'active') continue
    count++
    const v = i.data.plannedValue
    if (v.state === 'informed') cents += BigInt(v.cents)
    else if (v.state === 'not-applicable') na++
    else pending++
  }
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Soma acima do limite numérico seguro.')
  return { informedCents: Number(cents), pendingItems: pending, notApplicableItems: na, itemCount: count }
}

/** Previsto por categoria e total do Plano (referência futura da PAG-OSC09: previsto × realizado). */
export function plannedTotals(categories: readonly FinStored<FinancialCategoryData>[], items: readonly FinStored<FinancialItemData>[]) {
  return {
    total: sumTotals(items),
    byCategory: categories.map((c) => ({ categoryId: c.id, code: c.data.code, name: c.data.name, status: c.data.status, ...sumTotals(items.filter((i) => i.data.categoryId === c.id)) })),
  }
}

/** Pontos de atenção do item (avisos; sem regra homologada de bloqueio). */
export function itemWarnings(d: FinancialItemData): readonly string[] {
  const w: string[] = []
  if (d.status !== 'active') return w
  if (d.plannedValue.state === 'not-informed') w.push('Valor previsto não informado.')
  if (d.quantity.state === 'informed' && d.unitValue.state === 'informed') {
    const derived = derivedTotalCents(d.quantity.value, d.unitValue.cents)
    // DEC-PT-015: fração de centavo é exibida EXATA, sem arredondar, truncar ou sugerir valor aproximado.
    if (derived === null) w.push(`Quantidade × valor unitário = ${exactProductBrl(d.quantity.value, d.unitValue.cents)}, que não corresponde a centavos exatos; prevalece o valor previsto informado.`)
    // DEC-PT-014: divergência é apenas informativa (não bloqueia, não exige justificativa, não corrige).
    else if (d.plannedValue.state === 'informed' && derived !== d.plannedValue.cents)
      w.push(`Quantidade × valor unitário (${formatCents(derived)}) difere do valor previsto informado (${formatCents(d.plannedValue.cents)}); diferença de ${formatCents(Math.abs(derived - d.plannedValue.cents))}. Prevalece o valor previsto.`)
  }
  return w
}

// ---------------------------------------------------------------------------
// Aplicabilidade por instrumento (DEC-021/037, títulos; DEC-PAR-005)
// ---------------------------------------------------------------------------

/**
 * Instrumento SEM transferência de recursos (Acordo de Cooperação): planejamento financeiro "não se
 * aplica" — derivado do instrumento cadastrado, nunca representado por valor zero.
 */
export function financialApplicability(instrument: InstrumentId): 'applicable' | 'not-applicable' {
  return hasFinancialTransfer(instrument) ? 'applicable' : 'not-applicable'
}

// ---------------------------------------------------------------------------
// Comparação entre versões (identificador LÓGICO); valor ≠ descrição
// ---------------------------------------------------------------------------

export type FinDiffKind = 'unchanged' | 'changed' | 'included' | 'discontinued' | 'reactivated'
export interface FinDiff {
  readonly id: string
  readonly kind: FinancialKind
  readonly code: string
  readonly diff: FinDiffKind
  /** Campos alterados (exceto ordem e situação). */
  readonly fields: readonly string[]
  /** Variação do valor previsto (centavos), quando ambos informados. */
  readonly plannedDeltaCents: number | null
  readonly beforeCents: number | null
  readonly afterCents: number | null
}

const stable = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (isObject(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x))

export function diffFinancial<T extends FinancialCategoryData | FinancialItemData>(kind: FinancialKind, before: readonly FinStored<T>[], after: readonly FinStored<T>[]): readonly FinDiff[] {
  const prev = new Map(before.map((c) => [c.id, c]))
  const cents = (d: T | undefined) => {
    const v = d && 'plannedValue' in d ? d.plannedValue : null
    return v && v.state === 'informed' ? v.cents : null
  }
  const out: FinDiff[] = []
  for (const c of after) {
    const p = prev.get(c.id)
    const a = cents(c.data)
    if (!p) {
      out.push({ id: c.id, kind, code: c.data.code, diff: c.data.status === 'active' ? 'included' : 'discontinued', fields: [], plannedDeltaCents: null, beforeCents: null, afterCents: a })
      continue
    }
    const fields = Object.keys(c.data).filter((k) => k !== 'order' && k !== 'status' && stable((c.data as unknown as Record<string, unknown>)[k]) !== stable((p.data as unknown as Record<string, unknown>)[k]))
    const b = cents(p.data)
    const status = p.data.status !== c.data.status ? (c.data.status === 'discontinued' ? 'discontinued' : 'reactivated') : null
    out.push({ id: c.id, kind, code: c.data.code, diff: status ?? (fields.length ? 'changed' : 'unchanged'), fields, plannedDeltaCents: a !== null && b !== null ? a - b : null, beforeCents: b, afterCents: a })
  }
  for (const p of before) if (!after.some((c) => c.id === p.id)) out.push({ id: p.id, kind, code: p.data.code, diff: 'discontinued', fields: [], plannedDeltaCents: null, beforeCents: cents(p.data), afterCents: null })
  return out
}

export const FIN_DIFF_LABEL: Record<FinDiffKind, string> = { unchanged: 'Mantido', changed: 'Alterado', included: 'Incluído', discontinued: 'Descontinuado', reactivated: 'Reativado' }

export const ITEM_FIELD_LABEL: Record<keyof FinancialItemData, string> = {
  code: 'Código',
  categoryId: 'Categoria',
  description: 'Descrição',
  unit: 'Unidade de medida',
  quantity: 'Quantidade prevista',
  unitValue: 'Valor unitário previsto',
  plannedValue: 'Valor previsto',
  fundingSource: 'Fonte prevista',
  fundingSourceDescription: 'Descrição da outra fonte',
  period: 'Período ou referência temporal',
  details: 'Detalhamento',
  calculationMemory: 'Memória de cálculo',
  status: 'Situação na versão',
  order: 'Ordem',
}
export const CATEGORY_FIELD_LABEL: Record<keyof FinancialCategoryData, string> = {
  code: 'Código',
  name: 'Nome',
  standardCategory: 'Categoria padronizada',
  status: 'Situação na versão',
  order: 'Ordem',
}

export const finLabel = <T extends { id: string; label: string }>(list: readonly T[], id: string | null | undefined): string => list.find((x) => x.id === id)?.label ?? '—'

// ---------------------------------------------------------------------------
// DEC-PT-013 — valor previsto obrigatório nos itens ATIVOS (finalização e encerramento)
// ---------------------------------------------------------------------------

/** Itens ATIVOS sem valor previsto INFORMADO (zero informado é aceito; descontinuados não contam). */
export function itemsMissingPlannedValue(items: readonly FinStored<FinancialItemData>[]): readonly FinStored<FinancialItemData>[] {
  return items.filter((i) => i.data.status === 'active' && i.data.plannedValue.state !== 'informed')
}

export const missingValueMessage = (code: string) => `Item financeiro ${code}: valor previsto não informado (obrigatório para itens ativos; zero informado é aceito).`

/** Pendências financeiras OBRIGATÓRIAS (DEC-PT-013) + integridade categoria–item. Sem conferência documental (DEC-PT-012). */
export function financialPending(categories: readonly FinStored<FinancialCategoryData>[], items: readonly FinStored<FinancialItemData>[]): readonly string[] {
  const pending = itemsMissingPlannedValue(items).map((i) => missingValueMessage(i.data.code))
  if (!financialIntegrity(categories, items).ok) pending.push('Há item financeiro ativo vinculado a categoria descontinuada ou inexistente.')
  return pending
}

// ---------------------------------------------------------------------------
// DEC-PT-011 — impressão digital do conjunto financeiro conferido
// ---------------------------------------------------------------------------

/** IDs e revisões de categorias e itens + vínculo item→categoria (FNV-1a 32 bits), recalculada no servidor. */
export function financialToken(categories: readonly { id: string; revision: number }[], items: readonly { id: string; revision: number; data: { categoryId: string } }[]): string {
  const key = [...categories.map((c) => `c:${c.id}:${c.revision}`), ...items.map((i) => `f:${i.id}:${i.revision}:${i.data.categoryId}`)].sort().join('|')
  let hash = 0x811c9dc5
  for (let n = 0; n < key.length; n++) {
    hash ^= key.charCodeAt(n)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${categories.length}.${items.length}-${hash.toString(16).padStart(8, '0')}`
}
export const FINANCIAL_TOKEN_PATTERN = /^\d{1,3}\.\d{1,3}-[0-9a-f]{8}$/

/** DEC-PT-011: declaração de ABERTURA da incorporação financeira. */
export const FINANCIAL_TRANSCRIPTION_DECLARATION =
  'Declaro que as categorias, os itens e os valores financeiros a serem incorporados correspondem ao planejamento financeiro constante do Plano de Trabalho formalmente aprovado e que este procedimento não representa alteração formal do seu conteúdo.'
/** DEC-PT-011: declaração FINAL de correspondência no encerramento (distinta da conferência opcional da DEC-PT-012). */
export const FINANCIAL_CLOSE_DECLARATION =
  'Declaro que as categorias, os itens e os valores financeiros incorporados correspondem ao planejamento financeiro do Plano de Trabalho formalmente aprovado.'
