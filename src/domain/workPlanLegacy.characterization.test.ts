/**
 * DEV-UXPT-01 — CARACTERIZAÇÃO do comportamento LEGADO do Plano de Trabalho (`npm test`).
 *
 * Estes testes NÃO especificam o modelo UX-PT-02: registram o comportamento VIGENTE em `6b9fc3c`
 * (finalização interna obrigatória, ativação vinculada à finalização, incorporações excepcionais),
 * para que a transição seja feita de forma consciente. Cada teste marcado "LEGADO" descreve uma
 * limitação que PODERÁ ser substituída em incremento posterior (DEV-UXPT-02 e seguintes) — quando
 * isso ocorrer, o teste deve ser substituído EXPLICITAMENTE (nunca ter asserções enfraquecidas).
 *
 * Referência: docs/uxpt/DEV-UXPT-01-compatibilidade.md (seções 2, 3 e 5).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AuthorizationContext, GrantablePermissionId, MembershipFacts, OrganizationFacts } from './authorization.ts'
import { financialApplicability } from './workPlanFinancial.ts'
import {
  activationStatusOf,
  applicableVersionOn,
  checkActivationChain,
  currentVersionId,
  decideVersionCreation,
  resolveCurrentVersion,
  type VersionSummary,
} from './workPlanVersions.ts'
import { decideWorkPlanOperation, type WorkPlanOperation, type WorkPlanSituation } from './workPlans.ts'

const osc: OrganizationFacts = { id: 'osc-a', registrationStatus: 'active', commercialStatus: 'active', administratorUid: 'admin' }
const member = (uid: string, permissions: GrantablePermissionId[] = []): MembershipFacts => ({ uid, status: 'active', permissions, canManagePermissions: false })
const ctx = (m: MembershipFacts, o: OrganizationFacts = osc): AuthorizationContext => ({ uid: m.uid, oscId: 'osc-a', organization: o, membership: m })
const editor = ctx(member('u', ['work-plan.view', 'work-plan.edit']))
const v = (id: string, sequence: number, registrationStatus: 'in-registration' | 'finalized', activationStatus: VersionSummary['activationStatus'] = null, extra: Partial<VersionSummary> = {}): VersionSummary => ({
  id,
  sequence,
  registrationStatus,
  activationStatus,
  previousWorkPlanId: sequence > 1 ? (sequence === 2 ? 'original' : `v${sequence - 1}`) : null,
  ...extra,
})
const timeline = (versions: VersionSummary[], dates: Record<string, string> = {}) => versions.map((x) => ({ ...x, effectiveDate: dates[x.id] ?? null, activatedAt: null }))
const reason = (d: { allowed: boolean; reason?: string }) => (d.allowed ? 'allowed' : d.reason)

// ---------------------------------------------------------------------------------- matriz de operações

test('UXPT01-C01 (LEGADO) — matriz de operações do cadastro por situação: edição comum só em cadastramento; correção só após finalização', () => {
  const ops: WorkPlanOperation[] = ['start', 'update', 'finalize', 'correct']
  const matrix = (situation: WorkPlanSituation) => Object.fromEntries(ops.map((op) => [op, reason(decideWorkPlanOperation(editor, op, 'em-execucao', situation))]))
  assert.deepEqual(matrix('not-structured'), { start: 'allowed', update: 'allowed', finalize: 'allowed', correct: 'not-finalized' })
  assert.deepEqual(matrix('in-registration'), { start: 'allowed', update: 'allowed', finalize: 'allowed', correct: 'not-finalized' })
  // LEGADO: após a finalização interna, toda edição comum é recusada (UX-PT-02 substituirá por edição direta classificada).
  assert.deepEqual(matrix('finalized'), { start: 'already-finalized', update: 'already-finalized', finalize: 'already-finalized', correct: 'allowed' })
})

test('UXPT01-C02 — parceria arquivada é somente consulta em qualquer situação; suspensa ou encerrada não bloqueiam (DEC-PAR-003)', () => {
  for (const situation of ['not-structured', 'in-registration', 'finalized'] as const) {
    for (const op of ['start', 'update', 'finalize', 'correct'] as const) assert.equal(reason(decideWorkPlanOperation(editor, op, 'arquivada', situation)), 'partnership-archived')
  }
  assert.equal(reason(decideWorkPlanOperation(editor, 'update', 'suspensa', 'in-registration')), 'allowed')
  assert.equal(reason(decideWorkPlanOperation(editor, 'correct', 'encerrada', 'finalized')), 'allowed')
})

test('UXPT01-C03 — permissões individuais: só work-plan.edit grava; view, financial.* e administrador sem permissão não gravam', () => {
  const cases: [GrantablePermissionId[], string][] = [
    [['work-plan.view'], 'permission-not-granted'],
    [['financial.view'], 'permission-not-granted'],
    [['partnerships.view', 'partnerships.create', 'partnerships.edit'], 'permission-not-granted'],
    [['work-plan.edit'], 'allowed'],
  ]
  for (const [permissions, expected] of cases) assert.equal(reason(decideWorkPlanOperation(ctx(member('u', permissions)), 'update', 'em-execucao', 'in-registration')), expected, permissions.join(','))
  // Administrador único sem permissões operacionais implícitas (DEC-UXPT-02.5 mantém).
  assert.equal(reason(decideWorkPlanOperation(ctx(member('admin')), 'update', 'em-execucao', 'in-registration')), 'permission-not-granted')
  assert.equal(reason(decideWorkPlanOperation(ctx(member('admin', ['work-plan.edit'])), 'update', 'em-execucao', 'in-registration')), 'allowed')
  // Suspensão comercial bloqueia toda gravação, inclusive do administrador com a permissão.
  const suspended = { ...osc, commercialStatus: 'suspended' as const }
  assert.equal(reason(decideWorkPlanOperation(ctx(member('admin', ['work-plan.edit']), suspended), 'correct', 'em-execucao', 'finalized')), 'commercial-suspension')
  // Isolamento: contexto de outra OSC não autoriza.
  assert.equal(reason(decideWorkPlanOperation({ ...editor, oscId: 'osc-b' }, 'update', 'em-execucao', 'in-registration')), 'organization-mismatch')
})

// ---------------------------------------------------------------------------------- vigência

test('UXPT01-C04 (LEGADO) — vigência derivada da FINALIZAÇÃO: original só vigente depois de finalizada', () => {
  assert.deepEqual(resolveCurrentVersion([]), { status: 'none' })
  assert.deepEqual(resolveCurrentVersion([v('original', 1, 'in-registration')]), { status: 'none' })
  assert.deepEqual(resolveCurrentVersion([v('original', 1, 'finalized')]), { status: 'determined', id: 'original' })
  // Versão posterior em cadastramento não é vigente: a original continua a referência.
  assert.equal(currentVersionId([v('original', 1, 'finalized'), v('v2', 2, 'in-registration', 'awaiting-finalization')]), 'original')
  // Ativa = finalizada E com activation.status 'active'.
  assert.equal(currentVersionId([v('original', 1, 'finalized', 'superseded'), v('v2', 2, 'finalized', 'active')]), 'v2')
})

test('UXPT01-C05 — estados inconsistentes resultam em "inconsistent" (nenhuma escolha por suposição)', () => {
  assert.deepEqual(resolveCurrentVersion([v('original', 1, 'finalized', 'superseded'), v('v2', 2, 'finalized', 'active'), v('v3', 3, 'finalized', 'active')]), { status: 'inconsistent' })
  assert.deepEqual(resolveCurrentVersion([v('original', 1, 'finalized', 'superseded')]), { status: 'inconsistent' })
  // Ativa ainda em cadastramento (não produzido pelo servidor): inconsistente.
  assert.deepEqual(resolveCurrentVersion([v('original', 1, 'finalized'), v('v2', 2, 'in-registration', 'active')]), { status: 'inconsistent' })
})

test('UXPT01-C06 (LEGADO) — situação apresentada por versão, incluindo o legado "pending-decision" (DEV-02.3 antes da DEC-PT-003)', () => {
  const versions = [v('original', 1, 'finalized'), v('v2', 2, 'finalized', 'pending-decision'), v('v3', 3, 'in-registration', 'awaiting-finalization')]
  const current = currentVersionId(versions)
  assert.equal(current, 'original')
  assert.deepEqual(
    versions.map((x) => activationStatusOf(x, current)),
    ['original-current', 'legacy-pending', 'in-registration'],
  )
  // Finalizada com 'awaiting-finalization' (não produzido pelo servidor atual) também é tratada como pendência legada.
  assert.equal(activationStatusOf(v('v2', 2, 'finalized', 'awaiting-finalization'), 'original'), 'legacy-pending')
  assert.equal(activationStatusOf(v('original', 1, 'finalized', 'superseded'), 'v2'), 'superseded')
})

test('UXPT01-C07 (LEGADO) — ativação vinculada à finalização: cadeia exige origem = versão vigente', () => {
  const base = [v('original', 1, 'finalized'), v('v2', 2, 'in-registration', 'awaiting-finalization')]
  assert.deepEqual(checkActivationChain(base, 'v2'), { ok: true, supersededId: 'original' })
  // A original não tem ativação (sequence 1).
  assert.deepEqual(checkActivationChain(base, 'original'), { ok: false, reason: 'base-not-current' })
  // Origem que não é a vigente (cadeia divergente).
  assert.deepEqual(checkActivationChain([v('original', 1, 'finalized'), v('v2', 2, 'in-registration', 'awaiting-finalization', { previousWorkPlanId: 'v9' })], 'v2'), { ok: false, reason: 'base-not-current' })
  assert.deepEqual(checkActivationChain([v('original', 1, 'finalized', 'superseded')], 'v2'), { ok: false, reason: 'versions-inconsistent' })
})

test('UXPT01-C08 — versão aplicável por data: indeterminada sem data de efeitos ou com legado pendente', () => {
  const chain = [v('original', 1, 'finalized', 'superseded'), v('v2', 2, 'finalized', 'active')]
  assert.deepEqual(applicableVersionOn(timeline(chain), '2026-12-01'), { status: 'indeterminate', reason: 'effective-date-not-informed' })
  assert.deepEqual(applicableVersionOn(timeline(chain, { v2: '2026-10-01' }), '2026-09-30'), { status: 'determined', workPlanId: 'original', basis: 'before-first-alteration' })
  assert.deepEqual(applicableVersionOn(timeline(chain, { v2: '2026-10-01' }), '2026-10-01'), { status: 'determined', workPlanId: 'v2', basis: 'effective-date' })
  assert.deepEqual(applicableVersionOn(timeline([v('original', 1, 'finalized'), v('v2', 2, 'finalized', 'pending-decision')]), '2026-12-01'), { status: 'indeterminate', reason: 'legacy-pending' })
  assert.deepEqual(applicableVersionOn(timeline([v('original', 1, 'in-registration')]), '2026-12-01'), { status: 'indeterminate', reason: 'no-finalized-version' })
})

// ---------------------------------------------------------------------------------- nova versão formal

test('UXPT01-C09 (LEGADO) — nova versão formal: exige base vigente FINALIZADA e nenhum procedimento aberto', () => {
  const finalOriginal = [v('original', 1, 'finalized')]
  assert.equal(reason(decideVersionCreation(editor, 'em-execucao', finalOriginal, 'original')), 'allowed')
  // LEGADO: base em cadastramento não admite alteração formal (UX-PT-02: sem finalização interna obrigatória).
  assert.equal(reason(decideVersionCreation(editor, 'em-execucao', [v('original', 1, 'in-registration')], 'original')), 'base-not-finalized')
  // DEC-PT-004: uma única versão em cadastramento.
  assert.equal(reason(decideVersionCreation(editor, 'em-execucao', [...finalOriginal, v('v2', 2, 'in-registration', 'awaiting-finalization')], 'original')), 'pending-version-exists')
  assert.equal(reason(decideVersionCreation(editor, 'em-execucao', [...finalOriginal, v('v2', 2, 'finalized', 'pending-decision')], 'original')), 'legacy-version-pending')
  // Incorporações abertas bloqueiam (DEC-PT-006 3.7 e DEC-PT-011 4.10), de forma independente.
  assert.equal(reason(decideVersionCreation(editor, 'em-execucao', [v('original', 1, 'finalized', null, { transcriptionOpen: true })], 'original')), 'transcription-open')
  assert.equal(reason(decideVersionCreation(editor, 'em-execucao', [v('original', 1, 'finalized', null, { financialTranscriptionOpen: true })], 'original')), 'financial-transcription-open')
  // Base que não é a vigente.
  assert.equal(reason(decideVersionCreation(editor, 'em-execucao', [v('original', 1, 'finalized', 'superseded'), v('v2', 2, 'finalized', 'active')], 'original')), 'base-not-current')
  assert.equal(reason(decideVersionCreation(editor, 'em-execucao', [v('original', 1, 'finalized', 'superseded')], 'original')), 'versions-inconsistent')
  assert.equal(reason(decideVersionCreation(editor, 'arquivada', finalOriginal, 'original')), 'partnership-archived')
  assert.equal(reason(decideVersionCreation(ctx(member('u', ['work-plan.view'])), 'em-execucao', finalOriginal, 'original')), 'permission-not-granted')
})

test('UXPT01-C10 — aplicabilidade financeira por instrumento: Acordo de Cooperação "não se aplica"', () => {
  assert.equal(financialApplicability('termo-colaboracao'), 'applicable')
  assert.equal(financialApplicability('termo-fomento'), 'applicable')
  assert.equal(financialApplicability('acordo-cooperacao'), 'not-applicable')
})
