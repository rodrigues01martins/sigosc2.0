/**
 * DEV-01.3-FIX01 — Regressão ERR_REQUIRE_ESM (firebase-admin → jwks-rsa → jose ESM).
 *
 * Executa a função de servidor num processo Node com `require(esm)` DESATIVADO
 * (`--no-experimental-require-module`), reproduzindo o runtime em que o Preview
 * da Vercel falhou. Não acessa a nuvem; não usa credenciais.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const API = new URL('../../api/osc-permissions.ts', import.meta.url).href
const INTEROP = new URL('../../api/_lib/esmInterop.ts', import.meta.url).href

async function node(code: string, env: Record<string, string> = {}) {
  const { stdout } = await run(process.execPath, ['--no-experimental-require-module', '--no-warnings', '--input-type=module', '-e', code], {
    env: { PATH: process.env.PATH ?? '', ...env },
    cwd: new URL('../..', import.meta.url).pathname,
  })
  return JSON.parse(stdout.trim().split('\n').pop() as string)
}

const INVOKE = `
  import { Readable } from 'node:stream'
  const { default: handler } = await import(${JSON.stringify(API)})
  const call = (headers = {}) => new Promise((resolve) => {
    const req = Object.assign(Readable.from([]), { method: 'GET', headers, url: '/api/osc-permissions?oscId=osc-alfa' })
    const res = { statusCode: 0, setHeader() {}, end(b) { resolve([this.statusCode, JSON.parse(b)]) } }
    handler(req, res)
  })
  console.log(JSON.stringify({ requireModule: process.features.require_module ?? false, noToken: await call(), badToken: await call({ authorization: 'Bearer abc.def.ghi' }) }))
`

test('sem require(esm) e sem credenciais: carrega e responde 503 controlado', async () => {
  const result = await node(INVOKE)
  assert.equal(result.requireModule, false, 'o processo de teste deve estar SEM require(esm)')
  assert.deepEqual(result.noToken, [503, { error: 'not-configured' }])
  assert.deepEqual(result.badToken, [503, { error: 'not-configured' }])
})

test('sem require(esm) e configurado (modo emulador fictício): 401 sem token e com token inválido', async () => {
  const result = await node(INVOKE, {
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:1',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:1',
    GCLOUD_PROJECT: 'demo-sigosc-esm',
  })
  assert.equal(result.requireModule, false)
  assert.deepEqual(result.noToken, [401, { error: 'invalid-token' }])
  assert.deepEqual(result.badToken, [401, { error: 'invalid-token' }])
})

test('o jose registrado é o mesmo arquivo resolvido pelo jwks-rsa e funciona (JWKS local)', async () => {
  const result = await node(`
    import { createServer } from 'node:http'
    import { createRequire } from 'node:module'
    import { generateKeyPairSync } from 'node:crypto'
    const interop = await import(${JSON.stringify(INTEROP)})
    await interop.prepareFirebaseAdminRuntime()
    const require = createRequire(import.meta.url)
    const josePath = interop.resolveJoseForFirebaseAdmin()
    const jwksPath = createRequire(require.resolve('firebase-admin/auth')).resolve('jwks-rsa')
    const jwksRsa = createRequire(require.resolve('firebase-admin/auth'))('jwks-rsa')
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'chave-teste', use: 'sig', alg: 'RS256' }
    const server = createServer((_q, s) => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ keys: [jwk] })) })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const client = jwksRsa({ jwksUri: 'http://127.0.0.1:' + server.address().port + '/jwks' })
    const key = await client.getSigningKey('chave-teste')
    server.close()
    console.log(JSON.stringify({
      requireModule: process.features.require_module ?? false,
      sameFile: createRequire(jwksPath).resolve('jose') === josePath,
      cached: typeof require.cache[josePath]?.exports?.importJWK === 'function',
      pem: key.getPublicKey().startsWith('-----BEGIN PUBLIC KEY-----'),
    }))
  `)
  assert.deepEqual(result, { requireModule: false, sameFile: true, cached: true, pem: true })
})
