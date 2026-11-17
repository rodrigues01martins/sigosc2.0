/**
 * Função de servidor da Vercel: /api/osc-permissions (DEV-01.3).
 *
 * GET  ?oscId=...                       → P02 relação de vínculos para gestão.
 * POST {oscId, targetUid, action, ...}  → P03–P06 concessão/revogação.
 *
 * Adaptador fino: toda a lógica está em `_lib/permissionsService.ts`.
 * Sem credenciais configuradas, responde 503 (nenhuma operação privilegiada).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { MAX_BODY_BYTES, handlePermissionsRequest } from './_lib/permissionsService.ts'
import { getServerDeps } from './_lib/serverDeps.ts'

type VercelRequest = IncomingMessage & { body?: unknown }

async function readBody(req: VercelRequest): Promise<string> {
  if (req.method !== 'POST') return ''
  // Com os auxiliares da Vercel, o corpo pode já ter sido lido e interpretado.
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
    const url = new URL(req.url ?? '/', 'http://localhost')
    const result = await handlePermissionsRequest(
      { method: req.method, authorization: req.headers.authorization, query: url.searchParams, rawBody: await readBody(req) },
      getServerDeps(),
    )
    status = result.status
    body = result.body
  } catch {
    // Nenhum detalhe interno é devolvido ao cliente.
  }
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(body))
}
