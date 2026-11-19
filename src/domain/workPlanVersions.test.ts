/** DEV-02.3 — Domínio do versionamento do Plano (`npm test`). Lógica pura; gravação real em tests/server. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AuthorizationContext, GrantablePermissionId, MembershipFacts, OrganizationFacts } from './authorization.ts'
import { emptyValues } from './workPlans.ts'
import {
  activationStatusOf,
  checkVersionFinalization,
  currentVersionId,
  applicableVersionOn,
  checkActivationChain,
  currentReference,
  effectsStatus,
  resolveCurrentVersion,
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
const v = (id: string, sequence: number, registrationStatus: 'in-registration' | 'finalized', activationStatus: VersionSummary['activationStatus'] = null): VersionSummary => ({ id, sequence, registrationStatus, activationStatus })
const timeline = (versions: VersionSummary[], dates: Record<string, string> = {}) =>
  versions.map((x) => ({ ...x, effectiveDate: dates[x.id] ?? null, activatedAt: x.activationStatus === 'active' || (x.sequence > 1 && x.activationStatus === 'superseded') ? new Date('2026-11-01T12:00:00Z') : null }))
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

test('DEV-02.3-C01 — fonte autoritativa: única versão ativa; sem ela, a original finalizada não substituída', () => {
  assert.equal(currentVersionId([v('original', 1, 'in-registration')]), null)
  assert.equal(currentVersionId([v('original', 1, 'finalized')]), 'original')
  const original = v('original', 1, 'finalized')
  const draft = v('v2', 2, 'in-registration', 'awaiting-finalization')
  assert.equal(currentVersionId([original, draft]), 'original')
  assert.equal(activationStatusOf(draft, 'original'), 'in-registration')
  assert.equal(activationStatusOf(original, 'original'), 'original-current')
  // T01/T02: após a ativação de v2 a original passa a substituída.
  const chain = [v('original', 1, 'finalized', 'superseded'), v('v2', 2, 'finalized', 'active')]
  assert.equal(currentVersionId(chain), 'v2')
  assert.equal(activationStatusOf(chain[0] ?? original, 'v2'), 'superseded')
  // T03: nunca duas vigentes — duas ativas, ativa em cadastramento ou original substituída sem sucessora → inconsistente.
  assert.deepEqual(resolveCurrentVersion([original, v('v2', 2, 'finalized', 'active'), v('v3', 3, 'finalized', 'active')]), { status: 'inconsistent' })
  assert.deepEqual(resolveCurrentVersion([original, v('v2', 2, 'in-registration', 'active')]), { status: 'inconsistent' })
  assert.deepEqual(resolveCurrentVersion([v('original', 1, 'finalized', 'superseded')]), { status: 'inconsistent' })
})

test('DEV-02.3-C01-T09/T10/T11 — DEC-PT-004: parte da vigente; uma em cadastramento; após ativar v2, v3 liberada', () => {
  const base = [v('original', 1, 'finalized')]
  assert.equal(decideVersionCreation(editor, 'em-execucao', base, 'original').allowed, true)
  assert.deepEqual(decideVersionCreation(editor, 'em-execucao', [v('original', 1, 'in-registration')], 'original'), { allowed: false, reason: 'base-not-finalized' })
  assert.deepEqual(decideVersionCreation(editor, 'em-execucao', [...base, v('v2', 2, 'in-registration', 'awaiting-finalization')], 'original'), { allowed: false, reason: 'pending-version-exists' })
  const afterV2 = [v('original', 1, 'finalized', 'superseded'), v('v2', 2, 'finalized', 'active')]
  assert.equal(decideVersionCreation(editor, 'em-execucao', afterV2, 'v2').allowed, true) // T11 (não confunde ativa com pendente)
  assert.deepEqual(decideVersionCreation(editor, 'em-execucao', afterV2, 'original'), { allowed: false, reason: 'base-not-current' }) // T09
  assert.deepEqual(decideVersionCreation(editor, 'em-execucao', [...afterV2, v('v3', 3, 'in-registration', 'awaiting-finalization')], 'v2'), { allowed: false, reason: 'pending-version-exists' })
  assert.deepEqual(decideVersionCreation(editor, 'em-execucao', base, 'v9'), { allowed: false, reason: 'base-not-finalized' })
})

test('DEV-02.3-C01 — legado pending-decision: finalizado não é ativado nem vira vigente; criação protegida', () => {
  const legacy = [v('original', 1, 'finalized'), v('v2', 2, 'finalized', 'pending-decision')]
  assert.equal(currentVersionId(legacy), 'original')
  assert.equal(activationStatusOf(legacy[1] ?? legacy[0] as VersionSummary, 'original'), 'legacy-pending')
  assert.deepEqual(decideVersionCreation(editor, 'em-execucao', legacy, 'original'), { allowed: false, reason: 'legacy-version-pending' })
  assert.match(denialMessage('legacy-version-pending', ''), /regularização administrativa/)
  // Legado AINDA em cadastramento: a finalização (pós DEC-PT-003) o ativa normalmente.
  const draftLegacy = [v('original', 1, 'finalized'), { ...v('v2', 2, 'in-registration', 'pending-decision'), previousWorkPlanId: 'original' }]
  assert.deepEqual(checkActivationChain(draftLegacy, 'v2'), { ok: true, supersededId: 'original' })
  assert.deepEqual(applicableVersionOn(timeline(legacy), '2026-10-01'), { status: 'indeterminate', reason: 'legacy-pending' })
})

test('DEV-02.3-C01-T01/T04 — cadeia da ativação: origem deve ser a vigente', () => {
  const ok = [v('original', 1, 'finalized'), { ...v('v2', 2, 'in-registration', 'awaiting-finalization'), previousWorkPlanId: 'original' }]
  assert.deepEqual(checkActivationChain(ok, 'v2'), { ok: true, supersededId: 'original' })
  const wrongBase = [v('original', 1, 'finalized', 'superseded'), { ...v('v2', 2, 'finalized', 'active'), previousWorkPlanId: 'original' }, { ...v('v3', 3, 'in-registration', 'awaiting-finalization'), previousWorkPlanId: 'original' }]
  assert.deepEqual(checkActivationChain(wrongBase, 'v3'), { ok: false, reason: 'base-not-current' })
  assert.deepEqual(checkActivationChain(ok, 'original'), { ok: false, reason: 'base-not-current' })
  assert.deepEqual(checkActivationChain([...ok, v('v3', 3, 'finalized', 'active'), v('v4', 4, 'finalized', 'active')], 'v2'), { ok: false, reason: 'versions-inconsistent' })
})

test('DEV-02.3-C01-T15/T17/T18 — DEC-PT-005: efeitos (datas civis de Brasília); nunca presumidos', () => {
  assert.equal(effectsStatus(null, TODAY), 'not-informed')
  assert.equal(effectsStatus('2026-11-18', TODAY), 'future')
  assert.equal(effectsStatus(TODAY, TODAY), 'reached')
  assert.equal(effectsStatus('2026-01-01', TODAY), 'reached')
  const entries = timeline([v('original', 1, 'finalized', 'superseded'), v('v2', 2, 'finalized', 'active')], { v2: '2027-01-01' })
  const ref = currentReference(entries, TODAY)
  assert.equal(ref.workPlanId, 'v2')
  assert.equal(ref.effects, 'future')
  assert.equal(ref.effectiveDate, '2027-01-01')
  assert.ok(ref.activatedAt instanceof Date)
  const none = currentReference(timeline([v('original', 1, 'finalized', 'superseded'), v('v2', 2, 'finalized', 'active')]), TODAY)
  assert.equal(none.effectiveDate, null) // data de ativação NÃO vira data de efeitos
  assert.equal(none.effects, 'not-informed')
  assert.deepEqual(currentReference(timeline([v('original', 1, 'finalized')]), TODAY), { status: 'determined', workPlanId: 'original', sequence: 1, activatedAt: null, effectiveDate: null, effects: 'not-applicable' })
})

test('DEV-02.3-C01 — versão aplicável numa data: só quando determinável; caso contrário, indeterminada', () => {
  const chain = [v('original', 1, 'finalized', 'superseded'), v('v2', 2, 'finalized', 'superseded'), v('v3', 3, 'finalized', 'active')]
  const dated = timeline(chain, { v2: '2026-06-01', v3: '2026-12-01' })
  assert.deepEqual(applicableVersionOn(dated, '2026-05-31'), { status: 'determined', workPlanId: 'original', basis: 'before-first-alteration' })
  assert.deepEqual(applicableVersionOn(dated, '2026-06-01'), { status: 'determined', workPlanId: 'v2', basis: 'effective-date' })
  assert.deepEqual(applicableVersionOn(dated, '2026-12-15'), { status: 'determined', workPlanId: 'v3', basis: 'effective-date' })
  assert.deepEqual(applicableVersionOn(timeline(chain, { v2: '2026-06-01' }), '2026-12-15'), { status: 'indeterminate', reason: 'effective-date-not-informed' })
  assert.deepEqual(applicableVersionOn(timeline(chain, { v2: '2026-12-01', v3: '2026-06-01' }), '2026-12-15'), { status: 'indeterminate', reason: 'effective-dates-out-of-order' })
  assert.deepEqual(applicableVersionOn(timeline([v('original', 1, 'in-registration')]), '2026-12-15'), { status: 'indeterminate', reason: 'no-finalized-version' })
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
