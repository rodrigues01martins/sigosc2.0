/**
 * DEV-02.1 — Domínio da Gestão de Parcerias (`npm test`). Lógica pura, sem rede.
 * Validação do cadastro (T09–T12, T15) e decisões de consulta e cadastro (T13, T14).
 * Estes testes validam as REGRAS; a gravação real permanece bloqueada (ver servidor).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluate, type AuthorizationContext, type MembershipFacts, type OrganizationFacts } from './authorization.ts'
import {
  INSTRUMENTS,
  decidePartnershipRegistration,
  normalizeForSearch,
  partnershipTitle,
  uniquenessKey,
  validatePartnershipDraft,
} from './partnerships.ts'

const TODAY = '2026-11-17'
const base = {
  instrumentNumber: '06/2026',
  publicPartner: 'Secretaria Municipal Fictícia de Assistência Social',
  object: 'Execução de atividades socioeducativas para crianças e adolescentes.',
  administrativeProcess: '',
  formalizationDate: '2026-03-01',
  termStart: '2026-03-01',
  termEnd: '2028-02-28',
  workPlanApprovalDeclared: true,
}

const osc: OrganizationFacts = { id: 'osc-a', registrationStatus: 'active', commercialStatus: 'active', administratorUid: 'admin' }
const member = (uid: string, extra: Partial<MembershipFacts> = {}): MembershipFacts => ({
  uid, status: 'active', permissions: [], canManagePermissions: false, ...extra,
})
const ctx = (m: MembershipFacts | null, o: OrganizationFacts = osc): AuthorizationContext => ({
  uid: m?.uid ?? null, oscId: 'osc-a', organization: o, membership: m,
})
const suspended = { ...osc, commercialStatus: 'suspended' }

test('DEV-02.1-T09 — Termo de Colaboração: exige valor global e aceita dados coerentes', () => {
  const ok = validatePartnershipDraft({ ...base, instrument: 'termo-colaboracao', globalValueCents: 15_000_000 }, TODAY)
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.draft.globalValueCents, 15_000_000)
    assert.equal(ok.draft.administrativeProcess, null)
  }
  const missing = validatePartnershipDraft({ ...base, instrument: 'termo-colaboracao' }, TODAY)
  assert.deepEqual(missing, { ok: false, errors: { globalValueCents: 'required' } })
  const zero = validatePartnershipDraft({ ...base, instrument: 'termo-colaboracao', globalValueCents: 0 }, TODAY)
  assert.deepEqual(zero, { ok: false, errors: { globalValueCents: 'out-of-range' } })
  const fraction = validatePartnershipDraft({ ...base, instrument: 'termo-colaboracao', globalValueCents: 10.5 }, TODAY)
  assert.deepEqual(fraction, { ok: false, errors: { globalValueCents: 'invalid' } })
})

test('DEV-02.1-T10 — Termo de Fomento: mesmas exigências de transferência financeira', () => {
  assert.equal(validatePartnershipDraft({ ...base, instrument: 'termo-fomento', globalValueCents: 1 }, TODAY).ok, true)
  assert.deepEqual(validatePartnershipDraft({ ...base, instrument: 'termo-fomento', globalValueCents: '100' }, TODAY), {
    ok: false,
    errors: { globalValueCents: 'invalid' },
  })
})

test('DEV-02.1-T11 — Acordo de Cooperação: sem campo de transferência financeira', () => {
  const ok = validatePartnershipDraft({ ...base, instrument: 'acordo-cooperacao' }, TODAY)
  assert.equal(ok.ok, true)
  if (ok.ok) assert.equal(ok.draft.globalValueCents, null)
  // Valor informado para AC é recusado (não se aplica), em vez de gravado.
  assert.deepEqual(validatePartnershipDraft({ ...base, instrument: 'acordo-cooperacao', globalValueCents: 500 }, TODAY), {
    ok: false,
    errors: { globalValueCents: 'not-applicable' },
  })
  assert.equal(INSTRUMENTS.find((i) => i.id === 'acordo-cooperacao')?.financialTransfer, false)
})

test('DEV-02.1-T12 — Instrumentos não abrangidos pelo MROSC são recusados', () => {
  for (const instrument of ['convenio', 'contrato-de-gestao', 'termo-de-parceria', 'proposta', 'chamamento', 'TC', 7]) {
    const result = validatePartnershipDraft({ ...base, instrument, globalValueCents: 100 }, TODAY)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.errors.instrument, 'instrument-not-allowed', String(instrument))
  }
  assert.deepEqual(validatePartnershipDraft({ ...base, globalValueCents: 100 }, TODAY), { ok: false, errors: { instrument: 'required' } })
})

test('DEV-02.1-T15 — Formulário inválido: obrigatórios, datas incoerentes e declaração', () => {
  const empty = validatePartnershipDraft({}, TODAY)
  assert.equal(empty.ok, false)
  if (!empty.ok) {
    assert.deepEqual(Object.keys(empty.errors).sort(), [
      'formalizationDate', 'instrument', 'instrumentNumber', 'object', 'publicPartner', 'termEnd', 'termStart', 'workPlanApprovalDeclared',
    ])
  }
  const check = (patch: Record<string, unknown>, field: string, code: string) => {
    const r = validatePartnershipDraft({ ...base, instrument: 'acordo-cooperacao', ...patch }, TODAY)
    assert.equal(r.ok, false, JSON.stringify(patch))
    if (!r.ok) assert.equal((r.errors as Record<string, string>)[field], code, JSON.stringify(r.errors))
  }
  check({ formalizationDate: '2026-02-30' }, 'formalizationDate', 'invalid-date')
  check({ formalizationDate: '2015-12-31', termStart: '2016-01-01' }, 'formalizationDate', 'before-mrosc')
  check({ formalizationDate: '2026-11-18', termStart: '2026-12-01' }, 'formalizationDate', 'in-future') // proposta/não formalizada
  check({ termStart: '2026-02-28' }, 'termStart', 'start-before-formalization')
  check({ termEnd: '2026-03-01' }, 'termEnd', 'end-not-after-start')
  check({ termEnd: '2026-11-16' }, 'termEnd', 'term-ended')
  check({ object: 'curto' }, 'object', 'too-short')
  check({ instrumentNumber: 'x'.repeat(41) }, 'instrumentNumber', 'too-long')
  check({ publicPartner: 'Órgão\u0000oculto' }, 'publicPartner', 'invalid')
  check({ workPlanApprovalDeclared: 'true' }, 'workPlanApprovalDeclared', 'declaration-required')
  // Espaços extras são normalizados; parceria já em execução (início no passado) é admitida.
  const r = validatePartnershipDraft({ ...base, instrument: 'acordo-cooperacao', instrumentNumber: '  01/2026  ', formalizationDate: '2025-01-10', termStart: '2025-02-01' }, TODAY)
  assert.equal(r.ok && r.draft.instrumentNumber, '01/2026')
})

test('Unicidade e pesquisa: normalização sem acentos e caixa', () => {
  const a = uniquenessKey({ instrument: 'termo-fomento', instrumentNumber: '02/2026', publicPartner: 'Secretaria de Saúde' })
  const b = uniquenessKey({ instrument: 'termo-fomento', instrumentNumber: ' 02/2026', publicPartner: 'SECRETARIA  DE SAUDE' })
  assert.equal(a, b)
  assert.notEqual(a, uniquenessKey({ instrument: 'termo-colaboracao', instrumentNumber: '02/2026', publicPartner: 'Secretaria de Saúde' }))
  assert.equal(normalizeForSearch('  Ação   SOCIAL '), 'acao social')
  assert.equal(partnershipTitle({ instrument: 'termo-colaboracao', instrumentNumber: '06/2026' }), 'Termo de Colaboração 06/2026')
})

test('DEV-02.1-T13 — Cadastro bloqueado: partnerships.edit pendente de especificação', () => {
  const admin = member('admin', { permissions: ['partnerships.view'] })
  const operator = member('op', { permissions: ['partnerships.view'] })
  // Nem administrador nem operador podem cadastrar; permissões forjadas são descartadas.
  assert.deepEqual(decidePartnershipRegistration(ctx(admin)), { allowed: false, reason: 'pending-specification' })
  assert.deepEqual(decidePartnershipRegistration(ctx(operator)), { allowed: false, reason: 'pending-specification' })
  // Sem sessão/vínculo, o motivo é o da identidade, não o da especificação.
  assert.deepEqual(decidePartnershipRegistration(ctx(null)), { allowed: false, reason: 'not-authenticated' })
  assert.deepEqual(decidePartnershipRegistration(ctx(member('x', { status: 'inactive' }))), { allowed: false, reason: 'membership-inactive' })
})

test('DEV-02.1-T14 — Suspensão comercial prevalece no cadastro', () => {
  assert.deepEqual(decidePartnershipRegistration(ctx(member('admin'), suspended)), { allowed: false, reason: 'commercial-suspension' })
  assert.deepEqual(decidePartnershipRegistration(ctx(member('op', { permissions: ['partnerships.view'] }), suspended)), { allowed: false, reason: 'commercial-suspension' })
})

test('Consulta de parcerias (consult): permissão individual; suspensão só preserva o administrador', () => {
  const view = { kind: 'consult', permission: 'partnerships.view' } as const
  assert.deepEqual(evaluate(ctx(member('op', { permissions: ['partnerships.view'] })), view), { allowed: true, authority: 'member' })
  // Administrador SEM a permissão não consulta (sem permissões implícitas).
  assert.deepEqual(evaluate(ctx(member('admin')), view), { allowed: false, reason: 'permission-not-granted' })
  assert.deepEqual(evaluate(ctx(member('admin', { permissions: ['partnerships.view'] })), view), { allowed: true, authority: 'administrator' })
  // Suspensão: administrador com a permissão mantém a consulta; os demais não.
  assert.deepEqual(evaluate(ctx(member('admin', { permissions: ['partnerships.view'] }), suspended), view), { allowed: true, authority: 'administrator' })
  assert.deepEqual(evaluate(ctx(member('op', { permissions: ['partnerships.view'] }), suspended), view), { allowed: false, reason: 'commercial-suspension' })
  assert.deepEqual(evaluate(ctx(member('admin'), suspended), view), { allowed: false, reason: 'permission-not-granted' })
  assert.deepEqual(evaluate(ctx(member('op', { permissions: ['partnerships.view'] })), { kind: 'consult', permission: 'partnerships.edit' }), { allowed: false, reason: 'invalid-permission' })
})
