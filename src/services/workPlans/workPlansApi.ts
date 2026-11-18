/**
 * Cliente de `/api/osc-work-plans` (DEV-02.2): iniciar, alterar e finalizar o cadastro estruturado.
 * O cliente não decide autorização; falhas de infraestrutura nunca viram sucesso simulado.
 */
import type { FieldErrorCode, FieldValue, WorkPlanDenial, WorkPlanField } from '../../domain/workPlans.ts'

export type WorkPlansApiError =
  | 'unavailable'
  | 'network'
  | 'session-expired'
  | 'forbidden'
  | 'not-found'
  | 'not-structured'
  | 'stale'
  | 'invalid-values'
  | 'finalization-pending'
  | 'invalid-request'
  | 'unknown'

export type WorkPlansFailure = {
  readonly ok: false
  readonly error: WorkPlansApiError
  readonly reason?: WorkPlanDenial
  readonly fields?: Partial<Record<WorkPlanField | 'changes', FieldErrorCode | 'required'>>
  readonly pending?: readonly string[]
}
export type WorkPlansResult = { readonly ok: true; readonly revision: number; readonly changed: boolean; readonly warnings: readonly string[] } | WorkPlansFailure

export interface WorkPlansApi {
  start(request: { oscId: string; partnershipId: string; requestId: string }): Promise<WorkPlansResult>
  update(request: { oscId: string; partnershipId: string; requestId: string; expectedRevision: number; changes: Partial<Record<WorkPlanField, FieldValue>> }): Promise<WorkPlansResult>
  finalize(request: { oscId: string; partnershipId: string; requestId: string; expectedRevision: number }): Promise<WorkPlansResult>
}

interface Dependencies {
  fetch: typeof globalThis.fetch
  getIdToken(): Promise<string | null>
  endpoint?: string
}

export function createWorkPlansApi({ fetch, getIdToken, endpoint = '/api/osc-work-plans' }: Dependencies): WorkPlansApi {
  async function call(method: 'POST' | 'PATCH', payload: unknown): Promise<WorkPlansResult> {
    let token: string | null
    try {
      token = await getIdToken()
    } catch {
      token = null
    }
    if (!token) return { ok: false, error: 'session-expired' }
    let response: Response
    try {
      response = await fetch(endpoint, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin',
        cache: 'no-store',
      })
    } catch {
      return { ok: false, error: 'network' }
    }
    if (!(response.headers.get('content-type') ?? '').includes('application/json')) return { ok: false, error: 'unavailable' }
    let body: Record<string, unknown>
    try {
      body = (await response.json()) as Record<string, unknown>
    } catch {
      return { ok: false, error: 'unavailable' }
    }
    if (response.ok) {
      const plan = body.workPlan as Record<string, unknown> | undefined
      if (typeof plan?.revision !== 'number') return { ok: false, error: 'unknown' }
      return { ok: true, revision: plan.revision, changed: body.created === true || body.changed === true || body.finalized === true, warnings: Array.isArray(body.warnings) ? (body.warnings as string[]) : [] }
    }
    const reason = typeof body.reason === 'string' ? (body.reason as WorkPlanDenial) : undefined
    switch (response.status) {
      case 401:
        return { ok: false, error: 'session-expired' }
      case 403:
        return { ok: false, error: 'forbidden', reason }
      case 404:
        return body.error === 'not-found' ? { ok: false, error: 'not-found' } : { ok: false, error: 'unavailable' }
      case 409:
        if (body.reason === 'already-finalized') return { ok: false, error: 'forbidden', reason: 'already-finalized' }
        return { ok: false, error: body.error === 'stale' ? 'stale' : body.error === 'not-structured' ? 'not-structured' : 'unknown' }
      case 422:
        return body.error === 'finalization-pending'
          ? { ok: false, error: 'finalization-pending', pending: (body.pending ?? []) as string[] }
          : { ok: false, error: 'invalid-values', fields: (body.fields ?? {}) as WorkPlansFailure['fields'] }
      case 400:
        return { ok: false, error: 'invalid-request' }
      case 503:
        return { ok: false, error: 'unavailable' }
      default:
        return { ok: false, error: 'unknown' }
    }
  }
  return {
    start: ({ oscId, partnershipId, requestId }) => call('POST', { oscId, partnershipId, requestId, action: 'start' }),
    update: (request) => call('PATCH', request),
    finalize: ({ oscId, partnershipId, requestId, expectedRevision }) => call('POST', { oscId, partnershipId, requestId, action: 'finalize', expectedRevision, confirm: true }),
  }
}
