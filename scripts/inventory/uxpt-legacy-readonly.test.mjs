/**
 * INV-PREP-01 — Testes OFFLINE do inventário INV-UXPT-01 (`node --test scripts/inventory/*.test.mjs`).
 *
 * Somente dados FICTÍCIOS em memória: nenhum Firebase real, nenhum emulador, nenhuma rede.
 * Cobrem contagens E1–E15 (sobrepostas), consistência dos totais, paginação, falha segura,
 * ausência de identificadores na saída, rejeição de outro projeto e ausência de escrita.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { assertAggregateOnly, firestoreSource, readAll, renderMarkdown, runInventory } from './reader.mjs'
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

/** Árvore em memória: caminho da coleção → documentos. */
function tree() {
  const t = {}
  const put = (path, id, data) => ((t[path] ??= []).push({ id, data }), undefined)
  put('oscs', A, {})
  put('oscs', B, {})
  const parts = {
    [A]: ['pSemPlano0001', 'pCadastro0002', 'pFinal000003', 'pAtiva000004', 'pAguarda0005', 'pPendente006', 'pInconsist07', 'pInvalida008'],
    [B]: ['pOutraOsc009', 'pSomenteV2010'],
  }
  for (const [osc, ids] of Object.entries(parts)) for (const id of ids) put(`oscs/${osc}/partnerships`, id, {})
  const wp = (osc, p) => `oscs/${osc}/partnerships/${p}/workPlans`
  put(wp(A, 'pCadastro0002'), 'original', plan(A, 'pCadastro0002', { registrationStatus: 'in-registration', finalizedAt: undefined }))
  put(wp(A, 'pFinal000003'), 'original', plan(A, 'pFinal000003', { 'complementaryTranscription.status': 'open', 'financialTranscription.status': 'closed' }))
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
  const ev = (osc, action, n = 1) => {
    for (let i = 0; i < n; i++) put(`oscs/${osc}/workPlanEvents`, `${osc}-ev-${action ?? 'sem'}-${i}-${Math.random().toString(36).slice(2, 8)}`, action === undefined ? {} : { action })
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

/** Fonte de leitura fictícia com paginação por cursor (igual ao contrato do adaptador). */
function memorySource(t, { fail = () => null, ignoreCursor = () => false } = {}) {
  const calls = []
  return {
    calls,
    async listPage(path, fields, pageSize, afterId) {
      calls.push({ path, fields, pageSize })
      const error = fail(path)
      if (error) throw error
      const all = t[path] ?? []
      const start = afterId === null || ignoreCursor(path) ? 0 : all.findIndex((d) => d.id > afterId)
      const page = start < 0 ? [] : all.slice(start, start + pageSize)
      return page.map((d) => ({ id: d.id, data: Object.fromEntries(fields.map((f) => [f, d.data[f]])) }))
    },
  }
}
const allIds = (t) => Object.values(t).flatMap((l) => l.map((d) => d.id)).filter((id) => !/^(original|v\d+)$/.test(id))

const EXPECTED_STATES = {
  E1_notStructured: 2,
  E2_inRegistration: 2,
  E3_finalized: 12,
  E4_original: 8,
  E5_laterVersions: 7,
  E6_partnershipsWithCurrent: 6,
  E7_superseded: 5,
  E8_awaitingFinalization: 1,
  E9a_pendingDecisionFinalized: 1,
  E9b_withoutValidActivation: 1,
  E9c_inconsistentChains: 1,
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
  assert.equal(report.totalsConsistent, true)
  assert.deepEqual(report.totalsIssues, [])
  assert.deepEqual(Object.fromEntries(Object.entries(report.states).map(([k, v]) => [k, v.value])), EXPECTED_STATES)
  const c = report.counts
  assert.equal(c.oscs, 2)
  assert.deepEqual(c.partnerships, { total: 10, withoutOriginal: 2, withVersionsButWithoutOriginal: 1 })
  assert.deepEqual(c.originals, { total: 8, inRegistration: 1, finalized: 6, unknownRegistration: 1, finalizedWithoutFinalizedAt: 1, storedSuperseded: 2, unrecognizedActivationIgnored: 1 })
  assert.deepEqual(c.laterVersions, {
    total: 7,
    inRegistration: 1,
    finalized: 6,
    unknownRegistration: 0,
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
  assert.deepEqual(c.current, { determinedOriginal: 4, determinedLater: 2, none: 2, inconsistent: 1, multipleActive: 1 })
  assert.deepEqual(c.derived, { superseded: 5, legacyPending: 1 })
  assert.deepEqual(c.transcriptions, { complementaryOpen: 1, complementaryClosed: 1, complementaryUnknown: 1, financialOpen: 1, financialClosed: 1, financialUnknown: 0 })
  assert.deepEqual(c.integrity, {
    invalidVersionId: 1,
    sequenceMismatch: 0,
    pathFieldMismatch: 1,
    previousVersionMissing: 2,
    invalidRevision: 1,
    unrecognizedRegistrationStatus: 1,
    unrecognizedActivationStatus: 1,
    unrecognizedTranscriptionStatus: 1,
  })
  assert.equal(c.events.total, 15)
  assert.equal(c.events.byAction['material-correction'], 2)
  assert.equal(c.events.byAction['version-created'], 2)
  assert.equal(c.events.byAction['version-activated'], 1)
  assert.equal(c.events.byAction.finalize, 1)
  assert.equal(c.events.otherKnownFormat, 1)
  assert.equal(c.events.withoutValidAction, 1)
  // Sobreposição: a mesma versão conta em mais de um estado (E3 + E7 + E11 em pAtiva/v2 e original).
  assert.ok(EXPECTED_STATES.E3_finalized + EXPECTED_STATES.E2_inRegistration > c.partnerships.total)
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
  const failing = await runInventory(memorySource(tree(), { fail: (p) => (p.endsWith('/workPlanEvents') ? Object.assign(new Error('x'), { code: 7 }) : null) }))
  assert.equal(failing.report.states.E14_materialCorrections.finding, 'not-verifiable')
  assert.equal(failing.report.states.E14_materialCorrections.value, null)
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
  assert.equal(report.sections.events, 'not-verifiable')
  assert.equal(report.counts.events.total, null)
  assert.equal(report.totalsConsistent, null)
  assert.deepEqual(report.failures, ['events:pagination-stalled'])
  // A seção de versões continua íntegra e completa.
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
  assert.deepEqual(partial.report.failures, ['workPlans:7'])
  const failed = await runInventory(memorySource(tree(), { fail: (p) => (p === 'oscs' ? denied : null) }))
  assert.equal(failed.report.status, 'failed')
  assert.equal(failed.report.counts.oscs, null)
  assert.ok(Object.values(failed.report.states).every((s) => s.value === null && s.finding === 'not-verifiable'))
  // A mensagem do erro (que poderia conter caminho/identificador) nunca chega ao relatório.
  assert.doesNotThrow(() => assertAggregateOnly(JSON.stringify(failed.report), ['osc-ficticia-aaa']))
})

test('INV-T06 — página malformada ou acima do tamanho pedido é recusada', async () => {
  const bad = { listPage: async () => [{ id: 'x' }] }
  await assert.rejects(readAll(bad, 'oscs', [], 'oscs', 10), /pagination-invalid/)
  const tooBig = { listPage: async () => [{ id: 'a', data: {} }, { id: 'b', data: {} }, { id: 'c', data: {} }] }
  await assert.rejects(readAll(tooBig, 'oscs', [], 'oscs', 2), /pagination-invalid/)
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
  assert.ok(assertAggregateOnly(json, secrets))
  assert.ok(assertAggregateOnly(md, secrets))
  assert.ok(secrets.includes(A) && secrets.includes('pAtiva000004'), 'identificadores mantidos só em memória para a verificação')
  assert.throws(() => assertAggregateOnly(`${json}${A}`, secrets), /report-contains-identifier/)
  assert.throws(() => assertAggregateOnly('contato: pessoa@exemplo.invalid', []), /report-contains-email/)
})

test('INV-T08 — somente os campos necessários são projetados (sem conteúdo do Plano)', async () => {
  const source = memorySource(tree())
  await runInventory(source)
  const fields = new Set(source.calls.flatMap((c) => c.fields))
  for (const forbidden of ['values', 'formalAct.description', 'formalAct.reference', 'createdBy', 'updatedBy', 'finalizedBy', 'formalAct.declaredBy', 'actorUid', 'corrections', 'justification']) {
    assert.ok(!fields.has(forbidden), `campo ${forbidden} não é lido`)
  }
  assert.ok(source.calls.filter((c) => c.path === 'oscs' || c.path.endsWith('/partnerships')).every((c) => c.fields.length === 0))
  assert.ok(source.calls.filter((c) => c.path.endsWith('/workPlanEvents')).every((c) => c.fields.join() === 'action'))
})

// ------------------------------------------------------------------ configuração e projeto

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

test('INV-T10 — execução recusada antes de qualquer acesso quando a configuração é inválida', async () => {
  const errors = []
  const original = console.error
  console.error = (m) => errors.push(String(m))
  try {
    assert.equal(await main(['--out', '/nao-usado'], { INV_UXPT_PROJECT: 'outro-projeto' }), 3)
    assert.equal(await main(['--out', '/nao-usado'], {}), 3)
  } finally {
    console.error = original
  }
  assert.deepEqual(errors, ['[INV-UXPT-01] execução recusada: project-not-authorized', '[INV-UXPT-01] execução recusada: project-not-authorized'])
})

// ------------------------------------------------------------------ ausência de escrita

const MODULES = ['classify.mjs', 'reader.mjs', 'uxpt-legacy-readonly.mjs']
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

test('INV-T11 — verificação estática: nenhum método de escrita do Firestore nos módulos do inventário', () => {
  const forbidden = /\.(set|update|delete|create|add|commit|runTransaction|batch|bulkWriter|recursiveDelete|importDocuments|exportDocuments|writeBatch)\s*\(|\b(runTransaction|bulkWriter|recursiveDelete|WriteBatch|FieldValue)\b/
  for (const file of MODULES) {
    const code = stripComments(readFileSync(join(HERE, file), 'utf8'))
    const hit = code.split('\n').find((line) => forbidden.test(line))
    assert.equal(hit, undefined, `${file}: chamada de escrita proibida`)
  }
  // Classificação e leitura não dependem de SDK algum (testáveis offline).
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

test('INV-T13 — workflow: só push em develop no arquivo de disparo; permissões mínimas; sem chaves', () => {
  const raw = readFileSync(join(ROOT, '.github', 'workflows', 'inv-uxpt-01.yml'), 'utf8')
  const wf = parseYaml(raw)
  assert.deepEqual(Object.keys(wf.on), ['push'])
  assert.deepEqual(wf.on.push, { branches: ['develop'], paths: ['ops/inventory/trigger.txt'] })
  assert.deepEqual(wf.permissions, { contents: 'read' })
  assert.equal(wf.concurrency['cancel-in-progress'], false)
  assert.deepEqual(wf.jobs.guard.permissions, { contents: 'read' })
  assert.deepEqual(wf.jobs.inventory.permissions, { contents: 'read', 'id-token': 'write' })
  assert.deepEqual(wf.jobs.inventory.needs, 'guard')
  assert.equal(wf.jobs.inventory.environment, 'inv-uxpt-01')
  for (const job of Object.values(wf.jobs)) {
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /@[0-9a-f]{40}$/, 'action fixada por SHA completo')
      if (step.uses?.startsWith('actions/checkout')) assert.equal(step.with['persist-credentials'], false)
    }
  }
  const auth = wf.jobs.inventory.steps.find((s) => s.uses?.startsWith('google-github-actions/auth'))
  assert.deepEqual(Object.keys(auth.with).sort(), ['create_credentials_file', 'export_environment_variables', 'project_id', 'service_account', 'workload_identity_provider'])
  assert.equal(auth.with.project_id, 'sigorsc-testes')
  // Testes offline e validações vêm ANTES da autenticação; depois dela, só o script revisado.
  const steps = wf.jobs.inventory.steps
  const authIndex = steps.indexOf(auth)
  assert.ok(steps.slice(authIndex + 1).every((s) => !s.run || /^node scripts\/inventory\/uxpt-legacy-readonly\.mjs|^set -euo pipefail\n\[ "\$\(ls -1/.test(s.run)))
  const code = raw.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  assert.ok(!/credentials_json|private_key|secrets\.|workflow_dispatch|schedule|pull_request|vercel/i.test(code))
  assert.equal(wf.jobs.inventory.steps.find((s) => s.uses?.startsWith('actions/upload-artifact')).with['retention-days'], 3)
})

test('INV-T14 — o arquivo de disparo NÃO existe nesta preparação', () => {
  assert.equal(existsSync(join(ROOT, 'ops', 'inventory', 'trigger.txt')), false)
})
