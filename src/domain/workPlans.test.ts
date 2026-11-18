/** DEV-02.2 — Domínio do Plano de Trabalho (`npm test`). Lógica pura; gravação real em tests/server. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GRANTABLE_PERMISSIONS, isGrantablePermission, type AuthorizationContext, type GrantablePermissionId, type MembershipFacts, type OrganizationFacts } from './authorization.ts'
import { FIELDS, checkFinalization, decideWorkPlanOperation, emptyValues, parseFieldValue, validateChanges, type PartnershipFacts } from './workPlans.ts'

const TODAY = '2026-11-17'
const osc: OrganizationFacts = { id: 'osc-a', registrationStatus: 'active', commercialStatus: 'active', administratorUid: 'admin' }
const member = (uid: string, permissions: GrantablePermissionId[] = []): MembershipFacts => ({ uid, status: 'active', permissions, canManagePermissions: false })
const ctx = (m: MembershipFacts, o: OrganizationFacts = osc): AuthorizationContext => ({ uid: m.uid, oscId: 'osc-a', organization: o, membership: m })
const facts: PartnershipFacts = { instrument: 'termo-colaboracao', termStart: '2026-03-01', termEnd: '2028-02-28', formalizationDate: '2026-02-20', administrativeStatus: 'em-execucao', workPlanApprovalDeclared: true }
const informed = (value: string | number) => ({ state: 'informed', value })

test('Catálogo DEV-02.2: view, edit e finalize concedíveis e independentes', () => {
  for (const id of ['work-plan.view', 'work-plan.edit', 'work-plan.finalize']) assert.equal(isGrantablePermission(id), true)
  assert.deepEqual(GRANTABLE_PERMISSIONS.filter((p) => p.startsWith('work-plan.')), ['work-plan.view', 'work-plan.edit', 'work-plan.finalize'])
  const edit = ctx(member('u', ['work-plan.edit']))
  const fin = ctx(member('u', ['work-plan.finalize']))
  assert.equal(decideWorkPlanOperation(edit, 'start', 'em-execucao', 'not-structured').allowed, true)
  assert.equal(decideWorkPlanOperation(edit, 'update', 'em-execucao', 'in-registration').allowed, true)
  assert.deepEqual(decideWorkPlanOperation(edit, 'finalize', 'em-execucao', 'in-registration'), { allowed: false, reason: 'permission-not-granted' })
  assert.deepEqual(decideWorkPlanOperation(fin, 'update', 'em-execucao', 'in-registration'), { allowed: false, reason: 'permission-not-granted' })
  assert.equal(decideWorkPlanOperation(fin, 'finalize', 'em-execucao', 'in-registration').allowed, true)
  // Administrador sem permissões implícitas; partnerships.* não autoriza o Plano.
  assert.deepEqual(decideWorkPlanOperation(ctx(member('admin')), 'start', 'em-execucao', 'not-structured'), { allowed: false, reason: 'permission-not-granted' })
  assert.equal(decideWorkPlanOperation(ctx(member('u', ['partnerships.create', 'partnerships.edit'])), 'start', 'em-execucao', 'not-structured').allowed, false)
})

test('DEV-02.2-T11/T12/T13/T20 — suspensão comercial, arquivada, suspensa e finalizado', () => {
  const all = ctx(member('u', ['work-plan.edit', 'work-plan.finalize']))
  assert.deepEqual(decideWorkPlanOperation(ctx(member('u', ['work-plan.edit']), { ...osc, commercialStatus: 'suspended' }), 'start', 'em-execucao', 'not-structured'), { allowed: false, reason: 'commercial-suspension' })
  assert.deepEqual(decideWorkPlanOperation(all, 'update', 'arquivada', 'in-registration'), { allowed: false, reason: 'partnership-archived' })
  for (const status of ['suspensa', 'encerrada'] as const) assert.equal(decideWorkPlanOperation(all, 'finalize', status, 'in-registration').allowed, true)
  for (const op of ['start', 'update', 'finalize'] as const) assert.deepEqual(decideWorkPlanOperation(all, op, 'em-execucao', 'finalized'), { allowed: false, reason: 'already-finalized' })
})

test('DEV-02.2-T07 — não informado × não aplicável × zero, por campo', () => {
  assert.deepEqual(parseFieldValue('estimatedBeneficiaries', informed(0), TODAY).value, { state: 'informed', value: 0 })
  assert.deepEqual(parseFieldValue('estimatedBeneficiaries', { state: 'not-informed' }, TODAY).value, { state: 'not-informed' })
  assert.deepEqual(parseFieldValue('estimatedBeneficiaries', { state: 'not-applicable' }, TODAY).value, { state: 'not-applicable' })
  assert.equal(parseFieldValue('estimatedBeneficiaries', informed(-1), TODAY).error, 'out-of-range')
  assert.equal(parseFieldValue('estimatedBeneficiaries', informed(1.5), TODAY).error, 'invalid')
  assert.equal(parseFieldValue('approvalDate', { state: 'not-applicable' }, TODAY).error, 'not-applicable-not-allowed') // obrigatórios não admitem N/A
  assert.equal(parseFieldValue('justification', informed('  '), TODAY).error, 'invalid') // vazio não é "informado"
  assert.equal(parseFieldValue('justification', { state: 'informed', value: 'x', extra: 1 }, TODAY).error, 'invalid')
  assert.deepEqual(emptyValues().estimatedBeneficiaries, { state: 'not-informed' }) // ausência nunca vira zero
  // Matriz: somente os dois campos homologados (data da aprovação e período de execução) exigidos na finalização.
  assert.deepEqual(FIELDS.filter((f) => f.requiredForFinalization).map((f) => f.id), ['approvalDate', 'executionStart', 'executionEnd'])
})

test('DEV-02.2-T05 — validação de alterações: data futura, período incoerente, campos desconhecidos', () => {
  const base = emptyValues()
  assert.deepEqual(validateChanges({ approvalDate: informed('2026-11-18') }, base, TODAY), { ok: false, errors: { approvalDate: 'in-future' } })
  assert.deepEqual(validateChanges({ executionStart: informed('2026-05-01'), executionEnd: informed('2026-04-30') }, base, TODAY), { ok: false, errors: { executionEnd: 'end-before-start' } })
  // Coerência considera o valor já gravado.
  const withStart = { ...base, executionStart: { state: 'informed', value: '2026-05-01' } as const }
  assert.deepEqual(validateChanges({ executionEnd: informed('2026-01-01') }, withStart, TODAY), { ok: false, errors: { executionEnd: 'end-before-start' } })
  assert.deepEqual(validateChanges({ object: informed('x') }, base, TODAY), { ok: false, errors: { changes: 'invalid' } })
  assert.deepEqual(validateChanges({}, base, TODAY), { ok: false, errors: { changes: 'required' } })
  assert.equal(validateChanges({ approvalDate: informed('2015-01-01') }, base, TODAY).ok, true) // sem limite histórico arbitrário
})

test('DEV-02.2-T18 — conferência para finalização: pendências e avisos não impeditivos', () => {
  const empty = checkFinalization(emptyValues(), facts)
  assert.equal(empty.pending.length, 3)
  const filled = { ...emptyValues(), approvalDate: { state: 'informed', value: '2026-02-10' }, executionStart: { state: 'informed', value: '2026-03-01' }, executionEnd: { state: 'informed', value: '2028-02-28' } } as const
  assert.deepEqual(checkFinalization(filled, facts), { pending: [], warnings: [] })
  assert.equal(checkFinalization(filled, { ...facts, workPlanApprovalDeclared: false }).pending.length, 1)
  const outside = checkFinalization({ ...filled, executionEnd: { state: 'informed', value: '2029-01-01' }, approvalDate: { state: 'informed', value: '2026-02-25' } }, facts)
  assert.deepEqual([outside.pending.length, outside.warnings.length], [0, 2])
})
