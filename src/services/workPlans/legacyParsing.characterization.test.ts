/**
 * DEV-UXPT-01 — CARACTERIZAÇÃO da LEITURA de documentos legados do Plano pelo cliente (`npm test`).
 *
 * Registra como `parseWorkPlan` interpreta cada estado persistido hoje (cadastramento, finalizado,
 * versões formais, ativação legada, incorporações abertas/encerradas, campos ausentes). Um modelo
 * futuro (UX-PT-02) PRECISA continuar lendo esses documentos sem migração automática; se uma
 * interpretação mudar, o teste deve ser substituído explicitamente, nunca enfraquecido.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyValues } from '../../domain/workPlans.ts'
import { parseWorkPlan } from './parsing.ts'

const OSC = 'osc-a'
const P = 'p1'
const AT = new Date('2026-05-01T12:00:00Z')
const path = (id: string, osc = OSC, p = P) => `oscs/${osc}/partnerships/${p}/workPlans/${id}`
const informed = (value: string | number) => ({ state: 'informed', value })
const base = (id = 'original', extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id,
  oscId: OSC,
  partnershipId: P,
  origin: { kind: 'approved-plan-registration', formalVersion: false, sequence: 1, sourceWorkPlanId: null },
  registrationStatus: 'in-registration',
  values: { ...emptyValues(), approvalDate: informed('2026-02-10') },
  document: { status: 'not-stored', storagePath: null },
  revision: 3,
  createdAt: AT,
  createdBy: 'u1',
  updatedAt: AT,
  updatedBy: 'u1',
  ...extra,
})
const ACT = { type: 'termo-aditivo', typeDescription: null, reference: '1º TA', actDate: '2026-09-01', description: null, effectiveDate: '2026-10-01', declaredBy: 'u1', declaredAt: AT, automatedVerification: false }
const later = (sequence: number, extra: Record<string, unknown> = {}) =>
  base(`v${sequence}`, { origin: { kind: 'formal-alteration', formalVersion: true, sequence, sourceWorkPlanId: 'original', previousWorkPlanId: sequence === 2 ? 'original' : `v${sequence - 1}`, baseRevision: 3 }, formalAct: ACT, ...extra })
const read = (id: string, data: Record<string, unknown>, p = path(id)) => parseWorkPlan({ path: p, data }, OSC, P)

test('UXPT01-L01 — original em cadastramento: lido sem finalização, ativação nem incorporações', () => {
  const plan = read('original', base())
  assert.ok(plan)
  assert.equal(plan.registrationStatus, 'in-registration')
  assert.equal(plan.sequence, 1)
  assert.equal(plan.activationStatus, null)
  assert.equal(plan.finalizedAt, null)
  assert.equal(plan.finalizedBy, null)
  assert.equal(plan.transcription, null)
  assert.equal(plan.financialTranscription, null)
  assert.equal(plan.componentReview, null)
  assert.equal(plan.revision, 3)
  assert.deepEqual(plan.values.approvalDate, informed('2026-02-10'))
  assert.deepEqual(plan.values.executionStart, { state: 'not-informed' })
})

test('UXPT01-L02 — original finalizado ANTES da DEC-PT-007 (sem componentReview) continua legível; autoria preservada', () => {
  const plan = read('original', base('original', { registrationStatus: 'finalized', finalizedAt: AT, finalizedBy: 'u2', finalizationRequestId: 'req-final' }))
  assert.ok(plan)
  assert.equal(plan.registrationStatus, 'finalized')
  assert.equal(plan.finalizedAt?.toISOString(), AT.toISOString())
  assert.equal(plan.finalizedBy, 'u2')
  assert.equal(plan.componentReview, null)
  assert.equal(plan.activationStatus, null)
})

test('UXPT01-L03 — original substituída: só "superseded" é reconhecido na original; outros valores são ignorados', () => {
  const superseded = read('original', base('original', { registrationStatus: 'finalized', activation: { status: 'superseded', supersededAt: AT, supersededByWorkPlanId: 'v2' } }))
  assert.equal(superseded?.activationStatus, 'superseded')
  assert.equal(superseded?.activation.supersededByWorkPlanId, 'v2')
  const forged = read('original', base('original', { registrationStatus: 'finalized', activation: { status: 'active' } }))
  assert.equal(forged?.activationStatus, null)
})

test('UXPT01-L04 (LEGADO) — versão posterior sem activation.status válido é lida como "pending-decision" (nunca vigente)', () => {
  assert.equal(read('v2', later(2, { registrationStatus: 'finalized' }))?.activationStatus, 'pending-decision')
  assert.equal(read('v2', later(2, { registrationStatus: 'finalized', activation: { status: 'qualquer' } }))?.activationStatus, 'pending-decision')
  assert.equal(read('v2', later(2, { activation: { status: 'awaiting-finalization' } }))?.activationStatus, 'awaiting-finalization')
  const active = read('v2', later(2, { registrationStatus: 'finalized', activation: { status: 'active', activatedAt: AT, supersededWorkPlanId: 'original' } }))
  assert.equal(active?.activationStatus, 'active')
  assert.equal(active?.activation.supersededWorkPlanId, 'original')
  assert.equal(active?.formalAct?.effectiveDate, '2026-10-01')
  assert.equal(active?.previousWorkPlanId, 'original')
})

test('UXPT01-L05 — documentos fora do contrato são DESCARTADOS (falha fechada), não reinterpretados', () => {
  // Versão posterior sem ato formal válido.
  assert.equal(read('v2', later(2, { formalAct: undefined })), null)
  assert.equal(read('v2', later(2, { formalAct: { ...ACT, actDate: 'invalida' } })), null)
  // ID incoerente com a sequência.
  assert.equal(read('v3', later(2)), null)
  // Situação desconhecida (p.ex. um futuro estado sem finalização) não é aceita pelo cliente atual.
  assert.equal(read('original', base('original', { registrationStatus: 'saved' })), null)
  assert.equal(read('original', base('original', { registrationStatus: undefined })), null)
  // Outra OSC/parceria (isolamento).
  assert.equal(parseWorkPlan({ path: path('original', 'osc-b'), data: base() }, OSC, P), null)
  assert.equal(read('original', base('original', { oscId: 'osc-b' })), null)
  assert.equal(read('original', base('original', { partnershipId: 'p2' })), null)
})

test('UXPT01-L06 — valores inválidos viram "não informado"; datas antigas não são limitadas por "hoje"', () => {
  const plan = read('original', base('original', { values: { approvalDate: informed('2099-01-01'), estimatedBeneficiaries: informed(-1), justification: { state: 'qualquer' } } }))
  assert.deepEqual(plan?.values.approvalDate, informed('2099-01-01'))
  assert.deepEqual(plan?.values.estimatedBeneficiaries, { state: 'not-informed' })
  assert.deepEqual(plan?.values.justification, { state: 'not-informed' })
  assert.deepEqual(plan?.values.executionEnd, { state: 'not-informed' })
})

test('UXPT01-L07 — incorporações complementar e financeira: abertas e encerradas, independentes entre si', () => {
  const plan = read(
    'original',
    base('original', {
      registrationStatus: 'finalized',
      complementaryTranscription: { status: 'closed', revision: 2, openedAt: AT, openedBy: 'u1', closedAt: AT, closedBy: 'u2', review: { goals: { status: 'transcribed', justification: null }, indicators: { status: 'transcribed', justification: null } } },
      financialTranscription: { status: 'open', revision: 1, openedAt: AT, openedBy: 'u1' },
    }),
  )
  assert.equal(plan?.transcription?.status, 'closed')
  assert.equal(plan?.transcription?.revision, 2)
  assert.equal(plan?.transcription?.closedBy, 'u2')
  assert.equal(plan?.transcription?.review?.goals.status, 'transcribed')
  assert.equal(plan?.financialTranscription?.status, 'open')
  assert.equal(plan?.financialTranscription?.closedAt, null)
  // Situação desconhecida da incorporação → ausente (null), sem quebrar o Plano.
  assert.equal(read('original', base('original', { complementaryTranscription: { status: 'paused' } }))?.transcription, null)
})
