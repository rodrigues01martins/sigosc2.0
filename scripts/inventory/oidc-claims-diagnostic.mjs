#!/usr/bin/env node
/**
 * INV-PREP-02C — Diagnóstico ISOLADO das declarações (claims) do token OIDC do GitHub Actions.
 *
 * Executado somente pelo workflow `.github/workflows/inv-uxpt-oidc-diagnostic.yml`, no job que usa o
 * ambiente protegido `inv-uxpt-01`. Procedimento: `docs/uxpt/INV-PREP-02C-diagnostico.md`.
 *
 * O que faz: solicita UM token OIDC ao próprio GitHub (ACTIONS_ID_TOKEN_REQUEST_URL), com um público
 * (`aud`) EXCLUSIVO de diagnóstico, decodifica as declarações EM MEMÓRIA e as compara com os valores
 * esperados, registrando apenas PASS / FAIL / NOT_VERIFIABLE por atributo.
 *
 * O que NÃO faz: não chama o Google (STS, IAM Credentials, Firestore), não usa credenciais Google, não
 * valida assinatura (a decodificação local NÃO é validação criptográfica), não imprime nem grava o token,
 * o token de solicitação, o cabeçalho Authorization nem valores de declarações. O público de diagnóstico
 * difere do público aceito pelo provedor WIF, de modo que o token não serve para autenticar no Google.
 *
 * Códigos de saída: 0 = todos PASS; 1 = algum FAIL; 4 = nenhum FAIL, mas algum NOT_VERIFIABLE;
 * 2 = token indisponível ou inválido (nenhum atributo verificado); 3 = configuração recusada.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const ISSUER = 'https://token.actions.githubusercontent.com'
/** Público EXCLUSIVO do diagnóstico: não é o público do provedor WIF (o token não é aceito pelo Google). */
export const DIAGNOSTIC_AUDIENCE = 'sigosc-inv-uxpt-oidc-diagnostic'
export const EXPECTED = Object.freeze({
  repository: 'rodrigues01martins/sigosc2.0',
  ref: 'refs/heads/develop',
  event_name: 'push',
  environment: 'inv-uxpt-01',
  workflow_file: 'inv-uxpt-oidc-diagnostic.yml',
  inventory_workflow_file: 'inv-uxpt-01.yml',
})
export const ATTRIBUTES = Object.freeze(['iss', 'aud', 'repository', 'repository_id', 'repository_owner_id', 'ref', 'event_name', 'workflow_ref', 'workflow_ref_format', 'environment', 'sub', 'exp', 'iat'])
const MAX_CLOCK_SKEW_SECONDS = 60
const MAX_LIFETIME_SECONDS = 60 * 60
const NUMERIC_ID = /^[1-9][0-9]{0,19}$/
/** Variáveis que indicariam credenciais Google no ambiente: o diagnóstico recusa executar com elas. */
const GOOGLE_CREDENTIAL_VARIABLES = ['GOOGLE_APPLICATION_CREDENTIALS', 'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE', 'GOOGLE_GHA_CREDS_PATH', 'CLOUDSDK_AUTH_ACCESS_TOKEN', 'GOOGLE_OAUTH_ACCESS_TOKEN']

export class DiagnosticError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

const expectedSub = () => `repo:${EXPECTED.repository}:environment:${EXPECTED.environment}`
const expectedWorkflowRef = (file) => `${EXPECTED.repository}/.github/workflows/${file}@${EXPECTED.ref}`

// ------------------------------------------------------------------ lógica pura

/** Decodifica as declarações (payload) de um JWT, sem validar assinatura. Erros nunca contêm o token. */
export function decodeClaims(jwt) {
  if (typeof jwt !== 'string') throw new DiagnosticError('token-malformed')
  const parts = jwt.split('.')
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) throw new DiagnosticError('token-malformed')
  let claims
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    throw new DiagnosticError('token-malformed')
  }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) throw new DiagnosticError('token-malformed')
  return claims
}

/**
 * Compara as declarações com o esperado. `expectedIds` = IDs numéricos configurados administrativamente
 * (os MESMOS usados na condição WIF); ausentes → NOT_VERIFIABLE (nunca presumidos).
 */
export function evaluateClaims(claims, { audience = DIAGNOSTIC_AUDIENCE, repositoryId = null, ownerId = null, nowSeconds }) {
  const r = {}
  const eq = (actual, expected) => (actual === expected ? 'PASS' : 'FAIL')
  r.iss = eq(claims.iss, ISSUER)
  // `aud` pode ser texto ou lista; exige exatamente o público solicitado.
  r.aud = Array.isArray(claims.aud) ? (claims.aud.length === 1 && claims.aud[0] === audience ? 'PASS' : 'FAIL') : eq(claims.aud, audience)
  r.repository = eq(claims.repository, EXPECTED.repository)
  r.repository_id = repositoryId === null ? 'NOT_VERIFIABLE' : eq(String(claims.repository_id ?? ''), repositoryId)
  r.repository_owner_id = ownerId === null ? 'NOT_VERIFIABLE' : eq(String(claims.repository_owner_id ?? ''), ownerId)
  r.ref = eq(claims.ref, EXPECTED.ref)
  r.event_name = eq(claims.event_name, EXPECTED.event_name)
  r.workflow_ref = eq(claims.workflow_ref, expectedWorkflowRef(EXPECTED.workflow_file))
  // Formato usado pela condição WIF do inventário: mesmo repositório e branch, arquivo em .github/workflows.
  const format = new RegExp(`^${EXPECTED.repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.github/workflows/[A-Za-z0-9._-]+\\.ya?ml@${EXPECTED.ref.replace(/\//g, '\\/')}$`)
  r.workflow_ref_format = typeof claims.workflow_ref === 'string' && format.test(claims.workflow_ref) ? 'PASS' : 'FAIL'
  r.environment = eq(claims.environment, EXPECTED.environment)
  r.sub = eq(claims.sub, expectedSub())
  const exp = claims.exp
  const iat = claims.iat
  const validNumbers = Number.isSafeInteger(exp) && Number.isSafeInteger(iat)
  r.exp = validNumbers && exp > nowSeconds && exp > iat && exp - iat <= MAX_LIFETIME_SECONDS ? 'PASS' : 'FAIL'
  r.iat = validNumbers && iat <= nowSeconds + MAX_CLOCK_SKEW_SECONDS ? 'PASS' : 'FAIL'
  return r
}

export function overallOf(results) {
  const values = Object.values(results)
  if (values.includes('FAIL')) return 'FAIL'
  if (values.includes('NOT_VERIFIABLE')) return 'INCOMPLETE'
  return 'PASS'
}

export function buildReport(results, { now, error = null }) {
  const attributes = Object.fromEntries(ATTRIBUTES.map((a) => [a, results ? results[a] : 'NOT_VERIFIABLE']))
  return {
    diagnostic: 'INV-PREP-02C',
    generatedAt: now.toISOString(),
    result: error ? 'NOT_VERIFIABLE' : overallOf(attributes),
    error: error ?? 'none',
    signatureVerified: false,
    googleCloudAcceptanceTested: false,
    attributes,
  }
}

const VOCABULARY = new Set(['INV-PREP-02C', 'PASS', 'FAIL', 'NOT_VERIFIABLE', 'INCOMPLETE', 'none', 'token-unavailable', 'token-request-failed', 'token-response-invalid', 'token-malformed', 'unknown', 'diagnostic', 'generatedAt', 'result', 'error', 'signatureVerified', 'googleCloudAcceptanceTested', 'attributes', ...ATTRIBUTES])

/**
 * Falha fechada: o relatório só pode conter o vocabulário fixo, data ISO, booleanos; o Markdown deve ser
 * o derivado do relatório; e nenhum segredo (token, partes do token, token de solicitação) pode aparecer.
 */
export function assertSafeReport(report, markdown, secrets) {
  const walk = (v, key) => {
    if (key !== null && !VOCABULARY.has(key)) throw new Error('report-unexpected-key')
    if (typeof v === 'boolean') return
    if (typeof v === 'string') {
      if (VOCABULARY.has(v) || (key === 'generatedAt' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v))) return
      throw new Error('report-unexpected-text')
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) return Object.entries(v).forEach(([k, x]) => walk(x, k))
    throw new Error('report-unexpected-value')
  }
  walk(report, null)
  if (markdown !== renderMarkdown(report)) throw new Error('report-markdown-mismatch')
  const text = `${JSON.stringify(report)}\n${markdown}`
  for (const s of secrets) if (typeof s === 'string' && s.length >= 8 && text.includes(s)) throw new Error('report-contains-secret')
  return true
}

export function renderMarkdown(r) {
  const lines = [
    '# INV-PREP-02C — Diagnóstico das declarações OIDC',
    '',
    `- Gerado em (UTC): ${r.generatedAt}`,
    `- Resultado das declarações: ${r.result}`,
    `- Erro: ${r.error}`,
    '- Assinatura verificada criptograficamente: não (decodificação local)',
    '- Aceitação pelo Google Cloud testada: não (fora do escopo)',
    '',
    '| Atributo | Situação |',
    '| --- | --- |',
    ...ATTRIBUTES.map((a) => `| ${a} | ${r.attributes[a]} |`),
  ]
  return lines.join('\n')
}

// ------------------------------------------------------------------ entrada e saída

/**
 * Configuração: recusa executar com credenciais Google no ambiente (isolamento) e valida os IDs
 * numéricos opcionais. Nunca devolve valores de variáveis nos motivos.
 */
export function validateConfig(env) {
  for (const name of GOOGLE_CREDENTIAL_VARIABLES) if (env[name]) return { ok: false, reason: 'google-credentials-present' }
  const repositoryId = env.INV_UXPT_EXPECTED_REPOSITORY_ID || null
  const ownerId = env.INV_UXPT_EXPECTED_OWNER_ID || null
  if ((repositoryId !== null && !NUMERIC_ID.test(repositoryId)) || (ownerId !== null && !NUMERIC_ID.test(ownerId))) return { ok: false, reason: 'expected-id-invalid' }
  return { ok: true, repositoryId, ownerId }
}

/** Solicita o token ao emissor do GitHub. Sem as variáveis do runner: falha segura, sem requisição. */
export async function requestToken(env, fetchImpl) {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (!url || !requestToken) throw new DiagnosticError('token-unavailable')
  let target
  try {
    target = new URL(url)
  } catch {
    throw new DiagnosticError('token-unavailable')
  }
  if (target.protocol !== 'https:') throw new DiagnosticError('token-unavailable')
  target.searchParams.set('audience', DIAGNOSTIC_AUDIENCE)
  let response
  try {
    response = await fetchImpl(target.toString(), { headers: { Authorization: `bearer ${requestToken}`, Accept: 'application/json; api-version=2.0' } })
  } catch {
    throw new DiagnosticError('token-request-failed')
  }
  if (!response || response.status !== 200) throw new DiagnosticError('token-request-failed')
  let body
  try {
    body = await response.json()
  } catch {
    throw new DiagnosticError('token-response-invalid')
  }
  if (!body || typeof body.value !== 'string' || body.value === '') throw new DiagnosticError('token-response-invalid')
  return body.value
}

const argValue = (argv, name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

/** `deps`: `fetch`, `now` e `log` injetáveis (testes offline). */
export async function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch
  const now = deps.now ?? new Date()
  const log = deps.log ?? ((line) => process.stdout.write(`${line}\n`))
  const config = validateConfig(env)
  if (!config.ok) {
    log(`[INV-PREP-02C] execução recusada: ${config.reason}`)
    return 3
  }
  const out = argValue(argv, '--out')
  if (!out) {
    log('[INV-PREP-02C] execução recusada: out-directory-missing')
    return 3
  }
  const secrets = [env.ACTIONS_ID_TOKEN_REQUEST_TOKEN].filter(Boolean)
  let report
  try {
    const jwt = await requestToken(env, fetchImpl)
    secrets.push(jwt, ...jwt.split('.'))
    const claims = decodeClaims(jwt)
    report = buildReport(evaluateClaims(claims, { repositoryId: config.repositoryId, ownerId: config.ownerId, nowSeconds: Math.floor(now.getTime() / 1000) }), { now })
  } catch (error) {
    report = buildReport(null, { now, error: error instanceof DiagnosticError ? error.code : 'unknown' })
  }
  const markdown = renderMarkdown(report)
  try {
    assertSafeReport(report, markdown, secrets)
  } finally {
    secrets.length = 0
  }
  const dir = resolve(out)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'oidc-diagnostic.md'), `${markdown}\n`, { flag: 'wx' })
  writeFileSync(join(dir, 'oidc-diagnostic.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
  log(markdown)
  if (report.error !== 'none') return 2
  return report.result === 'PASS' ? 0 : report.result === 'FAIL' ? 1 : 4
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`[INV-PREP-02C] falha: ${error instanceof DiagnosticError ? error.code : 'unknown'}\n`)
      process.exit(2)
    },
  )
}
