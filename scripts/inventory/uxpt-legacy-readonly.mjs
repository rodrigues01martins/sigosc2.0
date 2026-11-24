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
 * Código de saída: 0 = completo e consistente; 2 = parcial/falha/inconsistente; 3 = configuração recusada.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EXPECTED_PROJECT, assertAggregateOnly, firestoreSource, renderMarkdown, runInventory } from './reader.mjs'

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

export async function main(argv = process.argv.slice(2), env = process.env) {
  const config = validateConfig(env)
  if (!config.ok) {
    console.error(`[INV-UXPT-01] execução recusada: ${config.reason}`)
    return 3
  }
  const out = argValue(argv, '--out')
  if (!out) {
    console.error('[INV-UXPT-01] execução recusada: out-directory-missing')
    return 3
  }
  // Carregado só depois da validação. Credencial: SOMENTE o arquivo federado validado acima.
  const { initializeApp, applicationDefault } = await import('firebase-admin/app')
  const { getFirestore, FieldPath } = await import('firebase-admin/firestore')
  const app = initializeApp({ credential: applicationDefault(), projectId: config.projectId }, 'inv-uxpt-01-readonly')
  const db = getFirestore(app)
  const { report, secrets } = await runInventory(firestoreSource(db, FieldPath.documentId()))
  const json = JSON.stringify(report, null, 2)
  const markdown = renderMarkdown(report)
  // Falha fechada: se houver qualquer identificador ou e-mail, nada é emitido.
  assertAggregateOnly(json, secrets)
  assertAggregateOnly(markdown, secrets)
  secrets.length = 0
  const dir = resolve(out)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'report.json'), `${json}\n`, { flag: 'wx' })
  writeFileSync(join(dir, 'report.md'), `${markdown}\n`, { flag: 'wx' })
  console.log(markdown)
  return report.status === 'complete' && report.totalsConsistent === true ? 0 : 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      // Sem detalhes que possam conter caminhos ou identificadores.
      console.error(`[INV-UXPT-01] falha: ${error && typeof error === 'object' && 'code' in error ? String(error.code) : error instanceof Error ? error.name : 'unknown'}`)
      process.exit(2)
    },
  )
}
