/**
 * Função de servidor da Vercel: /api/osc-partnerships (DEV-02.1).
 *
 * POST {oscId, requestId, draft} → cadastro de parceria formalizada.
 * PREPARADO E BLOQUEADO: enquanto `partnerships.edit` estiver pendente de especificação,
 * toda requisição autenticada recebe 403 `pending-specification` (ver `_lib/partnershipsService.ts`).
 * A consulta de parcerias NÃO passa por aqui: é feita pelo cliente sob as Security Rules.
 *
 * Mesmo padrão da DEV-01.3-FIX01: o Firebase Admin SDK é carregado SOB DEMANDA, somente
 * depois de `prepareFirebaseAdminRuntime()` (compatibilidade ESM/CommonJS).
 * Sem credenciais configuradas, responde 503.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { prepareFirebaseAdminRuntime } from './_lib/esmInterop.ts'
import { MAX_BODY_BYTES } from './_lib/limits.ts'

type VercelRequest = IncomingMessage & { body?: unknown }

let modules: Promise<{
  handlePartnershipsRequest: typeof import('./_lib/partnershipsService.ts').handlePartnershipsRequest
  getServerDeps: typeof import('./_lib/serverDeps.ts').getServerDeps
}> | null = null

function loadServerModules() {
  modules ??= prepareFirebaseAdminRuntime().then(async () => {
    const [service, deps] = await Promise.all([import('./_lib/partnershipsService.ts'), import('./_lib/serverDeps.ts')])
    return { handlePartnershipsRequest: service.handlePartnershipsRequest, getServerDeps: deps.getServerDeps }
  })
  return modules
}

async function readBody(req: VercelRequest): Promise<string> {
  if (req.method !== 'POST') return ''
  if ('body' in req && req.body !== undefined) {
    const { body } = req
    if (typeof body === 'string') return body
    if (Buffer.isBuffer(body)) return body.toString('utf8')
    return JSON.stringify(body)
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.length
    if (size > MAX_BODY_BYTES) return ''
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export default async function handler(req: VercelRequest, res: ServerResponse): Promise<void> {
  let status = 500
  let body: Record<string, unknown> = { error: 'internal' }
  try {
    const { handlePartnershipsRequest, getServerDeps } = await loadServerModules()
    const url = new URL(req.url ?? '/', 'http://localhost')
    // Sem opções: a política de produção (bloqueio por especificação pendente) é a ÚNICA possível aqui.
    const result = await handlePartnershipsRequest(
      { method: req.method, authorization: req.headers.authorization, query: url.searchParams, rawBody: await readBody(req) },
      getServerDeps(),
    )
    status = result.status
    body = result.body
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown'
    console.error(`[osc-partnerships] falha ao processar (${code})`)
  }
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(body))
}
