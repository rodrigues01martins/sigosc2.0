/** DEV-02.4 — Metas e indicadores PREVISTOS (domínio puro; `npm test`). Gravação real em tests/server. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { diffComponents, isDuplicateCode, linkIntegrity, periodicityLabel, validateGoal, validateIndicator, type GoalData, type IndicatorData, type Stored } from './workPlanComponents.ts'

const G1 = 'g_00000000000000000001'
const G2 = 'g_00000000000000000002'
const known = new Set([G1, G2])
const goal = (extra: Record<string, unknown> = {}) => ({
  code: 'Meta 01',
  description: 'Atender 200 participantes em ações de inclusão social',
  nature: 'quantitative',
  unit: { state: 'informed', value: 'participantes' },
  expectedQuantity: { state: 'informed', value: 200 },
  ...extra,
})
const indicator = (extra: Record<string, unknown> = {}) => ({
  code: 'IND-01',
  name: 'Percentual de participantes concluintes',
  nature: 'quantitative',
  measurementType: 'percentage',
  target: { state: 'informed', value: 80 },
  unit: { state: 'informed', value: '%' },
  periodicity: { state: 'informed', value: { kind: 'monthly', description: null } },
  rule: { method: 'ratio', description: '(concluintes ÷ inscritos) × 100', numerator: 'concluintes', denominator: 'inscritos', multiplier: 100 },
  goalIds: [G1],
  ...extra,
})

test('DEV-02.4-T05/T06 — meta: obrigatórios (código, descrição, natureza); quantitativa ≠ qualitativa', () => {
  const ok = validateGoal(goal())
  assert.ok(ok.ok)
  if (ok.ok) assert.deepEqual([ok.data.status, ok.data.order, ok.data.expectedResult], ['active', 0, { state: 'not-informed' }])
  const missing = validateGoal({})
  assert.ok(!missing.ok && missing.errors.code === 'required' && missing.errors.description === 'required' && missing.errors.nature === 'required')
  // Qualitativa não recebe quantidade numérica (não se converte qualitativo em número).
  const qual = validateGoal(goal({ nature: 'qualitative', expectedResult: { state: 'informed', value: 'Fortalecimento comunitário' } }))
  assert.ok(!qual.ok && qual.errors.expectedQuantity === 'invalid')
  assert.ok(validateGoal(goal({ nature: 'qualitative', expectedQuantity: { state: 'not-informed' }, unit: { state: 'not-informed' } })).ok)
  assert.ok(!validateGoal(goal({ nature: 'percentual' })).ok)
})

test('DEV-02.4-T07/T08 — resultado previsto preservado; zero ≠ não informado ≠ não aplicável', () => {
  const zero = validateGoal(goal({ expectedQuantity: { state: 'informed', value: 0 } }))
  assert.ok(zero.ok && zero.data.expectedQuantity.state === 'informed' && zero.data.expectedQuantity.value === 0)
  const none = validateGoal(goal({ expectedQuantity: { state: 'not-informed' } }))
  assert.ok(none.ok && none.data.expectedQuantity.state === 'not-informed')
  const na = validateGoal(goal({ expectedQuantity: { state: 'not-applicable' } }))
  assert.ok(na.ok && na.data.expectedQuantity.state === 'not-applicable')
  const decimal = validateIndicator(indicator({ target: { state: 'informed', value: 12.5 } }), known)
  assert.ok(decimal.ok && decimal.data.target.state === 'informed' && decimal.data.target.value === 12.5)
  for (const bad of [{ state: 'informed', value: '80' }, { state: 'informed', value: Number.NaN }, { state: 'informed' }, { state: 'informed', value: 1e15 }, { state: 'informed', value: 0.1234567 }])
    assert.ok(!validateIndicator(indicator({ target: bad }), known).ok, JSON.stringify(bad))
})

test('DEV-02.4-T06 — indicador quantitativo exige tipo numérico; qualitativo não vira percentual', () => {
  assert.ok(!validateIndicator(indicator({ measurementType: undefined }), known).ok)
  for (const m of ['absolute', 'quantity', 'percentage', 'ratio', 'rate', 'other']) assert.ok(validateIndicator(indicator({ measurementType: m }), known).ok, m)
  const qualitative = {
    code: 'IND-02',
    name: 'Satisfação das famílias atendidas',
    nature: 'qualitative',
    expectedParameter: { state: 'informed', value: 'Famílias relatam melhoria do convívio' },
    rule: { method: 'described', description: 'Escuta qualificada semestral com as famílias' },
    categories: ['Atendido', 'Parcialmente atendido', 'Não atendido'],
  }
  const q = validateIndicator(qualitative, known)
  assert.ok(q.ok && q.data.measurementType === null && q.data.target.state === 'not-informed' && q.data.categories.length === 3)
  assert.ok(!validateIndicator({ ...qualitative, target: { state: 'informed', value: 80 } }, known).ok)
  assert.ok(!validateIndicator({ ...qualitative, measurementType: 'percentage' }, known).ok)
  assert.ok(!validateIndicator({ ...qualitative, rule: { method: 'ratio', description: 'x', numerator: 'a', denominator: 'b' } }, known).ok)
  assert.ok(!validateIndicator({ ...qualitative, categories: ['A', 'a'] }, known).ok, 'categorias duplicadas')
  assert.ok(!validateIndicator(indicator({ categories: ['Bom'] }), known).ok, 'quantitativo sem escala qualitativa')
})

test('DEV-02.4-T09 — periodicidade INDIVIDUAL; "outra" exige descrição; pode não ser informada', () => {
  const quarterly = validateIndicator(indicator({ periodicity: { state: 'informed', value: { kind: 'quarterly', description: null } } }), known)
  assert.ok(quarterly.ok && periodicityLabel(quarterly.data.periodicity) === 'Trimestral')
  const custom = validateIndicator(indicator({ periodicity: { state: 'informed', value: { kind: 'other', description: 'No 6º e no 18º mês' } } }), known)
  assert.ok(custom.ok && periodicityLabel(custom.data.periodicity) === 'No 6º e no 18º mês')
  assert.ok(!validateIndicator(indicator({ periodicity: { state: 'informed', value: { kind: 'other', description: '' } } }), known).ok)
  assert.ok(!validateIndicator(indicator({ periodicity: { state: 'informed', value: { kind: 'weekly-ish', description: null } } }), known).ok)
  const none = validateIndicator(indicator({ periodicity: undefined }), known)
  assert.ok(none.ok && periodicityLabel(none.data.periodicity) === 'Não informada')
})

test('DEV-02.4-T10/T11 — fórmula/regra estruturada; texto nunca executado; sem eval', () => {
  const ratio = validateIndicator(indicator(), known)
  assert.ok(ratio.ok && ratio.data.rule.numerator === 'concluintes' && ratio.data.rule.multiplier === 100)
  assert.ok(!validateIndicator(indicator({ rule: { method: 'ratio', description: 'x' } }), known).ok, 'razão exige numerador e denominador')
  assert.ok(!validateIndicator(indicator({ rule: { method: 'sum', description: 'x', multiplier: -1 } }), known).ok)
  assert.ok(!validateIndicator(indicator({ rule: { method: 'eval', description: 'x' } }), known).ok)
  assert.ok(!validateIndicator(indicator({ rule: { method: 'described', description: '' } }), known).ok)
  assert.ok(!validateIndicator(indicator({ rule: { method: 'described', description: 'x', code: 'process.exit()' } }), known).ok, 'chaves estranhas')
  // Conteúdo "malicioso" é apenas TEXTO armazenado: nada é avaliado.
  let touched = false
  Object.defineProperty(globalThis, '__sigosc_probe', { configurable: true, set: () => (touched = true) })
  const hostile = validateIndicator(indicator({ rule: { method: 'described', description: "globalThis.__sigosc_probe = 1; require('fs')" } }), known)
  assert.ok(hostile.ok && hostile.data.rule.description.startsWith('globalThis.__sigosc_probe'))
  assert.equal(touched, false)
  delete (globalThis as Record<string, unknown>).__sigosc_probe
  const source = readFileSync(new URL('./workPlanComponents.ts', import.meta.url), 'utf8')
  assert.equal(/\beval\s*\(|new Function\s*\(/.test(source), false, 'domínio sem eval/new Function')
  assert.ok(!validateIndicator(indicator({ name: 'Nome\u0000oculto' }), known).ok, 'caracteres de controle recusados')
})

test('DEV-02.4-T04/T12 — vínculos: só metas da mesma versão; meta com indicador ativo não é descontinuada', () => {
  assert.ok(validateIndicator(indicator({ goalIds: [G1, G2] }), known).ok, 'um indicador para mais de uma meta')
  assert.ok(validateIndicator(indicator({ goalIds: [] }), known).ok, 'indicador sem meta vinculada (sem vínculo artificial)')
  const unknown = validateIndicator(indicator({ goalIds: ['g_99999999999999999999'] }), known)
  assert.ok(!unknown.ok && unknown.errors.goalIds === 'unknown-goal')
  assert.ok(!validateIndicator(indicator({ goalIds: [G1, G1] }), known).ok)
  assert.ok(!validateIndicator(indicator({ goalIds: ['../x'] }), known).ok)
  const g = (id: string, status: 'active' | 'discontinued'): Stored<GoalData> => ({ id, kind: 'goal', revision: 1, data: { ...(validateGoal(goal()) as { ok: true; data: GoalData }).data, status } })
  const i = (goalIds: string[], status: 'active' | 'discontinued'): Stored<IndicatorData> => ({ id: 'i_00000000000000000001', kind: 'indicator', revision: 1, data: { ...(validateIndicator(indicator(), known) as { ok: true; data: IndicatorData }).data, goalIds, status } })
  assert.deepEqual(linkIntegrity([g(G1, 'discontinued')], [i([G1], 'active')]), { ok: false, goalId: G1 })
  assert.deepEqual(linkIntegrity([g(G1, 'discontinued')], [i([G1], 'discontinued')]), { ok: true })
  assert.deepEqual(linkIntegrity([g(G1, 'active'), g(G2, 'discontinued')], [i([G1], 'active')]), { ok: true })
  assert.equal(isDuplicateCode('meta 01', [{ id: G1, code: 'Meta 01' }], null), true)
  assert.equal(isDuplicateCode('Meta 01', [{ id: G1, code: 'Meta 01' }], G1), false)
})

test('DEV-02.4-T24 — comparação por identificador lógico: mantido, alterado, incluído, descontinuado, reativado', () => {
  const v = (data: Record<string, unknown>, id = G1): Stored<GoalData> => ({ id, kind: 'goal', revision: 1, data: (validateGoal(goal(data)) as { ok: true; data: GoalData }).data })
  const before = [v({}), v({ code: 'Meta 02', description: 'Realizar 20 oficinas comunitárias' }, G2)]
  const after = [v({ expectedQuantity: { state: 'informed', value: 250 } }), v({ code: 'Meta 02', description: 'Realizar 20 oficinas comunitárias', status: 'discontinued' }, G2), v({ code: 'Meta 03' }, 'g_00000000000000000003')]
  const d = Object.fromEntries(diffComponents('goal', before, after).map((x) => [x.code, [x.diff, x.fields]]))
  assert.deepEqual(d['Meta 01'], ['changed', ['expectedQuantity']])
  assert.deepEqual(d['Meta 02'], ['discontinued', []])
  assert.deepEqual(d['Meta 03'], ['included', []])
  assert.deepEqual(diffComponents('goal', after, before).find((x) => x.code === 'Meta 02')?.diff, 'reactivated')
  assert.deepEqual(diffComponents('goal', before, before).map((x) => x.diff), ['unchanged', 'unchanged'])
  // Ordem de apresentação não é diferença de conteúdo.
  assert.deepEqual(diffComponents('goal', [v({})], [v({ order: 5 })]).map((x) => x.diff), ['unchanged'])
})

test('DEV-02.4-T25 — planejado ≠ realizado: campos de resultado apurado são recusados', () => {
  for (const key of ['achievedValue', 'realized', 'executionPercentage', 'evaluation', 'evidence']) {
    assert.ok(!validateGoal(goal({ [key]: 1 })).ok, key)
    assert.ok(!validateIndicator(indicator({ [key]: 1 }), known).ok, key)
  }
})
