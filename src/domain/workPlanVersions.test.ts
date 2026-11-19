/** DEV-02.3 — Domínio do versionamento do Plano (`npm test`). Lógica pura; gravação real em tests/server. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AuthorizationContext, GrantablePermissionId, MembershipFacts, OrganizationFacts } from './authorization.ts'
import { emptyValues } from './workPlans.ts'
import {
  activationStatusOf,
  checkVersionFinalization,
  currentVersionId,
  decideActivation,
  decideVersionCreation,
  denialMessage,
  diffVersions,
  isMaterialDiff,
  isVersionId,
  validateFormalAct,
  versionIdFor,
  versionLabel,
  type VersionSummary,
} from './workPlanVersions.ts'

const TODAY = '2026-11-17'
const osc: OrganizationFacts = { id: 'osc-a', registrationStatus: 'active', commercialStatus: 'active', administratorUid: 'admin' }
const member = (uid: string, permissions: GrantablePermissionId[] = []): MembershipFacts => ({ uid, status: 'active', permissions, canManagePermissions: false })
const ctx = (m: MembershipFacts, o: OrganizationFacts = osc): AuthorizationContext => ({ uid: m.uid, oscId: 'osc-a', organization: o, membership: m })
const editor = ctx(member('u', ['work-plan.view', 'work-plan.edit']))
const v = (id: string, sequence: number, registrationStatus: 'in-registration' | 'finalized', activationStatus: VersionSummary['activationStatus'] = sequence > 1 ? 'pending-decision' : null): VersionSummary => ({ id, sequence, registrationStatus, activationStatus })
const facts = { instrument: 'termo-colaboracao', termStart: '2026-03-01', termEnd: '2028-02-28', formalizationDate: '2026-02-20', administrativeStatus: 'em-execucao', workPlanApprovalDeclared: true } as const
const informed = (value: string | number) => ({ state: 'informed', value }) as const

test('DEV-02.3-T01 — identificação: original e v{n}; ids forjados rejeitados', () => {
  assert.equal(versionIdFor(1), 'original')
  assert.equal(versionIdFor(2), 'v2')
  assert.equal(versionLabel(1), 'Versão original')
  assert.equal(versionLabel(3), 'Versão 3')
  for (const ok of ['original', 'v2', 'v10', 'v9999']) assert.equal(isVersionId(ok), true, ok)
  for (const bad of ['v1', 'v0', 'v02', 'x', '', 'original/../v2', 'v10000', 2]) assert.equal(isVersionId(bad), false, String(bad))
})

test('DEV-02.3-T07 — ato formal: tipo e data obrigatórios; outro ato identificado; sem data futura; chaves estranhas', () => {
  const ok = validateFormalAct({ type: 'termo-aditivo', reference: ' 1º TA ', actDate: '2026-09-01', description: '', effectiveDate: '' }, TODAY)
  assert.ok(ok.ok)
  if (ok.ok) {
    assert.equal(ok.act.reference, '1º TA')
    assert.equal(ok.act.description, null)
    assert.equal(ok.act.effectiveDate, null)
  }
  const missing = validateFormalAct({}, TODAY)
  assert.ok(!missing.ok && missing.errors.type === 'required' && missing.errors.actDate === 'required')
  const other = validateFormalAct({ type: 'outro-ato', actDate: '2026-09-01' }, TODAY)
  assert.ok(!other.ok && other.errors.typeDescription === 'required')
  const future = validateFormalAct({ type: 'apostilamento', actDate: '2026-12-01' }, TODAY)
  assert.ok(!future.ok && future.errors.actDate === 'in-future')
  const badDate = validateFormalAct({ type: 'apostilamento', actDate: '2026-02-30' }, TODAY)
  assert.ok(!badDate.ok && badDate.errors.actDate === 'invalid-date')
  assert.deepEqual(validateFormalAct({ type: 'apostilamento', actDate: '2026-09-01', vigente: true }, TODAY), { ok: false, errors: { formalAct: 'invalid' } })
  assert.deepEqual(validateFormalAct(null, TODAY), { ok: false, errors: { formalAct: 'required' } })
})

test('DEV-02.3 — critério de vigência: ativada de maior sequência; sem ativação, a original finalizada', () => {
  assert.equal(currentVersionId([v('original', 1, 'in-registration')]), null)
  assert.equal(currentVersionId([v('original', 1, 'finalized')]), 'original')
  // Versão posterior finalizada SEM ativação não se torna vigente (regra não homologada).
  const original = v('original', 1, 'finalized')
  const v2 = v('v2', 2, 'finalized')
  const pending = [original, v2]
  assert.equal(currentVersionId(pending), 'original')
  assert.equal(activationStatusOf(v2, 'original'), 'pending-decision')
  assert.equal(activationStatusOf(original, 'original'), 'original-current')
  // Preparado: se um dia houver ativação registrada, a de maior sequência vigora (nunca duas).
  const activated = [original, v('v2', 2, 'finalized', 'active'), v('v3', 3, 'finalized', 'active')]
  assert.equal(currentVersionId(activated), 'v3')
  assert.equal(activationStatusOf(original, 'v3'), 'superseded')
})

test('DEV-02.3-T02/T06 — criação: base vigente e finalizada; no máximo uma versão pendente', () => {
  const base = [v('original', 1, 'finalized')]
  assert.deepEqual(decideVersionCreation(editor, 'em-execucao', base, 'original').allowed, true)
  assert.deepEqual(decideVersionCreation(editor, 'em-execucao', [v('original', 1, 'in-registration')], 'original'), { allowed: false, reason: 'base-not-finalized' })
  assert.deepEqual(decideVersionCreation(editor, 'em-execucao', [...base, v('v2', 2, 'in-registration')], 'original'), { allowed: false, reason: 'pending-version-exists' })
  assert.deepEqual(decideVersionCreation(editor, 'em-execucao', [...base, v('v2', 2, 'finalized')], 'v2'), { allowed: false, reason: 'base-not-current' })
  assert.deepEqual(decideVersionCreation(editor, 'em-execucao', base, 'v9'), { allowed: false, reason: 'base-not-finalized' })
})

test('DEV-02.3-T19/T20/T21/T22/T23 — autorização: edit exigida; arquivada; suspensão comercial; administrativa não bloqueia', () => {
  const base = [v('original', 1, 'finalized')]
  assert.deepEqual(decideVersionCreation(ctx(member('u', ['work-plan.view'])), 'em-execucao', base, 'original'), { allowed: false, reason: 'permission-not-granted' })
  assert.deepEqual(decideVersionCreation(ctx(member('admin')), 'em-execucao', base, 'original'), { allowed: false, reason: 'permission-not-granted' })
  assert.deepEqual(decideVersionCreation(editor, 'arquivada', base, 'original'), { allowed: false, reason: 'partnership-archived' })
  assert.deepEqual(decideVersionCreation(editor, 'suspensa', base, 'original').allowed, true)
  const suspended = ctx(member('u', ['work-plan.edit']), { ...osc, commercialStatus: 'suspended' })
  assert.equal(decideVersionCreation(suspended, 'em-execucao', base, 'original').allowed, false)
})

test('DEV-02.3 — ativação PREPARADA mas BLOQUEADA para todos (vigency-rule-pending)', () => {
  assert.deepEqual(decideActivation(editor, 'em-execucao'), { allowed: false, reason: 'vigency-rule-pending' })
  assert.deepEqual(decideActivation(ctx(member('u', ['work-plan.view'])), 'em-execucao'), { allowed: false, reason: 'permission-not-granted' })
  assert.deepEqual(decideActivation(editor, 'arquivada'), { allowed: false, reason: 'partnership-archived' })
  assert.match(denialMessage('vigency-rule-pending', ''), /decisão administrativa ainda não homologada/)
})

test('DEV-02.3-T08 — finalização de versão posterior exige ato válido além dos requisitos do Plano', () => {
  const values = { ...emptyValues(), approvalDate: informed('2026-02-10'), executionStart: informed('2026-03-01'), executionEnd: informed('2028-02-28') }
  const act = { type: 'termo-aditivo', typeDescription: null, reference: null, actDate: '2026-09-01', description: null, effectiveDate: null } as const
  assert.deepEqual(checkVersionFinalization(values, facts, act, TODAY).pending, [])
  assert.equal(checkVersionFinalization(values, facts, { ...act, actDate: '2027-01-01' }, TODAY).pending.length, 1)
  assert.deepEqual(checkVersionFinalization(values, facts, null, TODAY).pending, [])
  // Ato lido do armazenamento (com autoria registrada pelo servidor) continua válido.
  const stored = { ...act, declaredBy: 'u', declaredAt: '2026-09-02T00:00:00Z' } as typeof act
  assert.deepEqual(checkVersionFinalization(values, facts, stored, TODAY).pending, [])
})

test('DEV-02.3-T10/T11/T12 — comparação: alterado, mantido, incluído, N/A, formatação e zero ≠ não informado', () => {
  const before = { ...emptyValues(), targetAudience: informed('Crianças'), estimatedBeneficiaries: informed(0), geographicScope: { state: 'not-applicable' }, justification: informed('Texto  original'), complementaryNotes: informed('Nota') } as const
  const after = { ...emptyValues(), targetAudience: informed('Crianças e adolescentes'), estimatedBeneficiaries: { state: 'not-informed' }, geographicScope: informed('Bairro Centro'), justification: informed(' Texto original '), complementaryNotes: { state: 'not-applicable' }, executionMethod: informed('Oficinas') } as const
  const kinds = Object.fromEntries(diffVersions(before, after).map((d) => [d.field, d.kind]))
  assert.equal(kinds.targetAudience, 'changed')
  assert.equal(kinds.estimatedBeneficiaries, 'removed') // zero informado ≠ não informado
  assert.equal(kinds.geographicScope, 'no-longer-applicable')
  assert.equal(kinds.justification, 'formatting-only')
  assert.equal(kinds.complementaryNotes, 'became-not-applicable')
  assert.equal(kinds.executionMethod, 'included')
  assert.equal(kinds.approvalDate, 'unchanged')
  assert.equal(isMaterialDiff('formatting-only'), false)
  assert.equal(isMaterialDiff('removed'), true)
  const zeroToZero = diffVersions({ ...emptyValues(), estimatedBeneficiaries: informed(0) }, { ...emptyValues(), estimatedBeneficiaries: informed(0) })
  assert.equal(zeroToZero.find((d) => d.field === 'estimatedBeneficiaries')?.kind, 'unchanged')
})
