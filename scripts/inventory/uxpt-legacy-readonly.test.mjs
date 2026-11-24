/**
 * INV-PREP-01 / INV-PREP-02A — Testes OFFLINE do inventário INV-UXPT-01
 * (`node --test scripts/inventory/*.test.mjs`).
 *
 * Somente dados FICTÍCIOS em memória: nenhum Firebase real, nenhum emulador, nenhuma rede.
 * Cobrem contagens E1–E15 (sobrepostas), integridade aritmética × anomalias × completude, paginação
 * (limites exatos, repetição, falha em página intermediária), falha segura, ausência de identificadores
 * na saída (inclusive IDs curtos, numéricos, com caracteres especiais e iguais a palavras do
 * relatório), rejeição de outro projeto, ausência de escrita e o contrato do workflow.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { classifyPartnership, dataAnomalies, zeroCounters } from './classify.mjs'
import { assertAggregateOnly, assertReportShape, firestoreSource, readAll, renderMarkdown, runInventory, safeErrorCode } from './reader.mjs'
import { main, validateConfig } from './uxpt-legacy-readonly.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')

// ------------------------------------------------------------------ fixtures fictícias

const A = 'osc-ficticia-aaa'
const B = 'osc-ficticia-bbb'
const DATE = { _ficticio: true }
const plan = (osc, p, extra = {}) => ({ oscId: osc, partnershipId: p, registrationStatus: 'finalized', revision: 3, finalizedAt: DATE, ...extra })
const later = (osc, p, sequence, extra = {}) =>
  plan(osc, p, { 'origin.sequence': sequence, 'origin.previousWorkPlanId': sequence === 2 ? 'original' : `v${sequence - 1}`, 'formalAct.type': 'termo-aditivo', 'formalAct.actDate': '2026-09-01', 'activation.status': 'active', ...extra })

/** Árvore em memória: caminho da coleção → documentos (ordenados por ID, como o Firestore). */
function tree({ partnershipIds = null, extraOscs = [] } = {}) {
  const t = {}
  const put = (path, id, data) => ((t[path] ??= []).push({ id, data }), undefined)
  put('oscs', A, {})
  put('oscs', B, {})
  for (const o of extraOscs) put('oscs', o, {})
  const parts = partnershipIds ?? {
    [A]: ['pSemPlano0001', 'pCadastro0002', 'pFinal000003', 'pAtiva000004', 'pAguarda0005', 'pPendente006', 'pInconsist07', 'pInvalida008'],
    [B]: ['pOutraOsc009', 'pSomenteV2010'],
  }
  for (const [osc, ids] of Object.entries(parts)) for (const id of ids) put(`oscs/${osc}/partnerships`, id, {})
  const wp = (osc, p) => `oscs/${osc}/partnerships/${p}/workPlans`
  put(wp(A, 'pCadastro0002'), 'original', plan(A, 'pCadastro0002', { registrationStatus: 'in-registration', finalizedAt: undefined }))
  put(wp(A, 'pFinal000003'), 'original', plan(A, 'pFinal000003', { correctionCount: 2, 'complementaryTranscription.status': 'open', 'financialTranscription.status': 'closed' }))
  put(wp(A, 'pAtiva000004'), 'original', plan(A, 'pAtiva000004', { 'activation.status': 'superseded' }))
  put(wp(A, 'pAtiva000004'), 'v2', later(A, 'pAtiva000004', 2, { 'complementaryTranscription.status': 'closed', 'financialTranscription.status': 'open' }))
  put(wp(A, 'pAguarda0005'), 'original', plan(A, 'pAguarda0005'))
  put(wp(A, 'pAguarda0005'), 'v2', later(A, 'pAguarda0005', 2, { registrationStatus: 'in-registration', finalizedAt: undefined, 'activation.status': 'awaiting-finalization' }))
  put(wp(A, 'pPendente006'), 'original', plan(A, 'pPendente006'))
  put(wp(A, 'pPendente006'), 'v2', later(A, 'pPendente006', 2, { 'activation.status': 'pending-decision' }))
  put(wp(A, 'pInconsist07'), 'original', plan(A, 'pInconsist07', { 'activation.status': 'superseded' }))
  put(wp(A, 'pInconsist07'), 'v2', later(A, 'pInconsist07', 2))
  put(wp(A, 'pInconsist07'), 'v3', later(A, 'pInconsist07', 3))
  put(wp(A, 'pInvalida008'), 'original', plan(A, 'pInvalida008', { registrationStatus: 'saved', revision: 0, 'activation.status': 'active', 'complementaryTranscription.status': 'paused' }))
  put(wp(A, 'pInvalida008'), 'rascunho', plan(A, 'pInvalida008'))
  put(wp(A, 'pInvalida008'), 'v2', later(A, 'pInvalida008', 2, { 'activation.status': 'qualquer', 'formalAct.actDate': 'invalida', 'origin.previousWorkPlanId': 'v9' }))
  put(wp(B, 'pOutraOsc009'), 'original', plan(A, 'pOutraOsc009', { finalizedAt: undefined }))
  put(wp(B, 'pSomenteV2010'), 'v2', later(B, 'pSomenteV2010', 2))
  let n = 0
  const ev = (osc, action, count = 1) => {
    for (let i = 0; i < count; i++) put(`oscs/${osc}/workPlanEvents`, `ev${String(++n).padStart(4, '0')}${osc}`, action === undefined ? {} : { action })
  }
  ev(A, 'material-correction', 2)
  ev(A, 'version-created', 2)
  ev(A, 'version-activated')
  ev(A, 'complementary-transcription-opened')
  ev(A, 'complementary-transcription-closed')
  ev(A, 'financial-transcription-opened')
  ev(A, 'financial-transcription-closed')
  ev(A, 'update', 3)
  ev(A, 'acao-desconhecida')
  ev(A, undefined)
  ev(B, 'finalize')
  for (const list of Object.values(t)) list.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  return t
}

/** Fonte de leitura fictícia com paginação por cursor (mesmo contrato do adaptador real). */
function memorySource(t, { fail = () => null, ignoreCursor = () => false } = {}) {
  const calls = []
  return {
    calls,
    async listPage(path, fields, pageSize, afterId) {
      calls.push({ path, fields, pageSize, afterId })
      const error = fail(path, afterId)
      if (error) throw error
      const all = t[path] ?? []
      const start = afterId === null || ignoreCursor(path) ? 0 : all.findIndex((d) => d.id > afterId)
      const page = start < 0 ? [] : all.slice(start, start + pageSize)
      return page.map((d) => ({ id: d.id, data: Object.fromEntries(fields.map((f) => [f, d.data[f]])) }))
    },
  }
}
const allIds = (t) => Object.values(t).flatMap((l) => l.map((d) => d.id)).filter((id) => !/^(original|v\d+)$/.test(id))
const values = (report) => Object.fromEntries(Object.entries(report.states).map(([k, v]) => [k, v.value]))

const EXPECTED_STATES = {
  E1_notStructured: 2,
  E2_inRegistration: 2,
  E3_finalized: 12,
  E4_original: 8,
  E5_laterVersions: 7,
  E6_partnershipsWithCurrent: 6,
  E7_storedSuperseded: 2,
  E7_shownSuperseded: 5,
  E8_awaitingFinalization: 1,
  E9a_pendingDecisionFinalized: 1,
  E9b_withoutValidActivation: 1,
  E9c_inconsistentChains: 1,
  E9d_multipleActive: 1,
  E9e_activeNotFinalized: 0,
  E9f_originalSupersededWithoutSuccessor: 0,
  E10_complementaryOpen: 1,
  E11_complementaryClosed: 1,
  E12_financialOpen: 1,
  E13_financialClosed: 1,
  E14_materialCorrections: 2,
  E15_events: 15,
}

// ------------------------------------------------------------------ contagens e sobreposição

test('INV-T01 — contagens E1–E15 corretas, sobrepostas, com totais consistentes', async () => {
  const { report } = await runInventory(memorySource(tree()))
  assert.equal(report.status, 'complete')
  assert.equal(report.queryComplete, true)
  assert.equal(report.arithmeticConsistent, true)
  assert.deepEqual(report.arithmeticIssues, [])
  assert.equal(report.correctionCountMatchesEvents, true)
  assert.deepEqual(values(report), EXPECTED_STATES)
  const c = report.counts
  assert.equal(c.oscs, 2)
  assert.deepEqual(c.partnerships, { total: 10, withPlans: 9, withoutOriginal: 2, withVersionsButWithoutOriginal: 1 })
  assert.deepEqual(c.originals, { total: 8, inRegistration: 1, finalized: 6, unknownRegistration: 1, finalizedWithoutFinalizedAt: 1, storedSuperseded: 2, unrecognizedActivationIgnored: 1 })
  assert.deepEqual(c.laterVersions, {
    total: 7,
    inRegistration: 1,
    finalized: 6,
    unknownRegistration: 0,
    finalizedWithoutFinalizedAt: 0,
    storedActive: 4,
    storedSuperseded: 0,
    storedAwaitingFinalization: 1,
    storedPendingDecision: 1,
    withoutValidActivation: 1,
    awaitingFinalization: 1,
    pendingDecisionFinalized: 1,
    pendingDecisionInRegistration: 0,
    activeNotFinalized: 0,
    invalidFormalAct: 1,
  })
  assert.deepEqual(c.current, { determinedOriginal: 4, determinedLater: 2, none: 2, inconsistent: 1, multipleActive: 1, originalSupersededWithoutActiveSuccessor: 0 })
  assert.deepEqual(c.derived, { superseded: 5, legacyPending: 1 })
  assert.deepEqual(c.transcriptions, { complementaryOpen: 1, complementaryClosed: 1, complementaryUnknown: 1, financialOpen: 1, financialClosed: 1, financialUnknown: 0 })
  assert.deepEqual(c.corrections, { plansWithCorrections: 1, correctionCountSum: 2 })
  assert.deepEqual(c.integrity, {
    invalidVersionId: 1,
    sequenceMismatch: 0,
    pathFieldMismatch: 1,
    previousVersionMissing: 2,
    previousVersionNotEarlier: 0,
    invalidRevision: 1,
    invalidCorrectionCount: 0,
    unrecognizedRegistrationStatus: 1,
    unrecognizedActivationStatus: 1,
    unrecognizedTranscriptionStatus: 1,
  })
  assert.equal(c.events.total, 15)
  assert.equal(c.events.byAction['material-correction'], 2)
  assert.equal(c.events.byAction['version-created'], 2)
  assert.equal(c.events.byAction['version-activated'], 1)
  assert.equal(c.events.byAction.finalize, 1)
  assert.equal(c.events.unknownAction, 1)
  assert.equal(c.events.withoutValidAction, 1)
  // Aritmética consistente NÃO significa dados íntegros: há anomalias históricas relatadas à parte.
  assert.deepEqual(report.dataAnomalies, { total: 12, integrity: 8, inconsistentChains: 1, activeNotFinalized: 0, invalidFormalAct: 1, unknownEvents: 2, correctionMismatch: 0 })
  // Sobreposição: estados não somam ao total de versões (15 documentos válidos).
  assert.ok(EXPECTED_STATES.E3_finalized + EXPECTED_STATES.E2_inRegistration + EXPECTED_STATES.E7_storedSuperseded > c.originals.total + c.laterVersions.total)
})

test('INV-T02 — "encontrado", "não encontrado após consulta completa" e "não verificável" são distintos', async () => {
  const t = tree()
  delete t[`oscs/${A}/workPlanEvents`]
  delete t[`oscs/${B}/workPlanEvents`]
  const { report } = await runInventory(memorySource(t))
  assert.equal(report.status, 'complete')
  assert.equal(report.states.E14_materialCorrections.finding, 'not-found')
  assert.equal(report.states.E14_materialCorrections.value, 0)
  assert.equal(report.states.E1_notStructured.finding, 'found')
  // Sem eventos, a soma de correctionCount (2) diverge: anomalia de dados, não erro aritmético.
  assert.equal(report.arithmeticConsistent, true)
  assert.equal(report.correctionCountMatchesEvents, false)
  assert.equal(report.dataAnomalies.correctionMismatch, 1)
  const failing = await runInventory(memorySource(tree(), { fail: (p) => (p.endsWith('/workPlanEvents') ? Object.assign(new Error('x'), { code: 7 }) : null) }))
  assert.equal(failing.report.states.E14_materialCorrections.finding, 'not-verifiable')
  assert.equal(failing.report.states.E14_materialCorrections.value, null)
  assert.equal(failing.report.correctionCountMatchesEvents, null)
  assert.equal(failing.report.dataAnomalies, null)
})

// ------------------------------------------------------------------ paginação e falha segura

test('INV-T03 — paginação: páginas pequenas produzem exatamente o mesmo resultado', async () => {
  const full = await runInventory(memorySource(tree()))
  const source = memorySource(tree())
  const paged = await runInventory(source, { pageSize: 2, now: new Date(full.report.generatedAt) })
  assert.deepEqual(paged.report, full.report)
  assert.ok(source.calls.filter((c) => c.path.endsWith('/workPlanEvents')).length > 2, 'eventos lidos em várias páginas')
  assert.ok(source.calls.every((c) => c.pageSize === 2))
})

test('INV-T04 — cursor que não avança interrompe a seção (sem números fabricados)', async () => {
  const t = tree()
  await assert.rejects(readAll(memorySource(t, { ignoreCursor: () => true }), `oscs/${A}/workPlanEvents`, ['action'], 'events', 2), /pagination-stalled/)
  const { report } = await runInventory(memorySource(t, { ignoreCursor: (p) => p.endsWith('/workPlanEvents') }), { pageSize: 2 })
  assert.equal(report.status, 'partial')
  assert.equal(report.queryComplete, false)
  assert.equal(report.sections.events, 'not-verifiable')
  assert.equal(report.counts.events.total, null)
  assert.equal(report.arithmeticConsistent, null)
  assert.deepEqual(report.failures, ['events:pagination-stalled'])
  assert.equal(report.states.E4_original.value, 8)
})

test('INV-T05 — falha de autorização: versões não verificáveis; falha nas OSCs: nada é contado', async () => {
  const denied = Object.assign(new Error('PERMISSION_DENIED: caminho/osc-ficticia-aaa'), { code: 7 })
  const partial = await runInventory(memorySource(tree(), { fail: (p) => (p.endsWith('/workPlans') ? denied : null) }))
  assert.equal(partial.report.status, 'partial')
  assert.equal(partial.report.sections.workPlans, 'not-verifiable')
  assert.equal(partial.report.sections.partnerships, 'not-verifiable')
  assert.equal(partial.report.counts.originals.total, null)
  assert.equal(partial.report.states.E4_original.finding, 'not-verifiable')
  assert.equal(partial.report.sections.events, 'complete')
  assert.deepEqual(partial.report.failures, ['workPlans:grpc-7'])
  const failed = await runInventory(memorySource(tree(), { fail: (p) => (p === 'oscs' ? denied : null) }))
  assert.equal(failed.report.status, 'failed')
  assert.equal(failed.report.counts.oscs, null)
  assert.ok(Object.values(failed.report.states).every((s) => s.value === null && s.finding === 'not-verifiable'))
  assert.ok(assertAggregateOnly(failed.report, renderMarkdown(failed.report), ['osc-ficticia-aaa']))
})

test('INV-T06 — página malformada, ID vazio ou página acima do tamanho pedido é recusada', async () => {
  await assert.rejects(readAll({ listPage: async () => [{ id: 'x' }] }, 'oscs', [], 'oscs', 10), /pagination-invalid/)
  await assert.rejects(readAll({ listPage: async () => [{ id: '', data: {} }] }, 'oscs', [], 'oscs', 10), /pagination-invalid/)
  const tooBig = { listPage: async () => [{ id: 'a', data: {} }, { id: 'b', data: {} }, { id: 'c', data: {} }] }
  await assert.rejects(readAll(tooBig, 'oscs', [], 'oscs', 2), /pagination-invalid/)
})

test('INV-T15 — limites exatos de página: 0, 200, 201 e 400 documentos; limite máximo de páginas', async () => {
  const docs = (n) => Array.from({ length: n }, (_, i) => ({ id: `d${String(i).padStart(5, '0')}`, data: {} }))
  for (const [n, expectedCalls] of [[0, 1], [200, 2], [201, 2], [400, 3]]) {
    const source = memorySource({ c: docs(n) })
    const read = await readAll(source, 'c', [], 'oscs', 200)
    assert.equal(read.length, n, `${n} documentos lidos`)
    assert.equal(source.calls.length, expectedCalls, `${n} documentos → ${expectedCalls} páginas`)
    assert.deepEqual(source.calls.map((c) => c.afterId), [null, ...read.filter((_, i) => (i + 1) % 200 === 0).map((d) => d.id)].slice(0, expectedCalls))
  }
  await assert.rejects(readAll(memorySource({ c: docs(5) }), 'c', [], 'oscs', 1, 3), /pagination-limit/)
  assert.equal((await readAll(memorySource({ c: docs(3) }), 'c', [], 'oscs', 1, 4)).length, 3)
})

test('INV-T16 — falha na SEGUNDA página (autorização) não preserva contagens parciais', async () => {
  const denied = Object.assign(new Error('negado'), { code: 7 })
  const onSecondPage = (suffix) => (path, afterId) => (path.endsWith(suffix) && afterId !== null ? denied : null)
  const events = await runInventory(memorySource(tree(), { fail: onSecondPage('/workPlanEvents') }), { pageSize: 2 })
  assert.equal(events.report.sections.events, 'not-verifiable')
  assert.equal(events.report.counts.events.total, null)
  assert.ok(Object.values(events.report.counts.events.byAction).every((v) => v === null))
  const partnerships = await runInventory(memorySource(tree(), { fail: onSecondPage('/partnerships') }), { pageSize: 2 })
  assert.equal(partnerships.report.status, 'partial')
  assert.equal(partnerships.report.counts.partnerships.total, null)
  assert.equal(partnerships.report.states.E1_notStructured.value, null)
  assert.deepEqual(partnerships.report.failures, ['partnerships:grpc-7'])
})

test('INV-T17 — OSC sem parcerias e coleção de eventos ausente contam como consulta completa', async () => {
  const { report } = await runInventory(memorySource(tree({ extraOscs: ['osc-ficticia-ccc'] })))
  assert.equal(report.status, 'complete')
  assert.equal(report.counts.oscs, 3)
  assert.equal(report.counts.partnerships.total, 10)
  assert.equal(report.arithmeticConsistent, true)
})

// ------------------------------------------------------------------ E9 e cadeias (classificação direta)

const chain = (plans) => {
  const c = zeroCounters()
  classifyPartnership(c, 'o', 'p', plans.map(([id, data]) => ({ id, data: { oscId: 'o', partnershipId: 'p', revision: 1, finalizedAt: DATE, ...data } })))
  return c
}
const fin = (extra = {}) => ({ registrationStatus: 'finalized', ...extra })
const ver = (seq, extra = {}) => fin({ 'origin.sequence': seq, 'origin.previousWorkPlanId': seq === 2 ? 'original' : `v${seq - 1}`, 'formalAct.type': 'apostilamento', 'formalAct.actDate': '2026-10-01', 'activation.status': 'active', ...extra })

test('INV-T18 — E9: cada situação legada é identificada separadamente', () => {
  // Original substituída sem sucessora ativa (E9f) → cadeia inconsistente (E9c).
  let c = chain([['original', fin({ 'activation.status': 'superseded' })]])
  assert.deepEqual([c.current.inconsistent, c.current.originalSupersededWithoutActiveSuccessor], [1, 1])
  // Duas ativas (E9d).
  c = chain([['original', fin({ 'activation.status': 'superseded' })], ['v2', ver(2)], ['v3', ver(3)]])
  assert.deepEqual([c.current.inconsistent, c.current.multipleActive, c.current.originalSupersededWithoutActiveSuccessor], [1, 1, 0])
  // Ativa não finalizada (E9e) → inconsistente pelo domínio.
  c = chain([['original', fin()], ['v2', ver(2, { registrationStatus: 'in-registration' })]])
  assert.deepEqual([c.laterVersions.activeNotFinalized, c.current.inconsistent, c.laterVersions.awaitingFinalization], [1, 1, 0])
  // pending-decision finalizada (E9a): não vigente; original continua a referência (sem inconsistência).
  c = chain([['original', fin()], ['v2', ver(2, { 'activation.status': 'pending-decision' })]])
  assert.deepEqual([c.laterVersions.pendingDecisionFinalized, c.derived.legacyPending, c.current.determinedOriginal, c.current.inconsistent], [1, 1, 1, 0])
  // Ativação desconhecida (E9b) e ato formal inválido.
  c = chain([['original', fin()], ['v2', ver(2, { 'activation.status': 'ativa?', 'formalAct.type': 'decreto' })]])
  assert.deepEqual([c.laterVersions.withoutValidActivation, c.integrity.unrecognizedActivationStatus, c.laterVersions.invalidFormalAct], [1, 1, 1])
  // Ausência legítima de vigente (original em cadastramento) NÃO é inconsistência.
  c = chain([['original', { registrationStatus: 'in-registration' }]])
  assert.deepEqual([c.current.none, c.current.inconsistent], [1, 0])
  assert.equal(dataAnomalies(c, false).total, 0)
})

test('INV-T19 — referências entre versões: circular, auto-referência, inexistente e somente v2', () => {
  let c = chain([['original', fin()], ['v2', ver(2, { 'origin.previousWorkPlanId': 'v3', 'activation.status': 'superseded' })], ['v3', ver(3)]])
  assert.equal(c.integrity.previousVersionNotEarlier, 1, 'v2 → v3 → v2 (ciclo)')
  c = chain([['original', fin()], ['v2', ver(2, { 'origin.previousWorkPlanId': 'v2' })]])
  assert.equal(c.integrity.previousVersionNotEarlier, 1, 'auto-referência')
  c = chain([['original', fin()], ['v2', ver(2, { 'origin.previousWorkPlanId': 'v7' })]])
  assert.deepEqual([c.integrity.previousVersionMissing, c.integrity.previousVersionNotEarlier], [1, 0])
  c = chain([['v2', ver(2)]])
  assert.deepEqual([c.partnerships.withoutOriginal, c.partnerships.withVersionsButWithoutOriginal, c.integrity.previousVersionMissing, c.current.determinedLater], [1, 1, 1, 1])
})

test('INV-T20 — metadados obrigatórios ausentes são anomalias, nunca valores presumidos', () => {
  const c = zeroCounters()
  classifyPartnership(c, 'o', 'p', [{ id: 'v2', data: {} }])
  assert.deepEqual(
    [c.integrity.sequenceMismatch, c.integrity.pathFieldMismatch, c.integrity.invalidRevision, c.integrity.unrecognizedRegistrationStatus, c.laterVersions.withoutValidActivation, c.laterVersions.invalidFormalAct, c.integrity.previousVersionMissing],
    [1, 1, 1, 1, 1, 1, 1],
  )
  assert.equal(c.laterVersions.awaitingFinalization, 0, 'situação desconhecida não é tratada como cadastramento')
  const bad = zeroCounters()
  classifyPartnership(bad, 'o', 'p', [{ id: 'original', data: { oscId: 'o', partnershipId: 'p', revision: 1, registrationStatus: 'finalized', correctionCount: -1 } }])
  assert.deepEqual([bad.integrity.invalidCorrectionCount, bad.corrections.correctionCountSum, bad.originals.finalizedWithoutFinalizedAt], [1, 0, 1])
})

test('INV-T21 — E7: substituição PERSISTIDA é contada mesmo quando a situação apresentada difere', () => {
  // v2 em cadastramento com 'superseded' gravado: o domínio apresenta "em cadastramento".
  const c = chain([['original', fin()], ['v2', ver(2, { registrationStatus: 'in-registration', 'activation.status': 'superseded' })]])
  assert.deepEqual([c.laterVersions.storedSuperseded, c.derived.superseded], [1, 0])
  // v2 finalizada sem ativação válida: apresentada como substituída pelo servidor, mas não gravada assim.
  const d = chain([['original', fin()], ['v2', ver(2, { 'activation.status': undefined })]])
  assert.deepEqual([d.laterVersions.storedSuperseded, d.derived.superseded], [0, 1])
})

// ------------------------------------------------------------------ saída sem dados identificáveis

test('INV-T07 — relatório (JSON e Markdown) sem identificadores técnicos nem e-mails', async () => {
  const t = tree()
  const { report, secrets } = await runInventory(memorySource(t))
  const json = JSON.stringify(report)
  const md = renderMarkdown(report)
  for (const id of allIds(t)) {
    assert.ok(!json.includes(id), 'JSON sem identificadores')
    assert.ok(!md.includes(id), 'Markdown sem identificadores')
  }
  assert.ok(assertAggregateOnly(report, md, secrets))
  assert.ok(secrets.includes(A) && secrets.includes('pAtiva000004'), 'identificadores mantidos só em memória para a verificação')
  // Qualquer texto fora do vocabulário é recusado (lista de permissões), inclusive identificadores.
  assert.throws(() => assertAggregateOnly({ ...report, project: A }, md, secrets), /report-unexpected-text/)
  assert.throws(() => assertAggregateOnly({ ...report, failures: [`events:${A}`] }, md, secrets), /report-unexpected-text/)
  assert.throws(() => assertAggregateOnly({ ...report, [A]: 1 }, md, secrets), /report-unexpected-key/)
  assert.throws(() => assertAggregateOnly(report, `${md}\n${A}`, secrets), /report-markdown-mismatch/)
  assert.throws(() => assertReportShape({ ...report, counts: { ...report.counts, contato: 'pessoa@exemplo.invalid' } }), /report-unexpected/)
})

test('INV-T22 — IDs curtos, numéricos, especiais e iguais a palavras do relatório: sem vazamento e sem falso positivo', async () => {
  const tricky = ['ab', 'x', '7', '2026', 'complete', 'status', 'update', 'osc.alfa+1', 'ação-ç', 'osc alfa', 'E1_notStructured', 'not-found']
  const t = tree({ partnershipIds: { [A]: tricky, [B]: [] } })
  for (const id of tricky) t[`oscs/${A}/partnerships/${id}/workPlans`] = [{ id: 'original', data: plan(A, id) }]
  const { report, secrets } = await runInventory(memorySource(t))
  assert.equal(report.status, 'complete')
  assert.equal(report.counts.partnerships.total, tricky.length)
  const md = renderMarkdown(report)
  assert.ok(assertAggregateOnly(report, md, secrets), 'relatório seguro não é bloqueado por falso positivo')
  for (const id of ['osc.alfa+1', 'ação-ç', 'osc alfa']) assert.ok(!JSON.stringify(report).includes(id) && !md.includes(id))
})

test('INV-T23 — códigos de erro seguros: mensagens e códigos textuais de terceiros nunca são propagados', async () => {
  assert.equal(safeErrorCode(Object.assign(new Error('x'), { code: 7 })), 'grpc-7')
  assert.equal(safeErrorCode(Object.assign(new Error('x'), { code: 99 })), 'unknown')
  assert.equal(safeErrorCode(new Error('pagination-stalled')), 'pagination-stalled')
  assert.equal(safeErrorCode(new Error('pAtiva000004')), 'unknown')
  assert.equal(safeErrorCode(Object.assign(new Error('pAtiva000004'), { code: 'pAtiva000004' })), 'unknown')
  assert.equal(safeErrorCode(new Error("When querying a collection, 'osc/x' contains a slash.")), 'unknown')
  const leaky = await runInventory(memorySource(tree(), { fail: (p) => (p.endsWith('/workPlans') ? Object.assign(new Error('pAtiva000004'), { code: 'pAtiva000004' }) : null) }))
  assert.deepEqual(leaky.report.failures, ['workPlans:unknown'])
  assert.ok(assertAggregateOnly(leaky.report, renderMarkdown(leaky.report), leaky.secrets))
})

test('INV-T24 — falha da classificação: seção não verificável, sem expor identificador', async () => {
  const t = tree()
  const hostile = {}
  Object.defineProperty(hostile, 'registrationStatus', { enumerable: true, get() { throw new Error('pFinal000003') } })
  t[`oscs/${A}/partnerships/pFinal000003/workPlans`] = [{ id: 'original', data: hostile }]
  const source = { async listPage(path, fields, pageSize, afterId) {
    if (path.endsWith('pFinal000003/workPlans')) return [{ id: 'original', data: hostile }]
    return memorySource(t).listPage(path, fields, pageSize, afterId)
  } }
  const { report, secrets } = await runInventory(source)
  assert.equal(report.status, 'partial')
  assert.deepEqual(report.failures, ['classification:unknown'])
  assert.equal(report.counts.originals.total, null)
  assert.ok(assertAggregateOnly(report, renderMarkdown(report), secrets))
})

// ------------------------------------------------------------------ configuração, projeto e emissão

const FEDERATED = JSON.stringify({
  type: 'external_account',
  audience: '//iam.googleapis.com/projects/0/locations/global/workloadIdentityPools/ficticio/providers/ficticio',
  service_account_impersonation_url: 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/inv-uxpt-01-reader@sigorsc-testes.iam.gserviceaccount.com:generateAccessToken',
})
const okEnv = { INV_UXPT_PROJECT: 'sigorsc-testes', INV_UXPT_SERVICE_ACCOUNT: 'inv-uxpt-01-reader@sigorsc-testes.iam.gserviceaccount.com', GOOGLE_APPLICATION_CREDENTIALS: '/ficticio/creds.json', GOOGLE_CLOUD_PROJECT: 'sigorsc-testes' }
const reader = (content) => () => content

test('INV-T09 — configuração: exige sigorsc-testes e credencial FEDERADA da conta esperada', () => {
  assert.deepEqual(validateConfig(okEnv, reader(FEDERATED)), { ok: true, projectId: 'sigorsc-testes', credentialsPath: '/ficticio/creds.json' })
  const reason = (env, content = FEDERATED) => validateConfig(env, reader(content)).reason
  assert.equal(reason({ ...okEnv, INV_UXPT_PROJECT: 'sigosc-producao' }), 'project-not-authorized')
  assert.equal(reason({ ...okEnv, INV_UXPT_PROJECT: undefined }), 'project-not-authorized')
  assert.equal(reason({ ...okEnv, GOOGLE_CLOUD_PROJECT: 'outro-projeto' }), 'conflicting-project-variable')
  assert.equal(reason({ ...okEnv, GCLOUD_PROJECT: 'outro-projeto' }), 'conflicting-project-variable')
  assert.equal(reason({ ...okEnv, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }), 'emulator-configured')
  assert.equal(reason({ ...okEnv, CLOUDSDK_AUTH_ACCESS_TOKEN: 'x' }), 'unexpected-token-variable')
  assert.equal(reason({ ...okEnv, INV_UXPT_SERVICE_ACCOUNT: undefined }), 'service-account-not-configured')
  assert.equal(reason({ ...okEnv, INV_UXPT_SERVICE_ACCOUNT: 'leitor@outro-projeto.iam.gserviceaccount.com' }), 'service-account-not-configured')
  assert.equal(reason({ ...okEnv, GOOGLE_APPLICATION_CREDENTIALS: undefined }), 'federated-credential-missing')
  assert.equal(validateConfig(okEnv, () => { throw new Error('ENOENT') }).reason, 'federated-credential-unreadable')
  assert.equal(reason(okEnv, JSON.stringify({ type: 'service_account' })), 'credential-not-federated')
  assert.equal(reason(okEnv, JSON.stringify({ type: 'authorized_user' })), 'credential-not-federated')
  assert.equal(reason(okEnv, JSON.stringify({ ...JSON.parse(FEDERATED), private_key: 'x' })), 'credential-not-federated')
  assert.equal(reason(okEnv, JSON.stringify({ ...JSON.parse(FEDERATED), service_account_impersonation_url: 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/outra@sigorsc-testes.iam.gserviceaccount.com:generateAccessToken' })), 'impersonation-mismatch')
  assert.equal(reason(okEnv, JSON.stringify({ type: 'external_account' })), 'impersonation-mismatch')
})

/** Executa `main` com conexão fictícia (nada de SDK, rede ou credenciais reais). */
async function runMain(out, source, extra = {}) {
  const logs = []
  const original = { log: console.log, error: console.error }
  console.log = (m) => logs.push(String(m))
  console.error = (m) => logs.push(String(m))
  try {
    let connected = 0
    const code = await main(['--out', out], extra.env ?? okEnv, { readFile: reader(FEDERATED), connect: async (projectId) => (assert.equal(projectId, 'sigorsc-testes'), connected++, source), ...extra.deps })
    return { code, logs, connected }
  } finally {
    console.log = original.log
    console.error = original.error
  }
}
const tempDir = () => mkdtempSync(join(tmpdir(), 'inv-uxpt-01-teste-'))

test('INV-T10 — execução recusada antes de qualquer conexão quando a configuração é inválida', async () => {
  const r1 = await runMain(join(tempDir(), 'out'), memorySource(tree()), { env: { ...okEnv, INV_UXPT_PROJECT: 'outro-projeto' } })
  const r2 = await runMain(join(tempDir(), 'out'), memorySource(tree()), { env: {} })
  assert.deepEqual([r1.code, r1.connected, r2.code, r2.connected], [3, 0, 3, 0])
  assert.deepEqual([...r1.logs, ...r2.logs], ['[INV-UXPT-01] execução recusada: project-not-authorized', '[INV-UXPT-01] execução recusada: project-not-authorized'])
})

test('INV-T25 — emissão: completo → código 0; parcial → código 4 com relatório marcado como parcial', async () => {
  const outOk = join(tempDir(), 'out')
  const ok = await runMain(outOk, memorySource(tree()))
  assert.equal(ok.code, 0)
  const json = JSON.parse(readFileSync(join(outOk, 'report.json'), 'utf8'))
  assert.equal(json.status, 'complete')
  assert.equal(readFileSync(join(outOk, 'report.md'), 'utf8'), `${renderMarkdown(json)}\n`)
  for (const id of allIds(tree())) assert.ok(!ok.logs.join('\n').includes(id), 'console sem identificadores')
  const outPartial = join(tempDir(), 'out')
  const partial = await runMain(outPartial, memorySource(tree(), { fail: (p) => (p.endsWith('/workPlanEvents') ? Object.assign(new Error('x'), { code: 14 }) : null) }))
  assert.equal(partial.code, 4)
  assert.equal(JSON.parse(readFileSync(join(outPartial, 'report.json'), 'utf8')).status, 'partial')
})

test('INV-T26 — falha na gravação do relatório não deixa resultado aparentemente completo', async () => {
  const out = tempDir()
  writeFileSync(join(out, 'report.md'), 'preexistente\n')
  await assert.rejects(runMain(out, memorySource(tree())), (error) => error.code === 'EEXIST')
  assert.equal(existsSync(join(out, 'report.json')), false, 'o JSON (resultado canônico) só é gravado por último')
  assert.equal(safeErrorCode(Object.assign(new Error('x'), { code: 'EEXIST' })), 'unknown')
})

// ------------------------------------------------------------------ ausência de escrita

const MODULES = ['classify.mjs', 'reader.mjs', 'uxpt-legacy-readonly.mjs']
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

test('INV-T11 — verificação estática: nenhum método de escrita do Firestore nos módulos do inventário', () => {
  const forbidden = /\.(set|update|delete|create|add|commit|runTransaction|batch|bulkWriter|recursiveDelete|importDocuments|exportDocuments|writeBatch)\s*\(|\b(runTransaction|bulkWriter|recursiveDelete|WriteBatch|FieldValue)\b/
  for (const sample of ['db.doc(p).set({})', 'ref.update({})', 'db.batch().commit()', 'db.runTransaction(f)', 'col.add({})', 'r.delete()', 'FieldValue.increment(1)']) assert.ok(forbidden.test(sample), `detecta: ${sample}`)
  for (const file of MODULES) {
    const code = stripComments(readFileSync(join(HERE, file), 'utf8'))
    const hit = code.split('\n').find((line) => forbidden.test(line))
    assert.equal(hit, undefined, `${file}: chamada de escrita proibida`)
  }
  for (const file of ['classify.mjs', 'reader.mjs']) assert.ok(!/from ['"](firebase-admin|@google-cloud|firebase)/.test(readFileSync(join(HERE, file), 'utf8')))
})

/** Banco fictício com a superfície do Admin SDK: leituras funcionam; QUALQUER escrita é registrada. */
function trappedDb(t) {
  const writes = []
  const trap = (name) => () => {
    writes.push(name)
    throw new Error(`escrita proibida: ${name}`)
  }
  const writeMethods = (obj) => {
    for (const m of ['set', 'update', 'delete', 'create', 'add', 'commit', 'batch', 'runTransaction', 'bulkWriter', 'recursiveDelete', 'doc']) obj[m] = trap(m)
    return obj
  }
  const query = (path, state) =>
    writeMethods({
      select: (...fields) => query(path, { ...state, fields }),
      orderBy: () => query(path, state),
      limit: (n) => query(path, { ...state, limit: n }),
      startAfter: (id) => query(path, { ...state, after: id }),
      get: async () => {
        const all = t[path] ?? []
        const start = state.after === undefined ? 0 : all.findIndex((d) => d.id > state.after)
        const docs = (start < 0 ? [] : all.slice(start, start + state.limit)).map((d) => ({ id: d.id, get: (f) => (state.fields.includes(f) ? d.data[f] : undefined) }))
        return { docs }
      },
    })
  const db = writeMethods({ collection: (path) => query(path, { fields: [], limit: Infinity }) })
  return { db, writes }
}

test('INV-T12 — execução com banco fictício: nenhuma chamada de escrita e mesmo resultado', async () => {
  const t = tree()
  const { db, writes } = trappedDb(t)
  const now = new Date('2026-11-24T00:00:00Z')
  const viaAdapter = await runInventory(firestoreSource(db, '__name__'), { pageSize: 3, now })
  const viaMemory = await runInventory(memorySource(t), { now })
  assert.deepEqual(writes, [])
  assert.deepEqual(viaAdapter.report, viaMemory.report)
  assert.equal(viaAdapter.report.status, 'complete')
})

// ------------------------------------------------------------------ workflow e disparo

const AUTH_V3 = 'google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093'

test('INV-T13 — workflow: só push em develop no arquivo de disparo; permissões mínimas; sem chaves', () => {
  const raw = readFileSync(join(ROOT, '.github', 'workflows', 'inv-uxpt-01.yml'), 'utf8')
  const wf = parseYaml(raw)
  assert.deepEqual(Object.keys(wf.on), ['push'])
  assert.deepEqual(wf.on.push, { branches: ['develop'], paths: ['ops/inventory/trigger.txt'] })
  assert.deepEqual(wf.permissions, { contents: 'read' })
  assert.deepEqual(wf.concurrency, { group: 'inv-uxpt-01', 'cancel-in-progress': false })
  assert.deepEqual(wf.jobs.guard.permissions, { contents: 'read' })
  assert.equal(wf.jobs.guard.environment, undefined, 'job de validação sem ambiente e sem id-token')
  assert.deepEqual(wf.jobs.inventory.permissions, { contents: 'read', 'id-token': 'write' })
  assert.deepEqual(wf.jobs.inventory.needs, 'guard')
  assert.equal(wf.jobs.inventory.environment, 'inv-uxpt-01')
  for (const job of Object.values(wf.jobs)) {
    assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 20)
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /@[0-9a-f]{40}$/, 'action fixada por SHA completo')
      if (step.uses?.startsWith('actions/checkout')) assert.equal(step.with['persist-credentials'], false)
    }
  }
  const guardScript = wf.jobs.guard.steps.map((s) => s.run ?? '').join('\n')
  for (const check of ['FORCED', 'refs/heads/develop', 'sigorsc-testes', 'INV_UXPT_ENABLED', 'INV_UXPT_WIF_PROVIDER', 'INV_UXPT_SERVICE_ACCOUNT', 'INV_UXPT_APPROVED_BASE_SHA', 'rev-list --parents', 'diff --name-only HEAD^ HEAD', '-L ops/inventory/trigger.txt']) {
    assert.ok(guardScript.includes(check), `guard verifica: ${check}`)
  }
  const steps = wf.jobs.inventory.steps
  const auth = steps.find((s) => s.uses?.startsWith('google-github-actions/auth'))
  assert.equal(auth.uses, AUTH_V3)
  assert.deepEqual(Object.keys(auth.with).sort(), ['create_credentials_file', 'export_environment_variables', 'project_id', 'service_account', 'workload_identity_provider'])
  assert.equal(auth.with.project_id, 'sigorsc-testes')
  // Antes da autenticação: testes offline (com o disparo esperado). Depois: só o script revisado.
  const authIndex = steps.indexOf(auth)
  assert.ok(steps.slice(0, authIndex).some((s) => s.run === 'node --test scripts/inventory/*.test.mjs' && s.env?.INV_UXPT_TRIGGER_RUN === 'true'))
  const after = steps.slice(authIndex + 1).map((s) => s.run ?? '').join('\n')
  assert.equal((after.match(/\bnode\b/g) ?? []).length, 1, 'uma única execução de node após autenticar')
  assert.ok(after.includes('node scripts/inventory/uxpt-legacy-readonly.mjs --out'))
  assert.ok(!/\b(npm|npx|yarn|pnpm|curl|wget|pip|gcloud|firebase|bash -c|eval|source)\b/.test(after))
  const upload = steps.find((s) => s.uses?.startsWith('actions/upload-artifact'))
  assert.equal(upload.with['retention-days'], 3)
  assert.equal(upload.if, "steps.inventory.outputs.emitted == 'true'")
  const result = steps.at(-1)
  assert.equal(result.if, 'always()')
  assert.match(result.run, /\[ "\$RC" = "0" \]/)
  const code = raw.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  assert.ok(!/credentials_json|private_key|secrets\.|workflow_dispatch|schedule|pull_request|vercel/i.test(code))
})

test('INV-T14 — arquivo de disparo: ausente na preparação; na execução real, presente e comum', () => {
  const trigger = join(ROOT, 'ops', 'inventory', 'trigger.txt')
  if (process.env.INV_UXPT_TRIGGER_RUN === 'true') {
    assert.ok(existsSync(trigger) && lstatSync(trigger).isFile() && !lstatSync(trigger).isSymbolicLink())
    assert.ok(lstatSync(trigger).size <= 1024)
  } else {
    assert.equal(existsSync(trigger), false)
  }
})

// ------------------------------------------------------------------ simulação local do acionamento (sem GitHub)

/** Filtro do gatilho: mesmo critério declarado em `on.push` (caminhos exatos, sem curingas). */
function triggers(wf, { event, branch, files }) {
  const push = wf.on.push
  return Object.keys(wf.on).includes(event) && event === 'push' && push.branches.includes(branch) && files.some((f) => push.paths.includes(f))
}

test('INV-T27 — simulação do filtro de acionamento (push comum, disparo, main, outro branch, outro evento)', () => {
  const wf = parseYaml(readFileSync(join(ROOT, '.github', 'workflows', 'inv-uxpt-01.yml'), 'utf8'))
  assert.equal(triggers(wf, { event: 'push', branch: 'develop', files: ['README.md', 'scripts/inventory/reader.mjs'] }), false, '1. push comum no develop')
  assert.equal(triggers(wf, { event: 'push', branch: 'develop', files: ['ops/inventory/trigger.txt'] }), true, '2. push somente do disparo')
  assert.equal(triggers(wf, { event: 'push', branch: 'main', files: ['ops/inventory/trigger.txt'] }), false, '3. push no main')
  assert.equal(triggers(wf, { event: 'push', branch: 'claude/outro', files: ['ops/inventory/trigger.txt'] }), false, '4. outro branch')
  for (const event of ['workflow_dispatch', 'pull_request', 'schedule']) assert.equal(triggers(wf, { event, branch: 'develop', files: ['ops/inventory/trigger.txt'] }), false, event)
})

/** Executa os scripts do job `guard` (extraídos do YAML) com bash, em repositório Git temporário. */
function guardScripts() {
  const wf = parseYaml(readFileSync(join(ROOT, '.github', 'workflows', 'inv-uxpt-01.yml'), 'utf8'))
  const runs = wf.jobs.guard.steps.filter((s) => s.run)
  assert.equal(runs.length, 2)
  return { context: runs[0], commit: runs[1] }
}
function bash(script, env, cwd) {
  return spawnSync('bash', ['-c', script], { cwd, env: { PATH: process.env.PATH, HOME: tmpdir(), ...env }, encoding: 'utf8' })
}
function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Teste Ficticio', '-c', 'user.email=teste@exemplo.invalid', ...args], { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim()
}
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'inv-uxpt-01-git-'))
  git(dir, 'init', '-q', '-b', 'develop')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'base revisada')
  return { dir, base: git(dir, 'rev-parse', 'HEAD') }
}
const writeTrigger = (dir, text = 'INV-UXPT-01 autorizado\n') => {
  mkdirSync(join(dir, 'ops', 'inventory'), { recursive: true })
  writeFileSync(join(dir, 'ops', 'inventory', 'trigger.txt'), text)
}
const CONTEXT_OK = {
  REPOSITORY: 'rodrigues01martins/sigosc2.0',
  REF: 'refs/heads/develop',
  EVENT: 'push',
  FORCED: 'false',
  ENABLED: 'true',
  PROJECT: 'sigorsc-testes',
  WIF_PROVIDER: 'projects/123456789/locations/global/workloadIdentityPools/github-inv-uxpt/providers/sigosc-develop',
  SERVICE_ACCOUNT: 'inv-uxpt-01-reader@sigorsc-testes.iam.gserviceaccount.com',
  APPROVED_BASE: 'a'.repeat(40),
}

test('INV-T28 — guard (contexto): push forçado, outro repositório/branch/evento e variáveis ausentes falham antes de autenticar', () => {
  const { context } = guardScripts()
  assert.equal(bash(context.run, CONTEXT_OK).status, 0, 'contexto válido')
  const cases = {
    '5. push forçado': { FORCED: 'true' },
    'outro repositório': { REPOSITORY: 'terceiro/sigosc2.0' },
    'outro branch': { REF: 'refs/heads/main' },
    'outro evento': { EVENT: 'workflow_dispatch' },
    '9. desabilitado': { ENABLED: '' },
    '9. projeto ausente': { PROJECT: '' },
    '9. projeto de produção': { PROJECT: 'sigosc-producao' },
    '9. provedor WIF ausente': { WIF_PROVIDER: '' },
    '9. conta de serviço ausente': { SERVICE_ACCOUNT: '' },
    'conta de outro projeto': { SERVICE_ACCOUNT: 'leitor@outro-projeto.iam.gserviceaccount.com' },
    '9. commit revisado ausente': { APPROVED_BASE: '' },
  }
  for (const [name, change] of Object.entries(cases)) {
    const r = bash(context.run, { ...CONTEXT_OK, ...change })
    assert.notEqual(r.status, 0, name)
    assert.match(r.stdout, /::error::/, `${name}: erro explícito`)
  }
})

test('INV-T29 — guard (commit): só o arquivo de disparo, sobre a base aprovada, sem merge e sem exclusão', () => {
  const { commit } = guardScripts()
  const check = (dir, approved) => bash(commit.run, { SHA: git(dir, 'rev-parse', 'HEAD'), APPROVED_BASE: approved }, dir)
  // 2. Disparo válido.
  let r = repo()
  writeTrigger(r.dir)
  git(r.dir, 'add', '.')
  git(r.dir, 'commit', '-q', '-m', 'disparo')
  assert.equal(check(r.dir, r.base).status, 0, 'disparo válido aceito')
  // 7. Pai diferente do SHA aprovado.
  assert.notEqual(check(r.dir, 'b'.repeat(40)).status, 0, 'pai diferente do aprovado')
  // 6. Disparo com múltiplos arquivos.
  r = repo()
  writeTrigger(r.dir)
  writeFileSync(join(r.dir, 'scripts.mjs'), 'console.log(1)\n')
  git(r.dir, 'add', '.')
  git(r.dir, 'commit', '-q', '-m', 'disparo com outro arquivo')
  assert.notEqual(check(r.dir, r.base).status, 0, 'múltiplos arquivos')
  // 8. Commit de merge.
  r = repo()
  git(r.dir, 'checkout', '-q', '-b', 'lateral')
  writeFileSync(join(r.dir, 'lateral.txt'), 'x\n')
  git(r.dir, 'add', '.')
  git(r.dir, 'commit', '-q', '-m', 'lateral')
  git(r.dir, 'checkout', '-q', 'develop')
  writeTrigger(r.dir)
  git(r.dir, 'add', '.')
  git(r.dir, 'commit', '-q', '-m', 'disparo')
  git(r.dir, 'merge', '-q', '--no-ff', '-m', 'merge', 'lateral')
  assert.notEqual(check(r.dir, git(r.dir, 'rev-parse', 'HEAD^1')).status, 0, 'merge')
  // Exclusão do arquivo de disparo (aciona o filtro, mas é recusada).
  r = repo()
  writeTrigger(r.dir)
  git(r.dir, 'add', '.')
  git(r.dir, 'commit', '-q', '-m', 'disparo')
  const triggerCommit = git(r.dir, 'rev-parse', 'HEAD')
  git(r.dir, 'rm', '-q', 'ops/inventory/trigger.txt')
  git(r.dir, 'commit', '-q', '-m', 'remove disparo')
  assert.notEqual(check(r.dir, triggerCommit).status, 0, 'exclusão do disparo')
  // Arquivo de disparo acima de 1 KB.
  r = repo()
  writeTrigger(r.dir, 'x'.repeat(2048))
  git(r.dir, 'add', '.')
  git(r.dir, 'commit', '-q', '-m', 'disparo grande')
  assert.notEqual(check(r.dir, r.base).status, 0, 'arquivo grande')
})
