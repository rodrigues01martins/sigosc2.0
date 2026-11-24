#!/usr/bin/env node
/**
 * INV-UXPT-01 — Inventário SOMENTE LEITURA dos estados legados do Plano de Trabalho.
 *
 * Executado EXCLUSIVAMENTE pelo workflow `.github/workflows/inv-uxpt-01.yml`, depois da autenticação
 * federada (Workload Identity Federation) feita por `google-github-actions/auth`. Procedimento e
 * salvaguardas: `docs/uxpt/INV-UXPT-01-procedimento.md`.
 *
 * Recusa executar (sem tentar nenhuma credencial alternativa) quando:
 *  - o projeto informado não é exatamente `sigorsc-testes`, ou outra variável aponta para outro projeto;
 *  - não há credencial FEDERADA (`external_account`) com impersonação da conta de serviço esperada;
 *  - há indício de emulador (os números não seriam do projeto);
 *  - variáveis obrigatórias estão ausentes.
 *
 * Saída: `report.json` e `report.md` (somente contagens) no diretório indicado por `--out`, e um
 * resumo agregado no console. Identificadores técnicos ficam apenas em memória.
 * Códigos de saída: ver `main` (0 completo; 4 emitido mas incompleto; 2 não emitido; 3 recusado).
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EXPECTED_PROJECT, assertAggregateOnly, firestoreSource, renderMarkdown, runInventory, safeErrorCode } from './reader.mjs'

const SERVICE_ACCOUNT_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@sigorsc-testes\.iam\.gserviceaccount\.com$/

/**
 * Validação da configuração ANTES de qualquer acesso à rede. `env` = variáveis de ambiente;
 * `readFile` injetável (testes). Retorna `{ ok: true, ... }` ou `{ ok: false, reason }` — o motivo
 * nunca contém valores das variáveis nem conteúdo de arquivos.
 */
export function validateConfig(env, readFile = (p) => readFileSync(p, 'utf8')) {
  if (env.INV_UXPT_PROJECT !== EXPECTED_PROJECT) return { ok: false, reason: 'project-not-authorized' }
  for (const name of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT', 'CLOUDSDK_PROJECT', 'GCP_PROJECT']) {
    if (env[name] !== undefined && env[name] !== '' && env[name] !== EXPECTED_PROJECT) return { ok: false, reason: 'conflicting-project-variable' }
  }
  for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_EMULATOR_HUB']) {
    if (env[name]) return { ok: false, reason: 'emulator-configured' }
  }
  // Somente a credencial federada criada pelo workflow; nenhuma alternativa automática.
  if (env.CLOUDSDK_AUTH_ACCESS_TOKEN || env.GOOGLE_OAUTH_ACCESS_TOKEN) return { ok: false, reason: 'unexpected-token-variable' }
  const serviceAccount = env.INV_UXPT_SERVICE_ACCOUNT
  if (!serviceAccount || !SERVICE_ACCOUNT_PATTERN.test(serviceAccount)) return { ok: false, reason: 'service-account-not-configured' }
  const credentialsPath = env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credentialsPath) return { ok: false, reason: 'federated-credential-missing' }
  let config
  try {
    config = JSON.parse(readFile(credentialsPath))
  } catch {
    return { ok: false, reason: 'federated-credential-unreadable' }
  }
  // Rejeita chave de conta de serviço, usuário autorizado e qualquer outro tipo.
  if (!config || config.type !== 'external_account') return { ok: false, reason: 'credential-not-federated' }
  if (config.private_key || config.refresh_token) return { ok: false, reason: 'credential-not-federated' }
  const impersonation = typeof config.service_account_impersonation_url === 'string' ? config.service_account_impersonation_url : ''
  if (!impersonation.endsWith(`/serviceAccounts/${serviceAccount}:generateAccessToken`)) return { ok: false, reason: 'impersonation-mismatch' }
  return { ok: true, projectId: EXPECTED_PROJECT, credentialsPath }
}

function argValue(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

/** Conexão real: carregada só depois da validação; credencial = SOMENTE o arquivo federado validado. */
async function connectFirestore(projectId) {
  const { initializeApp, applicationDefault } = await import('firebase-admin/app')
  const { getFirestore, FieldPath } = await import('firebase-admin/firestore')
  const app = initializeApp({ credential: applicationDefault(), projectId }, 'inv-uxpt-01-readonly')
  return firestoreSource(getFirestore(app), FieldPath.documentId())
}

/**
 * Códigos de saída: 0 = relatório emitido, consultas completas e aritmética consistente (anomalias nos
 * dados são ACHADOS, não falhas); 4 = relatório emitido, porém parcial/falho/inconsistente; 2 = nenhum
 * relatório emitido (erro ou vazamento detectado); 3 = configuração recusada (nenhum acesso feito).
 */
export async function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, 'utf8'))
  const connect = deps.connect ?? connectFirestore
  const config = validateConfig(env, readFile)
  if (!config.ok) {
    console.error(`[INV-UXPT-01] execução recusada: ${config.reason}`)
    return 3
  }
  const out = argValue(argv, '--out')
  if (!out) {
    console.error('[INV-UXPT-01] execução recusada: out-directory-missing')
    return 3
  }
  const source = await connect(config.projectId)
  const { report, secrets } = await runInventory(source, deps.inventoryOptions)
  const markdown = renderMarkdown(report)
  // Falha fechada: estrutura fora do vocabulário, identificador ou e-mail → nada é emitido.
  try {
    assertAggregateOnly(report, markdown, secrets)
  } finally {
    secrets.length = 0
  }
  const json = JSON.stringify(report, null, 2)
  const dir = resolve(out)
  mkdirSync(dir, { recursive: true })
  // Markdown primeiro; o JSON (resultado canônico) por último.
  writeFileSync(join(dir, 'report.md'), `${markdown}\n`, { flag: 'wx' })
  writeFileSync(join(dir, 'report.json'), `${json}\n`, { flag: 'wx' })
  console.log(markdown)
  return report.status === 'complete' && report.arithmeticConsistent === true ? 0 : 4
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      // Somente códigos seguros (gRPC numérico ou internos fixos); nunca mensagens de terceiros.
      console.error(`[INV-UXPT-01] falha: ${safeErrorCode(error)}`)
      process.exit(2)
    },
  )
}
