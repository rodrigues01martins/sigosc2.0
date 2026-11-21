/**
 * Formulários do planejamento financeiro (DEV-02.5) — conversão PURA entre o digitado e o registro
 * validado pelo domínio. Dinheiro em centavos lido como TEXTO ("1.200,00" = mil e duzentos reais);
 * vazio = não informado; "Não se aplica" = não aplicável; "0,00" = zero informado.
 */
import {
  formatCents,
  formatQuantity,
  parseBrlToCents,
  parseQuantity,
  type FinancialCategoryData,
  type FinancialItemData,
  type FinText,
  type MoneyValue,
  type QuantityValue,
} from '../../../domain/workPlanFinancial.ts'

export interface Opt {
  text: string
  na: boolean
}
const empty: Opt = { text: '', na: false }
const centsText = (cents: number) => formatCents(cents).replace(/^R\$ /, '')
const optMoney = (v: MoneyValue): Opt => ({ text: v.state === 'informed' ? centsText(v.cents) : '', na: v.state === 'not-applicable' })
const optQty = (v: QuantityValue): Opt => ({ text: v.state === 'informed' ? formatQuantity(v.value) : '', na: v.state === 'not-applicable' })
const optText = (v: FinText): Opt => ({ text: v.state === 'informed' ? v.value : '', na: v.state === 'not-applicable' })

export function toMoney(o: Opt): MoneyValue | 'invalid' {
  if (o.na) return { state: 'not-applicable' }
  const c = parseBrlToCents(o.text)
  if (c === 'invalid') return 'invalid'
  return c === null ? { state: 'not-informed' } : { state: 'informed', cents: c }
}
export function toQty(o: Opt): QuantityValue | 'invalid' {
  if (o.na) return { state: 'not-applicable' }
  const q = parseQuantity(o.text)
  if (q === 'invalid') return 'invalid'
  return q === null ? { state: 'not-informed' } : { state: 'informed', value: q }
}
export const toFinText = (o: Opt): FinText => (o.na ? { state: 'not-applicable' } : o.text.trim() ? { state: 'informed', value: o.text } : { state: 'not-informed' })

// ------------------------------------------------------------------ categoria

export interface CategoryForm {
  code: string
  name: string
  standardCategory: string
  status: 'active' | 'discontinued'
}
export const categoryFormFrom = (d: FinancialCategoryData | null, suggestedCode: string): CategoryForm =>
  d ? { code: d.code, name: d.name, standardCategory: d.standardCategory ?? '', status: d.status } : { code: suggestedCode, name: '', standardCategory: '', status: 'active' }
export const categoryFromForm = (f: CategoryForm, order: number) => ({ code: f.code, name: f.name, standardCategory: f.standardCategory || null, status: f.status, order })

// ------------------------------------------------------------------ item

export interface ItemForm {
  code: string
  categoryId: string
  description: string
  unit: Opt
  quantity: Opt
  unitValue: Opt
  plannedValue: Opt
  fundingSource: string
  fundingSourceDescription: string
  period: Opt
  details: Opt
  calculationMemory: Opt
  status: 'active' | 'discontinued'
}
export function itemFormFrom(d: FinancialItemData | null, suggestedCode: string, presetCategory: string | null): ItemForm {
  if (!d)
    return {
      code: suggestedCode,
      categoryId: presetCategory ?? '',
      description: '',
      unit: empty,
      quantity: empty,
      unitValue: empty,
      plannedValue: empty,
      fundingSource: '',
      fundingSourceDescription: '',
      period: empty,
      details: empty,
      calculationMemory: empty,
      status: 'active',
    }
  return {
    code: d.code,
    categoryId: d.categoryId,
    description: d.description,
    unit: optText(d.unit),
    quantity: optQty(d.quantity),
    unitValue: optMoney(d.unitValue),
    plannedValue: optMoney(d.plannedValue),
    fundingSource: d.fundingSource ?? '',
    fundingSourceDescription: d.fundingSourceDescription ?? '',
    period: optText(d.period),
    details: optText(d.details),
    calculationMemory: optText(d.calculationMemory),
    status: d.status,
  }
}
export function itemFromForm(f: ItemForm, order: number): Record<string, unknown> | { invalid: 'quantity' | 'unitValue' | 'plannedValue' } {
  const quantity = toQty(f.quantity)
  if (quantity === 'invalid') return { invalid: 'quantity' }
  const unitValue = toMoney(f.unitValue)
  if (unitValue === 'invalid') return { invalid: 'unitValue' }
  const plannedValue = toMoney(f.plannedValue)
  if (plannedValue === 'invalid') return { invalid: 'plannedValue' }
  return {
    code: f.code,
    categoryId: f.categoryId,
    description: f.description,
    unit: toFinText(f.unit),
    quantity,
    unitValue,
    plannedValue,
    fundingSource: f.fundingSource || null,
    // DEC-PT-017: descrição só para "Outra fonte" (nas demais, nula — nada é presumido).
    fundingSourceDescription: f.fundingSource === 'other' ? f.fundingSourceDescription : null,
    period: toFinText(f.period),
    details: toFinText(f.details),
    calculationMemory: toFinText(f.calculationMemory),
    status: f.status,
    order,
  }
}

/** Próximo código sugerido ("F1", "C1"), editável. */
export function nextFinancialCode(prefix: 'F' | 'C', codes: readonly string[]): string {
  const used = new Set(codes.map((c) => c.toLocaleUpperCase('pt-BR')))
  for (let n = 1; n < 1000; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`
  return ''
}

export const showMoney = (v: MoneyValue) => (v.state === 'informed' ? formatCents(v.cents) : v.state === 'not-applicable' ? 'Não se aplica' : 'Não informado')
export const showQty = (v: QuantityValue) => (v.state === 'informed' ? formatQuantity(v.value) : v.state === 'not-applicable' ? 'Não se aplica' : 'Não informada')
export const showText = (v: FinText) => (v.state === 'informed' ? v.value : v.state === 'not-applicable' ? 'Não se aplica' : 'Não informado')
export { formatCents, centsText }
