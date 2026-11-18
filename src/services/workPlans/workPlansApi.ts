/**
 * Cliente de `/api/osc-work-plans` (DEV-02.2): iniciar, alterar e finalizar o cadastro estruturado.
 * O cliente não decide autorização; falhas de infraestrutura nunca viram sucesso simulado.
 */
import type { CorrectionErrorCode, CorrectionErrorKey, FieldErrorCode, FieldValue, WorkPlanDenial, WorkPlanField } from '../../domain/workPlans.ts'

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
  | 'invalid-correction'
  | 'invalid-request'
  | 'unknown'

export type WorkPlansFailure = {
  readonly ok: false
  readonly error: WorkPlansApiError
  readonly reason?: WorkPlanDenial
  readonly fields?: Partial<Record<CorrectionErrorKey, FieldErrorCode | CorrectionErrorCode | 'required'>>
  readonly pending?: readonly string[]
}
export type WorkPlansResult = { readonly ok: true; readonly revision: number; readonly changed: boolean; readonly warnings: readonly string[] } | WorkPlansFailure

/** Entrada do histórico de correções materiais (DEC-PT-002), já autorizada pelo servidor. */
export interface CorrectionEntry {
  readonly at: string | null
  /** "Você" ou outro usuário da OSC (identificado só pela competência, sem dados pessoais). */
  readonly actor: 'you' | 'other'
  readonly actorAuthority: 'administrator' | 'delegate' | 'member'
  readonly corrections: readonly { field: WorkPlanField; before: FieldValue; after: FieldValue }[]
  readonly justification: string
  readonly fromRevision: number
  readonly toRevision: number
}
export type HistoryResult = { readonly ok: true; readonly entries: readonly CorrectionEntry[] } | WorkPlansFailure

export interface WorkPlansApi {
  start(request: { oscId: string; partnershipId: string; requestId: string }): Promise<WorkPlansResult>
  update(request: { oscId: string; partnershipId: string; requestId: string; expectedRevision: number; changes: Partial<Record<WorkPlanField, FieldValue>> }): Promise<WorkPlansResult>
  finalize(request: { oscId: string; partnershipId: string; requestId: string; expectedRevision: number }): Promise<WorkPlansResult>
  correct(request: {
    oscId: string
    partnershipId: string
    requestId: string
    expectedRevision: number
    changes: Partial<Record<WorkPlanField, FieldValue>>
    justification: string
    declaration: boolean
  }): Promise<WorkPlansResult>
  history(request: { oscId: string; partnershipId: string }): Promise<HistoryResult>
}

interface Dependencies {
  fetch: typeof globalThis.fetch
  getIdToken(): Promise<string | null>
  endpoint?: string
}

export function createWorkPlansApi({ fetch, getIdToken, endpoint = '/api/osc-work-plans' }: Dependencies): WorkPlansApi {
  async function request(method: 'POST' | 'PATCH' | 'GET', payload: unknown, query = ''): Promise<{ ok: true; body: Record<string, unknown> } | WorkPlansFailure> {
    let token: string | null
    try {
      token = await getIdToken()
    } catch {
      token = null
    }
    if (!token) return { ok: false, error: 'session-expired' }
    let response: Response
    try {
      response = await fetch(`${endpoint}${query}`, {
        method,
        headers: method === 'GET' ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(payload),
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
    if (response.ok) return { ok: true, body }
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
          : body.error === 'invalid-correction'
            ? { ok: false, error: 'invalid-correction', fields: (body.fields ?? {}) as WorkPlansFailure['fields'], pending: (body.pending ?? undefined) as string[] | undefined }
            : { ok: false, error: 'invalid-values', fields: (body.fields ?? {}) as WorkPlansFailure['fields'] }
      case 400:
        return { ok: false, error: 'invalid-request' }
      case 503:
        return { ok: false, error: 'unavailable' }
      default:
        return { ok: false, error: 'unknown' }
    }
  }
  async function call(method: 'POST' | 'PATCH', payload: unknown): Promise<WorkPlansResult> {
    const result = await request(method, payload)
    if (!result.ok) return result
    const { body } = result
    const plan = body.workPlan as Record<string, unknown> | undefined
    if (typeof plan?.revision !== 'number') return { ok: false, error: 'unknown' }
    const changed = body.created === true || body.changed === true || body.finalized === true || body.corrected === true
    return { ok: true, revision: plan.revision, changed, warnings: Array.isArray(body.warnings) ? (body.warnings as string[]) : [] }
  }

  return {
    start: ({ oscId, partnershipId, requestId }) => call('POST', { oscId, partnershipId, requestId, action: 'start' }),
    update: (request) => call('PATCH', request),
    finalize: ({ oscId, partnershipId, requestId, expectedRevision }) => call('POST', { oscId, partnershipId, requestId, action: 'finalize', expectedRevision, confirm: true }),
    correct: (r) => call('POST', { oscId: r.oscId, partnershipId: r.partnershipId, requestId: r.requestId, action: 'correct', expectedRevision: r.expectedRevision, changes: r.changes, justification: r.justification, declaration: r.declaration }),
    async history({ oscId, partnershipId }) {
      const result = await request('GET', null, `?${new URLSearchParams({ oscId, partnershipId }).toString()}`)
      if (!result.ok) return result
      return Array.isArray(result.body.entries) ? { ok: true, entries: result.body.entries as CorrectionEntry[] } : { ok: false, error: 'unknown' }
    },
  }
}
