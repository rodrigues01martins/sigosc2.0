/** DEV-02.5 — Planejamento financeiro PREVISTO (domínio puro; `npm test`). Gravação real em tests/server. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  derivedTotalCents,
  diffFinancial,
  financialApplicability,
  financialIntegrity,
  formatCents,
  formatQuantity,
  itemWarnings,
  parseBrlToCents,
  parseQuantity,
  plannedTotals,
  validateFinancialCategory,
  validateFinancialItem,
  type FinancialCategoryData,
  type FinancialItemData,
  type FinStatus,
  type FinStored,
} from './workPlanFinancial.ts'

const C1 = 'c_00000000000000000001'
const C2 = 'c_00000000000000000002'
const cats = new Map<string, FinStatus>([[C1, 'active'], [C2, 'discontinued']])
const item = (extra: Record<string, unknown> = {}) => ({ code: 'F1', categoryId: C1, description: 'Recursos humanos — coordenação', plannedValue: { state: 'informed', cents: 32_000_000 }, ...extra })
const ok = <T,>(v: { ok: boolean; data?: T }) => (v as { ok: true; data: T }).data
const stored = <T,>(id: string, kind: 'financial-category' | 'financial-item', data: T): FinStored<T> => ({ id, kind, data, revision: 1 })

test('DEV-02.5-T10/T11 — moeda no padrão brasileiro, em centavos inteiros, sem arredondamento silencioso', () => {
  for (const [raw, cents] of [['1.200', 120_000], ['1.200,00', 120_000], ['1.234,56', 123_456], ['0,00', 0], ['R$ 320.000,00', 32_000_000], ['12,5', 1250], ['999.999.999.999,99', 99_999_999_999_999]] as const) assert.equal(parseBrlToCents(raw), cents, raw)
  for (const raw of ['1,234', '12.34', '1.20', 'abc', '-1', '1e3', '1.000.000.000.000,01']) assert.equal(parseBrlToCents(raw), 'invalid', raw)
  assert.equal(parseBrlToCents(''), null)
  assert.equal(formatCents(123_456), 'R$ 1.234,56')
  assert.equal(formatCents(5), 'R$ 0,05')
  assert.equal(formatCents(99_999_999_999_999), 'R$ 999.999.999.999,99')
  // Somatório exato (0,10 + 0,20 = 0,30), sem ponto flutuante.
  const list = [10, 20].map((c, n) => stored(`f_0000000000000000000${n}`, 'financial-item', ok<FinancialItemData>(validateFinancialItem(item({ code: `F${n}`, plannedValue: { state: 'informed', cents: c } }), cats))))
  assert.equal(plannedTotals([stored(C1, 'financial-category', ok<FinancialCategoryData>(validateFinancialCategory({ code: 'C1', name: 'RH' })))], list).total.informedCents, 30)
  const source = readFileSync(new URL('./workPlanFinancial.ts', import.meta.url), 'utf8')
  assert.equal(/\beval\s*\(|new Function\s*\(/.test(source), false)
})

test('DEV-02.5-T07/T08/T09 — quantidade decimal exata, valor unitário e valor global; derivado sem arredondar', () => {
  assert.equal(parseQuantity('1.200'), '1200')
  assert.equal(parseQuantity('12,5'), '12.5')
  assert.equal(parseQuantity('0,2500'), '0.25')
  assert.equal(parseQuantity('1,23456'), 'invalid')
  assert.equal(formatQuantity('1200.5'), '1.200,5')
  assert.equal(derivedTotalCents('12', 150_000), 1_800_000)
  assert.equal(derivedTotalCents('2.5', 333), null, '2,5 × R$ 3,33 = R$ 8,325: sem centavos exatos, sem valor derivado')
  assert.equal(derivedTotalCents('0.5', 1_000), 500)
  const global = ok<FinancialItemData>(validateFinancialItem(item(), cats))
  assert.deepEqual([global.quantity, global.unitValue], [{ state: 'not-informed' }, { state: 'not-informed' }]) // valor global sem quantidade
  const detailed = ok<FinancialItemData>(validateFinancialItem(item({ quantity: { state: 'informed', value: '12' }, unitValue: { state: 'informed', cents: 150_000 }, plannedValue: { state: 'informed', cents: 1_700_000 } }), cats))
  assert.match(itemWarnings(detailed).join(' '), /difere do valor previsto informado \(R\$ 17\.000,00\)/) // não substitui o valor do Plano
  assert.ok(!validateFinancialItem(item({ quantity: { state: 'informed', value: '1,5' } }), cats).ok, 'quantidade canônica com ponto decimal')
  assert.ok(!validateFinancialItem(item({ unitValue: { state: 'informed', cents: 1.5 } }), cats).ok, 'centavos inteiros')
})

test('DEV-02.5-T03/T05/T06 — descrição e categoria obrigatórias; zero ≠ não informado ≠ não aplicável', () => {
  const missing = validateFinancialItem({ code: 'F1' }, cats)
  assert.ok(!missing.ok && missing.errors.description === 'required' && missing.errors.categoryId === 'required')
  assert.ok(!validateFinancialItem(item({ categoryId: 'c_99999999999999999999' }), cats).ok)
  const disc = validateFinancialItem(item({ categoryId: C2 }), cats)
  assert.ok(!disc.ok && disc.errors.categoryId === 'discontinued-category')
  const zero = ok<FinancialItemData>(validateFinancialItem(item({ plannedValue: { state: 'informed', cents: 0 } }), cats))
  const none = ok<FinancialItemData>(validateFinancialItem(item({ plannedValue: { state: 'not-informed' } }), cats))
  const na = ok<FinancialItemData>(validateFinancialItem(item({ plannedValue: { state: 'not-applicable' } }), cats))
  assert.deepEqual([zero.plannedValue, none.plannedValue, na.plannedValue], [{ state: 'informed', cents: 0 }, { state: 'not-informed' }, { state: 'not-applicable' }])
  assert.match(itemWarnings(none).join(' '), /Valor previsto não informado/)
  assert.ok(!validateFinancialCategory({ code: 'C1' }).ok)
  assert.ok(!validateFinancialCategory({ code: 'C1', name: 'X', standardCategory: 'juridica-inventada' }).ok)
  assert.ok(validateFinancialCategory({ code: 'C1', name: 'Pessoal', standardCategory: null }).ok, 'classificação própria do Plano')
})

test('DEV-02.5-T02 — instrumento sem transferência: planejamento "não se aplica" (nunca zero)', () => {
  assert.equal(financialApplicability('acordo-cooperacao'), 'not-applicable')
  assert.equal(financialApplicability('termo-colaboracao'), 'applicable')
  assert.equal(financialApplicability('termo-fomento'), 'applicable')
})

test('DEV-02.5-T12 — totais previstos por categoria e do Plano; pendentes e descontinuados', () => {
  const c1 = stored(C1, 'financial-category', ok<FinancialCategoryData>(validateFinancialCategory({ code: 'C1', name: 'Recursos Humanos', standardCategory: 'recursos-humanos' })))
  const items = [
    stored('f_00000000000000000001', 'financial-item', ok<FinancialItemData>(validateFinancialItem(item({ plannedValue: { state: 'informed', cents: 32_000_000 } }), cats))),
    stored('f_00000000000000000002', 'financial-item', ok<FinancialItemData>(validateFinancialItem(item({ code: 'F2', plannedValue: { state: 'informed', cents: 10_000_050 } }), cats))),
    stored('f_00000000000000000003', 'financial-item', ok<FinancialItemData>(validateFinancialItem(item({ code: 'F3', plannedValue: { state: 'not-informed' } }), cats))),
    stored('f_00000000000000000004', 'financial-item', ok<FinancialItemData>(validateFinancialItem(item({ code: 'F4', plannedValue: { state: 'informed', cents: 999 }, status: 'discontinued' }), cats))),
  ]
  const t = plannedTotals([c1], items)
  assert.deepEqual(t.total, { informedCents: 42_000_050, pendingItems: 1, notApplicableItems: 0, itemCount: 3 })
  assert.equal(t.byCategory[0]?.informedCents, 42_000_050)
  assert.deepEqual(financialIntegrity([{ ...c1, data: { ...c1.data, status: 'discontinued' } }], items), { ok: false, categoryId: C1 })
})

test('DEV-02.5-T24/T25 — comparação por ID lógico: valor ≠ descrição; incluído, alterado, descontinuado', () => {
  const v = (data: Record<string, unknown>, id = 'f_00000000000000000001') => stored(id, 'financial-item', ok<FinancialItemData>(validateFinancialItem(item(data), cats)))
  const before = [v({}), v({ code: 'F2' }, 'f_00000000000000000002')]
  const after = [v({ plannedValue: { state: 'informed', cents: 35_000_000 } }), v({ code: 'F2', description: 'Nova redação' }, 'f_00000000000000000002'), v({ code: 'F3' }, 'f_00000000000000000003')]
  const d = Object.fromEntries(diffFinancial('financial-item', before, after).map((x) => [x.code, x]))
  assert.deepEqual([d.F1?.diff, d.F1?.fields, d.F1?.plannedDeltaCents], ['changed', ['plannedValue'], 3_000_000])
  assert.deepEqual([d.F2?.diff, d.F2?.fields, d.F2?.plannedDeltaCents], ['changed', ['description'], 0])
  assert.equal(d.F3?.diff, 'included')
  assert.equal(diffFinancial('financial-item', after, [v({ status: 'discontinued', plannedValue: { state: 'informed', cents: 35_000_000 } })]).find((x) => x.code === 'F1')?.diff, 'discontinued')
})

test('DEV-02.5-T28 — sem receitas, despesas ou saldos: campos de realizado recusados', () => {
  for (const key of ['receivedCents', 'spentCents', 'balance', 'realized', 'receipt']) {
    assert.ok(!validateFinancialItem(item({ [key]: 1 }), cats).ok, key)
    assert.ok(!validateFinancialCategory({ code: 'C1', name: 'X', [key]: 1 }).ok, key)
  }
})

// ============================================================================ DEV-02.5-C01
import { STANDARD_CATEGORIES, exactProductBrl, financialPending, financialToken, itemsMissingPlannedValue } from './workPlanFinancial.ts'
import { decideVersionCreation } from './workPlanVersions.ts'

test('DEV-02.5-C01-T23/T24/T25/T26 — valor previsto obrigatório só para itens ATIVOS; zero informado aceito', () => {
  const v = (id: string, extra: Record<string, unknown>) => stored(id, 'financial-item', ok<FinancialItemData>(validateFinancialItem(item({ code: id.slice(-2), ...extra }), cats)))
  const items = [
    v('f_000000000000000000a1', { plannedValue: { state: 'not-informed' } }),
    v('f_000000000000000000a2', { plannedValue: { state: 'not-applicable' } }),
    v('f_000000000000000000a3', { plannedValue: { state: 'informed', cents: 0 } }),
    v('f_000000000000000000a4', { plannedValue: { state: 'not-informed' }, status: 'discontinued' }),
  ]
  assert.deepEqual(itemsMissingPlannedValue(items).map((i) => i.id), ['f_000000000000000000a1', 'f_000000000000000000a2'])
  const c1 = stored(C1, 'financial-category', ok<FinancialCategoryData>(validateFinancialCategory({ code: 'C1', name: 'RH' })))
  assert.equal(financialPending([c1], items).length, 2)
  assert.deepEqual(financialPending([c1], [items[2] as FinStored<FinancialItemData>]), [])
})

test('DEV-02.5-C01-T30 — fração de centavo exibida exata (sem arredondar nem truncar)', () => {
  assert.equal(exactProductBrl('2.5', 333), 'R$ 8,325')
  assert.equal(exactProductBrl('0.3333', 1), 'R$ 0,003333')
  assert.equal(exactProductBrl('1200', 1550), 'R$ 18.600,00')
  assert.equal(exactProductBrl('9999.9999', 99_999_999), 'R$ 9.999.999.800,000001')
  const source = readFileSync(new URL('./workPlanFinancial.ts', import.meta.url), 'utf8')
  assert.equal(/Math\.round|toFixed|parseFloat/.test(source), false, 'sem arredondamento por ponto flutuante')
})

test('DEV-02.5-C01-T33/T34 — "Outra fonte" exige descrição na gravação; registros anteriores preservados na leitura', () => {
  const other = validateFinancialItem(item({ fundingSource: 'other' }), cats)
  assert.ok(!other.ok && other.errors.fundingSourceDescription === 'required')
  const described = ok<FinancialItemData>(validateFinancialItem(item({ fundingSource: 'other', fundingSourceDescription: 'Doação privada' }), cats))
  assert.deepEqual([described.fundingSource, described.fundingSourceDescription], ['other', 'Doação privada'])
  const legacy = validateFinancialItem(item({ fundingSource: 'other' }), cats, 'read')
  assert.ok(legacy.ok && legacy.data.fundingSourceDescription === null, 'leitura sem conversão de registro anterior')
  assert.ok(!validateFinancialItem(item({ fundingSource: 'counterpart', fundingSourceDescription: 'x' }), cats).ok, 'descrição só para "Outra fonte"')
  const none = ok<FinancialItemData>(validateFinancialItem(item({}), cats))
  assert.deepEqual([none.fundingSource, none.fundingSourceDescription], [null, null]) // T34: não informada, sem receita
  assert.deepEqual(STANDARD_CATEGORIES.map((c) => c.label), ['Recursos Humanos', 'Serviços de Terceiros', 'Material de Consumo', 'Outras Despesas']) // T32
})

test('DEV-02.5-C01-T14/T19 — impressão digital financeira; nova versão bloqueada com incorporação financeira aberta', () => {
  const c = [{ id: C1, revision: 1 }]
  const first = { id: 'f_000000000000000000a1', revision: 2, data: { categoryId: C1 } }
  const i = [first]
  assert.equal(financialToken(c, i), financialToken([...c], [...i]))
  assert.notEqual(financialToken(c, i), financialToken(c, [{ ...first, revision: 3 }]))
  assert.notEqual(financialToken(c, i), financialToken(c, [{ ...first, data: { categoryId: C2 } }]), 'vínculo item→categoria integra a impressão digital')
  assert.match(financialToken([], []), /^0\.0-[0-9a-f]{8}$/)
  const editor = { uid: 'u', oscId: 'osc', organization: { id: 'osc', registrationStatus: 'active', commercialStatus: 'active', administratorUid: 'a' }, membership: { uid: 'u', status: 'active', permissions: ['work-plan.edit'], canManagePermissions: false } } as const
  const base = [{ id: 'original', sequence: 1, registrationStatus: 'finalized' as const, activationStatus: null, financialTranscriptionOpen: true }]
  assert.deepEqual(decideVersionCreation(editor as never, 'em-execucao', base, 'original'), { allowed: false, reason: 'financial-transcription-open' })
})
