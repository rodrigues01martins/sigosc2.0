/**
 * Compatibilidade ESM/CommonJS do Firebase Admin SDK (DEV-01.3-FIX01).
 *
 * Cadeia: firebase-admin (CJS) → jwks-rsa@4 (CJS) → `require('jose')`, e o `jose@6`
 * é distribuído SOMENTE como ESM. Isso exige o recurso `require(esm)` do Node
 * (`process.features.require_module`). Quando o runtime não o oferece, o carregamento
 * falha com ERR_REQUIRE_ESM — erro observado no Preview da Vercel.
 *
 * Correção: antes de carregar o firebase-admin, importamos o `jose` como ESM (forma
 * nativa) a partir do MESMO arquivo que o jwks-rsa resolveria e registramos esse
 * módulo no `require.cache` — mecanismo documentado do Node ("adding or replacing
 * entries is also possible"). O `require('jose')` do jwks-rsa passa a receber o mesmo
 * objeto de módulo que o `require(esm)` devolveria. Não há alteração de versões, de
 * node_modules ou da verificação de tokens (mesmo código oficial do `jose`).
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

type CachedModule = { id: string; filename: string; loaded: boolean; exports: unknown }
type ModuleConstructor = new (id: string) => CachedModule

let prepared: Promise<void> | null = null

/**
 * Caminho do `jose` exatamente como resolvido a partir do jwks-rsa usado pelo firebase-admin.
 * Parte de `firebase-admin/auth` (que carrega o jwks-rsa) e não da entrada principal do
 * pacote: o empacotador da Vercel inclui apenas os arquivos efetivamente utilizados.
 */
export function resolveJoseForFirebaseAdmin(): string {
  const fromHere = createRequire(import.meta.url)
  const fromAdmin = createRequire(fromHere.resolve('firebase-admin/auth'))
  const fromJwks = createRequire(fromAdmin.resolve('jwks-rsa'))
  return fromJwks.resolve('jose')
}

/** Deve ser concluída ANTES de qualquer carregamento do firebase-admin. Idempotente. */
export function prepareFirebaseAdminRuntime(): Promise<void> {
  prepared ??= (async () => {
    const require = createRequire(import.meta.url)
    const josePath = resolveJoseForFirebaseAdmin()
    if (require.cache[josePath]) return
    const namespace: unknown = await import(pathToFileURL(josePath).href)
    const NodeModule = require('node:module') as ModuleConstructor
    const entry = new NodeModule(josePath)
    entry.filename = josePath
    entry.exports = namespace
    entry.loaded = true
    require.cache[josePath] = entry as unknown as NodeJS.Module
  })()
  return prepared
}
