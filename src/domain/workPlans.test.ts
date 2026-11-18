/** DEV-02.2 — Domínio do Plano de Trabalho (`npm test`). Lógica pura; gravação real em tests/server. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GRANTABLE_PERMISSIONS, PERMISSION_CATALOG, isGrantablePermission, sanitizePermissions, type AuthorizationContext, type GrantablePermissionId, type MembershipFacts, type OrganizationFacts } from './authorization.ts'
import { CORRECTION_DECLARATION, FIELDS, checkFinalization, cleanJustification, validateCorrection, decideWorkPlanOperation, emptyValues, parseFieldValue, validateChanges, type PartnershipFacts } from './workPlans.ts'

const TODAY = '2026-11-17'
const osc: OrganizationFacts = { id: 'osc-a', registrationStatus: 'active', commercialStatus: 'active', administratorUid: 'admin' }
const member = (uid: string, permissions: GrantablePermissionId[] = []): MembershipFacts => ({ uid, status: 'active', permissions, canManagePermissions: false })
const ctx = (m: MembershipFacts, o: OrganizationFacts = osc): AuthorizationContext => ({ uid: m.uid, oscId: 'osc-a', organization: o, membership: m })
const facts: PartnershipFacts = { instrument: 'termo-colaboracao', termStart: '2026-03-01', termEnd: '2028-02-28', formalizationDate: '2026-02-20', administrativeStatus: 'em-execucao', workPlanApprovalDeclared: true }
const informed = (value: string | number) => ({ state: 'informed', value })

test('DEV-02.2-C01-T01 a T05/T07/T08 — DEC-PT-001: work-plan.edit única; finalize descontinuada não autoriza', () => {
  assert.equal(isGrantablePermission('work-plan.finalize'), false)
  assert.equal(PERMISSION_CATALOG.find((p) => p.id === 'work-plan.finalize')?.status, 'discontinued')
  assert.deepEqual(GRANTABLE_PERMISSIONS.filter((p) => p.startsWith('work-plan.')), ['work-plan.view', 'work-plan.edit'])
  // Vínculo com o identificador descontinuado gravado: descartado na leitura, sem conversão para edit.
  assert.deepEqual(sanitizePermissions(['work-plan.finalize', 'work-plan.view']), ['work-plan.view'])
  const edit = ctx(member('u', ['work-plan.edit']))
  for (const op of ['start', 'update', 'finalize'] as const) assert.equal(decideWorkPlanOperation(edit, op, 'em-execucao', op === 'start' ? 'not-structured' : 'in-registration').allowed, true, op)
  assert.equal(decideWorkPlanOperation(edit, 'correct', 'em-execucao', 'finalized').allowed, true)
  const finalizeOnly = ctx(member('u', sanitizePermissions(['work-plan.finalize'])))
  const viewOnly = ctx(member('u', ['work-plan.view']))
  for (const c of [finalizeOnly, viewOnly]) {
    for (const op of ['start', 'update', 'finalize', 'correct'] as const) {
      assert.deepEqual(decideWorkPlanOperation(c, op, 'em-execucao', op === 'correct' ? 'finalized' : 'in-registration'), { allowed: false, reason: 'permission-not-granted' })
    }
  }
  assert.deepEqual(decideWorkPlanOperation(ctx(member('admin')), 'finalize', 'em-execucao', 'in-registration'), { allowed: false, reason: 'permission-not-granted' })
  assert.equal(decideWorkPlanOperation(ctx(member('u', ['partnerships.create', 'partnerships.edit'])), 'start', 'em-execucao', 'not-structured').allowed, false)
  // Correção só em Plano finalizado; edição comum nunca após a finalização.
  assert.deepEqual(decideWorkPlanOperation(edit, 'correct', 'em-execucao', 'in-registration'), { allowed: false, reason: 'not-finalized' })
  assert.deepEqual(decideWorkPlanOperation(edit, 'update', 'em-execucao', 'finalized'), { allowed: false, reason: 'already-finalized' })
})

test('DEV-02.2-T11/T12/T13/T20 — suspensão comercial, arquivada, suspensa e finalizado', () => {
  const all = ctx(member('u', ['work-plan.edit']))
  assert.deepEqual(decideWorkPlanOperation(ctx(member('u', ['work-plan.edit']), { ...osc, commercialStatus: 'suspended' }), 'start', 'em-execucao', 'not-structured'), { allowed: false, reason: 'commercial-suspension' })
  assert.deepEqual(decideWorkPlanOperation(all, 'update', 'arquivada', 'in-registration'), { allowed: false, reason: 'partnership-archived' })
  for (const status of ['suspensa', 'encerrada'] as const) assert.equal(decideWorkPlanOperation(all, 'finalize', status, 'in-registration').allowed, true)
  for (const op of ['start', 'update', 'finalize'] as const) assert.deepEqual(decideWorkPlanOperation(all, op, 'em-execucao', 'finalized'), { allowed: false, reason: 'already-finalized' })
  assert.deepEqual(decideWorkPlanOperation(all, 'correct', 'arquivada', 'finalized'), { allowed: false, reason: 'partnership-archived' })
  assert.equal(decideWorkPlanOperation(all, 'correct', 'suspensa', 'finalized').allowed, true)
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

test('DEV-02.2-C01-T11/T12/T13 — validação da correção: justificativa, declaração, alteração efetiva e requisitos', () => {
  const final = { ...emptyValues(), approvalDate: { state: 'informed', value: '2026-02-10' }, executionStart: { state: 'informed', value: '2026-03-01' }, executionEnd: { state: 'informed', value: '2028-02-28' } } as const
  const ok = validateCorrection({ changes: { approvalDate: informed('2026-02-15'), estimatedBeneficiaries: informed(0) }, justification: '  Data transcrita   errada.  ', declaration: true }, final, facts, TODAY)
  assert.ok(ok.ok)
  assert.deepEqual(ok.items, [
    { field: 'approvalDate', before: { state: 'informed', value: '2026-02-10' }, after: { state: 'informed', value: '2026-02-15' } },
    { field: 'estimatedBeneficiaries', before: { state: 'not-informed' }, after: { state: 'informed', value: 0 } },
  ])
  assert.equal(ok.justification, 'Data transcrita errada.')
  const err = (input: Record<string, unknown>) => {
    const r = validateCorrection({ changes: { approvalDate: informed('2026-02-15') }, justification: 'Justificativa válida.', declaration: true, ...input }, final, facts, TODAY)
    return r.ok ? {} : r.errors
  }
  assert.deepEqual(err({ justification: '   ' }), { correctionReason: 'justification-required' })
  assert.deepEqual(err({ justification: 'a b c d e' }), { correctionReason: 'justification-too-short' }) // espaços não contam
  assert.deepEqual(err({ declaration: 'true' }), { declaration: 'declaration-required' })
  assert.deepEqual(err({ changes: { approvalDate: informed('2026-02-10') } }), { changes: 'no-change' })
  assert.deepEqual(err({ changes: { executionStart: { state: 'not-informed' } } }), { changes: 'breaks-finalization' })
  assert.deepEqual(err({ changes: { registrationStatus: 'in-registration' } }), { changes: 'invalid' })
  assert.deepEqual(err({ changes: [] }), { changes: 'required' })
  assert.equal(cleanJustification('ok\u0007texto suficiente').error, 'invalid')
  assert.match(CORRECTION_DECLARATION, /não representando alteração formal/)
})
