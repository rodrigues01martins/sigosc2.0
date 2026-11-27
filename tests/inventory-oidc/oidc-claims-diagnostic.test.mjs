/**
 * INV-PREP-02C — Testes OFFLINE do diagnóstico de declarações OIDC
 * (`node --test tests/inventory-oidc/oidc-claims-diagnostic.test.mjs`).
 *
 * Somente módulos nativos do Node e tokens FICTÍCIOS (sem assinatura válida): nenhum token real é
 * solicitado, nenhuma rede é usada e nenhuma credencial Google existe. Este arquivo também roda no job
 * de diagnóstico, antes da solicitação do token.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ATTRIBUTES, DIAGNOSTIC_AUDIENCE, ISSUER, assertSafeReport, buildReport, decodeClaims, evaluateClaims, main, renderMarkdown, requestToken, validateConfig } from '../../scripts/inventory/oidc-claims-diagnostic.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, '..', '..', 'scripts', 'inventory', 'oidc-claims-diagnostic.mjs')
const NOW = new Date('2026-11-27T12:00:00Z')
const NOW_S = Math.floor(NOW.getTime() / 1000)
const REPO_ID = '987654321'
const OWNER_ID = '123456789'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const VALID = {
  iss: ISSUER,
  aud: DIAGNOSTIC_AUDIENCE,
  sub: 'repo:rodrigues01martins/sigosc2.0:environment:inv-uxpt-01',
  repository: 'rodrigues01martins/sigosc2.0',
  repository_id: REPO_ID,
  repository_owner_id: OWNER_ID,
  ref: 'refs/heads/develop',
  event_name: 'push',
  workflow_ref: 'rodrigues01martins/sigosc2.0/.github/workflows/inv-uxpt-oidc-diagnostic.yml@refs/heads/develop',
  environment: 'inv-uxpt-01',
  iat: NOW_S - 30,
  exp: NOW_S + 270,
}
/** Token fictício: cabeçalho e assinatura falsos; segmentos longos e distinguíveis para o teste de vazamento. */
const fakeJwt = (claims = VALID) => `${b64({ alg: 'RS256', typ: 'JWT', kid: 'ficticio-0001' })}.${b64(claims)}.ASSINATURAficticiaNAOVALIDAabcdef0123456789`
const REQUEST_TOKEN = 'TOKENdeSOLICITACAOficticio-0123456789abcdef'
const ENV_OK = { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://emissor.exemplo.invalid/token?api-version=2.0', ACTIONS_ID_TOKEN_REQUEST_TOKEN: REQUEST_TOKEN, INV_UXPT_EXPECTED_REPOSITORY_ID: REPO_ID, INV_UXPT_EXPECTED_OWNER_ID: OWNER_ID }
const evalWith = (changes, opts = {}) => evaluateClaims({ ...VALID, ...changes }, { repositoryId: REPO_ID, ownerId: OWNER_ID, nowSeconds: NOW_S, ...opts })
const failsOnly = (r) => Object.entries(r).filter(([, v]) => v !== 'PASS').map(([k, v]) => `${k}:${v}`).sort()

/** fetch fictício: registra chamadas e devolve o token informado. Nada sai da máquina. */
function fakeFetch(jwt, { status = 200, body } = {}) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    return { status, json: async () => body ?? { value: jwt } }
  }
  fn.calls = calls
  return fn
}
async function runMain(env, fetchImpl) {
  const out = join(mkdtempSync(join(tmpdir(), 'oidc-diag-')), 'out')
  const logs = []
  const code = await main(['--out', out], env, { fetch: fetchImpl, now: NOW, log: (l) => logs.push(String(l)) })
  const files = existsSync(out) ? Object.fromEntries(readdirSync(out).map((f) => [f, readFileSync(join(out, f), 'utf8')])) : {}
  return { code, logs, files, out }
}

// ------------------------------------------------------------------ critérios dos atributos

test('OIDC-T01 — atributos esperados: todos PASS', () => {
  const r = evalWith({})
  assert.deepEqual(Object.keys(r).sort(), [...ATTRIBUTES].sort())
  assert.deepEqual(failsOnly(r), [])
  // `aud` como lista de um único público também é aceito.
  assert.deepEqual(failsOnly(evalWith({ aud: [DIAGNOSTIC_AUDIENCE] })), [])
})

test('OIDC-T02 — outro repositório é rejeitado (nome e IDs numéricos)', () => {
  assert.deepEqual(failsOnly(evalWith({ repository: 'terceiro/sigosc2.0', workflow_ref: 'terceiro/sigosc2.0/.github/workflows/inv-uxpt-oidc-diagnostic.yml@refs/heads/develop', sub: 'repo:terceiro/sigosc2.0:environment:inv-uxpt-01' })), ['repository:FAIL', 'sub:FAIL', 'workflow_ref:FAIL', 'workflow_ref_format:FAIL'])
  assert.deepEqual(failsOnly(evalWith({ repository_id: '111', repository_owner_id: '222' })), ['repository_id:FAIL', 'repository_owner_id:FAIL'])
  assert.deepEqual(failsOnly(evalWith({ repository_id: undefined })), ['repository_id:FAIL'])
})

test('OIDC-T03 — outro branch é rejeitado', () => {
  const r = evalWith({ ref: 'refs/heads/main', workflow_ref: 'rodrigues01martins/sigosc2.0/.github/workflows/inv-uxpt-oidc-diagnostic.yml@refs/heads/main' })
  assert.deepEqual(failsOnly(r), ['ref:FAIL', 'workflow_ref:FAIL', 'workflow_ref_format:FAIL'])
})

test('OIDC-T04 — outro ambiente (ou ausência de ambiente) é rejeitado, inclusive no sub', () => {
  assert.deepEqual(failsOnly(evalWith({ environment: 'producao', sub: 'repo:rodrigues01martins/sigosc2.0:environment:producao' })), ['environment:FAIL', 'sub:FAIL'])
  assert.deepEqual(failsOnly(evalWith({ environment: undefined, sub: 'repo:rodrigues01martins/sigosc2.0:ref:refs/heads/develop' })), ['environment:FAIL', 'sub:FAIL'])
})

test('OIDC-T05 — outro evento é rejeitado', () => {
  for (const event of ['workflow_dispatch', 'pull_request', 'schedule']) assert.deepEqual(failsOnly(evalWith({ event_name: event })), ['event_name:FAIL'], event)
})

test('OIDC-T06 — sub incorreto é detectado mesmo com os demais atributos corretos', () => {
  for (const sub of ['repo:rodrigues01martins/sigosc2.0:ref:refs/heads/develop', 'repo:rodrigues01martins/sigosc2.0:environment:INV-UXPT-01', 'repo:Rodrigues01martins/sigosc2.0:environment:inv-uxpt-01', '']) {
    assert.deepEqual(failsOnly(evalWith({ sub })), ['sub:FAIL'], sub)
  }
})

test('OIDC-T07 — workflow_ref divergente é detectado; o formato compatível com a condição WIF é conferido à parte', () => {
  // O workflow de inventário: formato compatível, mas não é este workflow.
  assert.deepEqual(failsOnly(evalWith({ workflow_ref: 'rodrigues01martins/sigosc2.0/.github/workflows/inv-uxpt-01.yml@refs/heads/develop' })), ['workflow_ref:FAIL'])
  assert.deepEqual(failsOnly(evalWith({ workflow_ref: 'rodrigues01martins/sigosc2.0/.github/workflows/outro.yml@refs/tags/v1' })), ['workflow_ref:FAIL', 'workflow_ref_format:FAIL'])
  assert.deepEqual(failsOnly(evalWith({ workflow_ref: undefined })), ['workflow_ref:FAIL', 'workflow_ref_format:FAIL'])
})

test('OIDC-T08 — validade temporal: expirado, emitido no futuro e vida útil excessiva são rejeitados', () => {
  assert.deepEqual(failsOnly(evalWith({ exp: NOW_S - 1 })), ['exp:FAIL'])
  assert.deepEqual(failsOnly(evalWith({ iat: NOW_S + 3600, exp: NOW_S + 3900 })), ['iat:FAIL'])
  assert.deepEqual(failsOnly(evalWith({ iat: NOW_S - 10, exp: NOW_S + 7200 })), ['exp:FAIL'])
  assert.deepEqual(failsOnly(evalWith({ exp: '9999999999' })), ['exp:FAIL', 'iat:FAIL'])
})

test('OIDC-T09 — emissor e público: outro emissor ou público do provedor WIF são rejeitados', () => {
  assert.deepEqual(failsOnly(evalWith({ iss: 'https://emissor.exemplo.invalid' })), ['iss:FAIL'])
  assert.deepEqual(failsOnly(evalWith({ aud: 'https://iam.googleapis.com/projects/0/locations/global/workloadIdentityPools/github-inv-uxpt/providers/sigosc-develop' })), ['aud:FAIL'])
  assert.deepEqual(failsOnly(evalWith({ aud: [DIAGNOSTIC_AUDIENCE, 'outro'] })), ['aud:FAIL'])
})

test('OIDC-T10 — IDs numéricos não configurados: NOT_VERIFIABLE (nunca presumidos)', () => {
  const r = evaluateClaims(VALID, { nowSeconds: NOW_S })
  assert.deepEqual(failsOnly(r), ['repository_id:NOT_VERIFIABLE', 'repository_owner_id:NOT_VERIFIABLE'])
  assert.equal(buildReport(r, { now: NOW }).result, 'INCOMPLETE')
})

test('OIDC-T11 — token malformado é recusado sem expor o conteúdo', () => {
  for (const bad of ['', 'a.b', 'a.b.c.d', 'cabeçalho.payload.sig', `x.${Buffer.from('não é json').toString('base64url')}.y`, `x.${b64([1, 2])}.y`, null]) {
    assert.throws(() => decodeClaims(bad), (e) => e.code === 'token-malformed' && !String(e.message).includes('payload'))
  }
  assert.deepEqual(decodeClaims(fakeJwt()).repository, 'rodrigues01martins/sigosc2.0')
})

// ------------------------------------------------------------------ execução, falha segura e vazamento

test('OIDC-T12 — execução completa com token fictício: PASS, público exclusivo e nenhuma rede externa', async () => {
  const fetchImpl = fakeFetch(fakeJwt())
  const { code, files } = await runMain(ENV_OK, fetchImpl)
  assert.equal(code, 0)
  assert.equal(fetchImpl.calls.length, 1)
  const url = new URL(fetchImpl.calls[0].url)
  assert.equal(url.hostname, 'emissor.exemplo.invalid', 'somente o emissor informado pelo runner')
  assert.equal(url.searchParams.get('audience'), DIAGNOSTIC_AUDIENCE)
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, `bearer ${REQUEST_TOKEN}`)
  const report = JSON.parse(files['oidc-diagnostic.json'])
  assert.equal(report.result, 'PASS')
  assert.equal(report.signatureVerified, false)
  assert.equal(report.googleCloudAcceptanceTested, false)
})

test('OIDC-T13 — ausência de vazamento: token, partes do token, token de solicitação e valores das declarações', async () => {
  const jwt = fakeJwt()
  for (const [env, claims] of [[ENV_OK, VALID], [ENV_OK, { ...VALID, repository: 'terceiro/repositorio-vazado' }]]) {
    const token = claims === VALID ? jwt : fakeJwt(claims)
    const { logs, files } = await runMain(env, fakeFetch(token))
    const everything = [...logs, ...Object.values(files)].join('\n')
    for (const secret of [token, ...token.split('.'), REQUEST_TOKEN, 'bearer', 'Authorization']) assert.ok(!everything.includes(secret), 'segredo ausente da saída')
    for (const value of [claims.repository, claims.sub, claims.workflow_ref, REPO_ID, OWNER_ID, String(claims.exp)]) assert.ok(!everything.includes(value), 'valores das declarações não são registrados')
  }
  const report = buildReport(evalWith({}), { now: NOW })
  const md = renderMarkdown(report)
  assert.ok(assertSafeReport(report, md, [jwt]))
  assert.throws(() => assertSafeReport({ ...report, error: jwt }, md, [jwt]), /report-unexpected-text/)
  assert.throws(() => assertSafeReport(report, `${md}\n${jwt.split('.')[1]}`, [jwt.split('.')[1]]), /report-markdown-mismatch/)
  assert.throws(() => assertSafeReport({ ...report, attributes: { ...report.attributes, sub: 'repo:x' } }, md, []), /report-unexpected-text/)
})

test('OIDC-T14 — falha segura sem token: nenhuma requisição, nenhum atributo aprovado, código 2', async () => {
  for (const env of [{}, { ACTIONS_ID_TOKEN_REQUEST_URL: ENV_OK.ACTIONS_ID_TOKEN_REQUEST_URL }, { ACTIONS_ID_TOKEN_REQUEST_TOKEN: REQUEST_TOKEN }, { ...ENV_OK, ACTIONS_ID_TOKEN_REQUEST_URL: 'http://emissor.exemplo.invalid/token' }]) {
    const fetchImpl = fakeFetch(fakeJwt())
    const { code, files } = await runMain(env, fetchImpl)
    assert.equal(code, 2)
    assert.equal(fetchImpl.calls.length, 0, 'sem requisição quando o token não está disponível')
    const report = JSON.parse(files['oidc-diagnostic.json'])
    assert.equal(report.error, 'token-unavailable')
    assert.ok(Object.values(report.attributes).every((v) => v === 'NOT_VERIFIABLE'))
  }
  for (const [fetchImpl, error] of [
    [fakeFetch('', { status: 403 }), 'token-request-failed'],
    [async () => { throw new Error(`falha de rede com ${REQUEST_TOKEN}`) }, 'token-request-failed'],
    [fakeFetch('', { body: { outra: 'coisa' } }), 'token-response-invalid'],
    [fakeFetch('nao-e-jwt'), 'token-malformed'],
  ]) {
    const { code, files, logs } = await runMain(ENV_OK, fetchImpl)
    assert.equal(code, 2)
    assert.equal(JSON.parse(files['oidc-diagnostic.json']).error, error)
    assert.ok(!logs.join('\n').includes(REQUEST_TOKEN))
  }
  await assert.rejects(requestToken({}, fakeFetch('x')), (e) => e.code === 'token-unavailable')
})

test('OIDC-T15 — isolamento do Google: execução recusada com qualquer credencial Google no ambiente', async () => {
  for (const name of ['GOOGLE_APPLICATION_CREDENTIALS', 'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE', 'GOOGLE_GHA_CREDS_PATH', 'CLOUDSDK_AUTH_ACCESS_TOKEN', 'GOOGLE_OAUTH_ACCESS_TOKEN']) {
    const fetchImpl = fakeFetch(fakeJwt())
    const { code, logs, files } = await runMain({ ...ENV_OK, [name]: '/caminho/ficticio.json' }, fetchImpl)
    assert.equal(code, 3, name)
    assert.equal(fetchImpl.calls.length, 0)
    assert.deepEqual(files, {})
    assert.deepEqual(logs, ['[INV-PREP-02C] execução recusada: google-credentials-present'])
  }
  assert.equal(validateConfig({ INV_UXPT_EXPECTED_REPOSITORY_ID: 'abc' }).reason, 'expected-id-invalid')
  assert.equal(validateConfig({ INV_UXPT_EXPECTED_OWNER_ID: '0123' }).reason, 'expected-id-invalid')
})

test('OIDC-T16 — código de saída: FAIL → 1; NOT_VERIFIABLE → 4', async () => {
  assert.equal((await runMain(ENV_OK, fakeFetch(fakeJwt({ ...VALID, environment: 'outro' })))).code, 1)
  const { INV_UXPT_EXPECTED_REPOSITORY_ID: _r, INV_UXPT_EXPECTED_OWNER_ID: _o, ...withoutIds } = ENV_OK
  assert.equal((await runMain(withoutIds, fakeFetch(fakeJwt()))).code, 4)
})

test('OIDC-T17 — verificação estática: sem Google, sem Firebase, sem escrita remota, sem impressão de segredos', () => {
  const code = readFileSync(SCRIPT, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.ok(!/googleapis|sts\.|iamcredentials|firestore|firebase|google-auth-library|google-github-actions|gcloud/i.test(code), 'nenhuma referência ao Google ou ao Firebase')
  assert.ok(!/\bimport\b[^;]*from ['"](?!node:)/.test(code), 'somente módulos nativos do Node')
  assert.equal((code.match(/fetchImpl\(/g) ?? []).length, 1, 'uma única requisição: ao emissor do GitHub')
  assert.ok(!/::add-mask::|console\.(log|error|info|debug)\(\s*(jwt|requestToken|claims|env)\b/.test(code))
  assert.ok(!/log\([^)]*\b(jwt|requestToken|claims)\b/.test(code), 'token e declarações nunca vão para o registro')
  assert.ok(!/writeFileSync\([^)]*\b(jwt|claims)\b/.test(code), 'token e declarações nunca são gravados')
})

test('OIDC-T18 — falha na gravação do relatório não deixa resultado aparentemente aprovado', async () => {
  const out = mkdtempSync(join(tmpdir(), 'oidc-diag-'))
  writeFileSync(join(out, 'oidc-diagnostic.md'), 'preexistente\n')
  await assert.rejects(main(['--out', out], ENV_OK, { fetch: fakeFetch(fakeJwt()), now: NOW, log: () => {} }), (e) => e.code === 'EEXIST')
  assert.equal(existsSync(join(out, 'oidc-diagnostic.json')), false)
})
