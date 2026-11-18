/**
 * DEV-02.1 e complemento C01 — Domínio da Gestão de Parcerias (`npm test`). Lógica pura.
 * Regras de cadastro/edição (DEC-PAR-001 a 006). A gravação real é testada no servidor
 * com emuladores (tests/server/partnerships.server.test.ts).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GRANTABLE_PERMISSIONS,
  evaluate,
  isGrantablePermission,
  sanitizePermissions,
  type AuthorizationContext,
  type GrantablePermissionId,
  type MembershipFacts,
  type OrganizationFacts,
} from './authorization.ts'
import {
  INSTRUMENTS,
  allowsNewOperationalRecords,
  decidePartnershipCreation,
  decidePartnershipEdit,
  duplicateCheckKey,
  normalizeForSearch,
  partnershipTitle,
  validatePartnershipChanges,
  validatePartnershipDraft,
} from './partnerships.ts'

const TODAY = '2026-11-17'
const base = {
  instrumentNumber: '06/2026',
  publicPartner: 'Secretaria Municipal Fictícia de Assistência Social',
  object: 'Oficinas.',
  formalizationDate: '2026-03-01',
  termStart: '2026-03-01',
  termEnd: '2028-02-28',
  administrativeStatus: 'em-execucao',
  workPlanApprovalDeclared: true,
}
const tc = { ...base, instrument: 'termo-colaboracao', globalValueStatus: 'informed', globalValueCents: 15_000_000 }
const ac = { ...base, instrument: 'acordo-cooperacao' }

const osc: OrganizationFacts = { id: 'osc-a', registrationStatus: 'active', commercialStatus: 'active', administratorUid: 'admin' }
const member = (uid: string, permissions: GrantablePermissionId[] = [], extra: Partial<MembershipFacts> = {}): MembershipFacts => ({
  uid, status: 'active', permissions, canManagePermissions: false, ...extra,
})
const ctx = (m: MembershipFacts | null, o: OrganizationFacts = osc): AuthorizationContext => ({ uid: m?.uid ?? null, oscId: 'osc-a', organization: o, membership: m })
const suspended = { ...osc, commercialStatus: 'suspended' }
const errorsOf = (input: Record<string, unknown>) => {
  const r = validatePartnershipDraft(input, TODAY)
  return r.ok ? {} : r.errors
}

test('DEV-02.1-C01-T01 — catálogo: view, create e edit concedíveis e independentes (DEC-PAR-001)', () => {
  for (const id of ['partnerships.view', 'partnerships.create', 'partnerships.edit']) assert.equal(isGrantablePermission(id), true, id)
  assert.deepEqual(GRANTABLE_PERMISSIONS.filter((p) => p.startsWith('partnerships.')), ['partnerships.view', 'partnerships.create', 'partnerships.edit'])
  assert.deepEqual(sanitizePermissions(['partnerships.edit', 'partnerships.create', 'partnerships.view']), ['partnerships.view', 'partnerships.create', 'partnerships.edit'])
  // Nenhuma competência implica outra.
  const create = ctx(member('u', ['partnerships.create']))
  const edit = ctx(member('u', ['partnerships.edit']))
  assert.equal(decidePartnershipCreation(create).allowed, true)
  assert.equal(decidePartnershipEdit(create, 'em-execucao').allowed, false)
  assert.equal(evaluate(create, { kind: 'consult', permission: 'partnerships.view' }).allowed, false)
  assert.equal(decidePartnershipEdit(edit, 'em-execucao').allowed, true)
  assert.equal(decidePartnershipCreation(edit).allowed, false)
  assert.equal(evaluate(edit, { kind: 'consult', permission: 'partnerships.view' }).allowed, false)
  assert.equal(decidePartnershipCreation(ctx(member('u', ['partnerships.view']))).allowed, false)
})

test('DEV-02.1-C01-T02/T03/T05 — create autoriza cadastro; edit não cadastra; create não edita', () => {
  assert.deepEqual(decidePartnershipCreation(ctx(member('op', ['partnerships.create']))), { allowed: true, authority: 'member' })
  assert.deepEqual(decidePartnershipCreation(ctx(member('op', ['partnerships.edit']))), { allowed: false, reason: 'permission-not-granted' })
  assert.deepEqual(decidePartnershipEdit(ctx(member('op', ['partnerships.create'])), 'em-execucao'), { allowed: false, reason: 'permission-not-granted' })
})

test('DEV-02.1-C01-T06/T07/T08 — administrador sem permissões implícitas; nem ele nem o delegado alteram as dele (DEC-PAR-002)', () => {
  assert.deepEqual(decidePartnershipCreation(ctx(member('admin'))), { allowed: false, reason: 'permission-not-granted' })
  assert.deepEqual(decidePartnershipEdit(ctx(member('admin')), 'em-execucao'), { allowed: false, reason: 'permission-not-granted' })
  const admin = member('admin')
  const delegate = member('d1', [], { canManagePermissions: true })
  for (const permission of ['partnerships.create', 'partnerships.edit', 'partnerships.view']) {
    assert.deepEqual(evaluate(ctx(admin), { kind: 'grant-permission', target: admin, permission }), { allowed: false, reason: 'self-modification' })
    assert.deepEqual(evaluate(ctx(delegate), { kind: 'grant-permission', target: admin, permission }), { allowed: false, reason: 'target-is-administrator' })
    assert.deepEqual(evaluate(ctx(delegate), { kind: 'revoke-permission', target: admin, permission }), { allowed: false, reason: 'target-is-administrator' })
    // Administrador e delegado concedem as novas competências a OUTROS usuários elegíveis.
    assert.equal(evaluate(ctx(admin), { kind: 'grant-permission', target: member('op'), permission }).allowed, true)
    assert.equal(evaluate(ctx(delegate), { kind: 'grant-permission', target: member('op'), permission }).allowed, true)
  }
})

test('DEV-02.1-C01-T10/T11/T12 — TC e TF com valor informado ou "não informado"; AC sem valor (DEC-PAR-005)', () => {
  const ok = validatePartnershipDraft(tc, TODAY)
  assert.ok(ok.ok)
  assert.equal(ok.draft.globalValueStatus, 'informed')
  assert.equal(ok.draft.globalValueCents, 15_000_000)
  const tf = validatePartnershipDraft({ ...base, instrument: 'termo-fomento', globalValueStatus: 'not-informed' }, TODAY)
  assert.ok(tf.ok)
  assert.deepEqual([tf.draft.globalValueStatus, tf.draft.globalValueCents], ['not-informed', null]) // ausência ≠ zero
  const zero = validatePartnershipDraft({ ...tc, globalValueCents: 0 }, TODAY)
  assert.ok(zero.ok)
  assert.deepEqual([zero.draft.globalValueStatus, zero.draft.globalValueCents, zero.warnings.globalValueCents], ['informed', 0, 'zero-value'])
  assert.deepEqual(errorsOf({ ...base, instrument: 'termo-fomento' }), { globalValueStatus: 'required' })
  assert.deepEqual(errorsOf({ ...tc, globalValueCents: null }), { globalValueCents: 'required' })
  assert.deepEqual(errorsOf({ ...tc, globalValueCents: 10.5 }), { globalValueCents: 'invalid' })
  assert.deepEqual(errorsOf({ ...tc, globalValueStatus: 'not-informed' }), { globalValueCents: 'invalid' })
  const coop = validatePartnershipDraft(ac, TODAY)
  assert.ok(coop.ok)
  assert.deepEqual([coop.draft.globalValueStatus, coop.draft.globalValueCents], ['not-applicable', null])
  assert.deepEqual(errorsOf({ ...ac, globalValueStatus: 'informed', globalValueCents: 500 }), { globalValueCents: 'not-applicable' })
  assert.deepEqual(errorsOf({ ...ac, globalValueCents: 0 }), { globalValueCents: 'not-applicable' }) // zero não vira "transferência registrada"
  assert.equal(INSTRUMENTS.find((i) => i.id === 'acordo-cooperacao')?.financialTransfer, false)
  for (const instrument of ['convenio', 'contrato-de-gestao', 'termo-de-parceria', 'TC', 7]) {
    assert.equal(errorsOf({ ...tc, instrument }).instrument, 'instrument-not-allowed', String(instrument))
  }
})

test('DEV-02.1-C01-T13/T18 — vigência encerrada e datas históricas admitidas; só erros comprovados bloqueiam (DEC-PAR-004/005)', () => {
  const ended = validatePartnershipDraft({ ...ac, formalizationDate: '2019-05-10', termStart: '2019-06-01', termEnd: '2021-05-31' }, TODAY)
  assert.ok(ended.ok)
  const preMrosc = validatePartnershipDraft({ ...ac, formalizationDate: '2015-12-01', termStart: '2016-01-01', termEnd: '2017-01-01' }, TODAY)
  assert.ok(preMrosc.ok, 'data anterior a 23/01/2016 não é recusada')
  assert.equal(preMrosc.warnings.formalizationDate, 'before-mrosc-reference')
  const retro = validatePartnershipDraft({ ...ac, termStart: '2026-02-15' }, TODAY)
  assert.ok(retro.ok, 'início anterior à formalização gera aviso, não erro')
  assert.equal(retro.warnings.termStart, 'start-before-formalization')
  const sameDay = validatePartnershipDraft({ ...ac, termEnd: '2026-03-01' }, TODAY)
  assert.ok(sameDay.ok)
  assert.deepEqual(errorsOf({ ...ac, termEnd: '2026-02-28' }), { termEnd: 'end-before-start' })
  assert.deepEqual(errorsOf({ ...ac, formalizationDate: '2026-11-18', termStart: '2026-12-01' }), { formalizationDate: 'in-future' })
  assert.deepEqual(errorsOf({ ...ac, formalizationDate: '2026-02-30' }), { formalizationDate: 'invalid-date' })
  // Sem mínimo jurídico artificial para o objeto.
  assert.ok(validatePartnershipDraft({ ...ac, object: 'Apoio.' }, TODAY).ok)
  assert.deepEqual(errorsOf({ ...ac, object: '   ' }), { object: 'required' })
  assert.deepEqual(errorsOf({ ...ac, publicPartner: 'Órgão\u0000oculto' }), { publicPartner: 'invalid' })
  assert.deepEqual(errorsOf({ ...ac, instrumentNumber: 'x'.repeat(61) }), { instrumentNumber: 'too-long' })
})

test('DEV-02.1-C01-T14/T15/T16/T17 — situação declarada; nunca calculada; arquivada bloqueia novos registros (DEC-PAR-003/006)', () => {
  for (const status of ['em-execucao', 'suspensa', 'encerrada', 'arquivada']) {
    const r = validatePartnershipDraft({ ...ac, administrativeStatus: status }, TODAY)
    assert.ok(r.ok, status)
    assert.equal(r.draft.administrativeStatus, status)
  }
  const { administrativeStatus: _omit, ...withoutStatus } = ac
  void _omit
  assert.deepEqual(errorsOf(withoutStatus), { administrativeStatus: 'status-required' }) // sem padrão automático
  assert.deepEqual(errorsOf({ ...ac, administrativeStatus: 'aprovada' }), { administrativeStatus: 'status-required' })
  // Vigência encerrada declarada "Em execução" é mantida: a situação não é calculada pelas datas.
  const declared = validatePartnershipDraft({ ...ac, termStart: '2020-01-01', formalizationDate: '2019-12-01', termEnd: '2021-01-01', administrativeStatus: 'em-execucao' }, TODAY)
  assert.ok(declared.ok)
  assert.equal(declared.draft.administrativeStatus, 'em-execucao')
  // Suspensa e encerrada não bloqueiam; arquivada bloqueia novos registros e alterações.
  assert.deepEqual(['em-execucao', 'suspensa', 'encerrada', 'arquivada'].map((s) => allowsNewOperationalRecords(s as never)), [true, true, true, false])
  const editor = ctx(member('ed', ['partnerships.edit']))
  assert.equal(decidePartnershipEdit(editor, 'suspensa').allowed, true)
  assert.equal(decidePartnershipEdit(editor, 'encerrada').allowed, true)
  assert.deepEqual(decidePartnershipEdit(editor, 'arquivada'), { allowed: false, reason: 'partnership-archived' })
})

test('DEV-02.1-C01-T21/T22 — sem autorização ou com suspensão comercial: nem cadastro nem edição', () => {
  const both: GrantablePermissionId[] = ['partnerships.create', 'partnerships.edit', 'partnerships.view']
  assert.deepEqual(decidePartnershipCreation(ctx(member('op', both), suspended)), { allowed: false, reason: 'commercial-suspension' })
  assert.deepEqual(decidePartnershipEdit(ctx(member('op', both), suspended), 'em-execucao'), { allowed: false, reason: 'commercial-suspension' })
  assert.deepEqual(decidePartnershipCreation(ctx(member('admin', both), suspended)), { allowed: false, reason: 'commercial-suspension' })
  assert.deepEqual(decidePartnershipCreation(ctx(member('x', both, { status: 'inactive' }))), { allowed: false, reason: 'membership-inactive' })
  assert.deepEqual(decidePartnershipCreation(ctx(null)), { allowed: false, reason: 'not-authenticated' })
})

test('Correção cadastral: somente campos editáveis; protegidos recusados', () => {
  assert.deepEqual(validatePartnershipChanges({ object: '  Novo objeto  ', administrativeProcess: '' }), { ok: true, changes: { object: 'Novo objeto', administrativeProcess: null } })
  for (const forbidden of ['instrument', 'termEnd', 'globalValueCents', 'administrativeStatus', 'createdBy', 'oscId', 'id']) {
    assert.deepEqual(validatePartnershipChanges({ [forbidden]: 'x' }), { ok: false, errors: { changes: 'invalid' } }, forbidden)
  }
  assert.deepEqual(validatePartnershipChanges({}), { ok: false, errors: { changes: 'required' } })
  assert.deepEqual(validatePartnershipChanges({ publicPartner: '' }), { ok: false, errors: { publicPartner: 'required' } })
})

test('DEV-02.1-C01-T19 — chave de conferência de duplicidade (normalizada; não é unicidade)', () => {
  const a = duplicateCheckKey({ instrument: 'termo-fomento', instrumentNumber: '02/2026', publicPartner: 'Secretaria de Saúde' })
  assert.equal(a, duplicateCheckKey({ instrument: 'termo-fomento', instrumentNumber: ' 02/2026', publicPartner: 'SECRETARIA  DE SAUDE' }))
  assert.notEqual(a, duplicateCheckKey({ instrument: 'termo-colaboracao', instrumentNumber: '02/2026', publicPartner: 'Secretaria de Saúde' }))
  assert.equal(normalizeForSearch('  Ação   SOCIAL '), 'acao social')
  assert.equal(partnershipTitle({ instrument: 'termo-colaboracao', instrumentNumber: '06/2026' }), 'Termo de Colaboração 06/2026')
})

test('Consulta (consult): permissão individual; na suspensão comercial só o administrador com a permissão', () => {
  const view = { kind: 'consult', permission: 'partnerships.view' } as const
  assert.deepEqual(evaluate(ctx(member('op', ['partnerships.view'])), view), { allowed: true, authority: 'member' })
  assert.deepEqual(evaluate(ctx(member('admin')), view), { allowed: false, reason: 'permission-not-granted' })
  assert.deepEqual(evaluate(ctx(member('admin', ['partnerships.view']), suspended), view), { allowed: true, authority: 'administrator' })
  assert.deepEqual(evaluate(ctx(member('op', ['partnerships.view']), suspended), view), { allowed: false, reason: 'commercial-suspension' })
})
