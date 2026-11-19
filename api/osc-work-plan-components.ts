/**
 * Função de servidor da Vercel: /api/osc-work-plan-components (DEV-02.4).
 *
 * POST  {oscId, partnershipId, workPlanId, requestId, action: 'create-goal' | 'create-indicator', data}
 * PATCH {oscId, partnershipId, workPlanId, requestId, componentKind, componentId, expectedRevision, data}
 * Metas e indicadores PREVISTOS de uma versão do Plano; exige `work-plan.edit` (DEC-PT-001).
 * A consulta é feita pelo cliente sob as Security Rules (`work-plan.view`).
 *
 * Mesmo padrão da DEV-01.3-FIX01: Admin SDK carregado sob demanda após
 * `prepareFirebaseAdminRuntime()`. Sem credenciais configuradas, responde 503.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { prepareFirebaseAdminRuntime } from './_lib/esmInterop.ts'
import { MAX_BODY_BYTES } from './_lib/limits.ts'

type VercelRequest = IncomingMessage & { body?: unknown }

let modules: Promise<{
  handleWorkPlanComponentsRequest: typeof import('./_lib/workPlanComponentsService.ts').handleWorkPlanComponentsRequest
  getServerDeps: typeof import('./_lib/serverDeps.ts').getServerDeps
}> | null = null

function loadServerModules() {
  modules ??= prepareFirebaseAdminRuntime().then(async () => {
    const [service, deps] = await Promise.all([import('./_lib/workPlanComponentsService.ts'), import('./_lib/serverDeps.ts')])
    return { handleWorkPlanComponentsRequest: service.handleWorkPlanComponentsRequest, getServerDeps: deps.getServerDeps }
  })
  return modules
}

async function readBody(req: VercelRequest): Promise<string> {
  if (req.method !== 'POST' && req.method !== 'PATCH') return ''
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
    const { handleWorkPlanComponentsRequest, getServerDeps } = await loadServerModules()
    const url = new URL(req.url ?? '/', 'http://localhost')
    const result = await handleWorkPlanComponentsRequest(
      { method: req.method, authorization: req.headers.authorization, query: url.searchParams, rawBody: await readBody(req) },
      getServerDeps(),
    )
    status = result.status
    body = result.body
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown'
    console.error(`[osc-work-plan-components] falha ao processar (${code})`)
  }
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(body))
}
