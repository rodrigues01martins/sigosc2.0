/**
 * Cliente de `/api/osc-work-plans` (DEV-02.2): iniciar, alterar e finalizar o cadastro estruturado.
 * O cliente não decide autorização; falhas de infraestrutura nunca viram sucesso simulado.
 */
import type { FormalAct, FormalActErrorCode, FormalActField, VersionDenial } from '../../domain/workPlanVersions.ts'
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
  | 'invalid-formal-act'
  | 'invalid-request'
  | 'unknown'

export type WorkPlansFailure = {
  readonly ok: false
  readonly error: WorkPlansApiError
  readonly reason?: WorkPlanDenial | VersionDenial
  readonly fields?: Partial<Record<CorrectionErrorKey | FormalActField | 'formalAct', FieldErrorCode | CorrectionErrorCode | FormalActErrorCode | 'required'>>
  readonly pending?: readonly string[]
}
/** DEC-PT-003: ativação cadastral confirmada pelo servidor na finalização de versão posterior. */
export interface ActivationOutcome {
  readonly supersededWorkPlanId: string
  readonly sequence: number
  /** Data de efeitos DECLARADA (null = não informada). */
  readonly effectiveDate: string | null
}
export type WorkPlansResult =
  | { readonly ok: true; readonly id: string; readonly revision: number; readonly changed: boolean; readonly warnings: readonly string[]; readonly activation?: ActivationOutcome | null }
  | WorkPlansFailure

/** Entrada do histórico de correções materiais (DEC-PT-002), já autorizada pelo servidor. */
export interface CorrectionEntry {
  /** Versão corrigida (`original`, `v2`…). */
  readonly workPlanId: string
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
  update(request: { oscId: string; partnershipId: string; workPlanId: string; requestId: string; expectedRevision: number; changes: Partial<Record<WorkPlanField, FieldValue>> }): Promise<WorkPlansResult>
  finalize(request: { oscId: string; partnershipId: string; workPlanId: string; requestId: string; expectedRevision: number }): Promise<WorkPlansResult>
  /** DEV-02.3: nova versão integral a partir da vigente (alteração formal). */
  createVersion(request: { oscId: string; partnershipId: string; requestId: string; baseWorkPlanId: string; baseRevision: number; formalAct: FormalAct }): Promise<WorkPlansResult>
  /** DEV-02.3: dados do ato formal de versão ainda em cadastramento. */
  updateFormalAct(request: { oscId: string; partnershipId: string; workPlanId: string; requestId: string; expectedRevision: number; formalAct: FormalAct }): Promise<WorkPlansResult>
  correct(request: {
    oscId: string
    partnershipId: string
    workPlanId: string
    requestId: string
    expectedRevision: number
    changes: Partial<Record<WorkPlanField, FieldValue>>
    justification: string
    declaration: boolean
  }): Promise<WorkPlansResult>
  history(request: { oscId: string; partnershipId: string; workPlanId?: string }): Promise<HistoryResult>
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
        if (typeof body.reason === 'string') return { ok: false, error: 'forbidden', reason: body.reason as VersionDenial }
        return { ok: false, error: body.error === 'stale' ? 'stale' : body.error === 'not-structured' ? 'not-structured' : 'unknown' }
      case 422:
        return body.error === 'finalization-pending'
          ? { ok: false, error: 'finalization-pending', pending: (body.pending ?? []) as string[] }
          : body.error === 'invalid-correction'
            ? { ok: false, error: 'invalid-correction', fields: (body.fields ?? {}) as WorkPlansFailure['fields'], pending: (body.pending ?? undefined) as string[] | undefined }
            : body.error === 'invalid-formal-act'
              ? { ok: false, error: 'invalid-formal-act', fields: (body.fields ?? {}) as WorkPlansFailure['fields'] }
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
    if (typeof plan?.revision !== 'number' || typeof plan.id !== 'string') return { ok: false, error: 'unknown' }
    const changed = body.created === true || body.changed === true || body.finalized === true || body.corrected === true
    const activation =
      plan.activationStatus === 'active' && typeof plan.supersededWorkPlanId === 'string' && typeof plan.sequence === 'number'
        ? { supersededWorkPlanId: plan.supersededWorkPlanId, sequence: plan.sequence, effectiveDate: typeof plan.effectiveDate === 'string' ? plan.effectiveDate : null }
        : null
    return { ok: true, id: plan.id, revision: plan.revision, changed, warnings: Array.isArray(body.warnings) ? (body.warnings as string[]) : [], activation }
  }

  return {
    start: ({ oscId, partnershipId, requestId }) => call('POST', { oscId, partnershipId, requestId, action: 'start' }),
    update: (request) => call('PATCH', request),
    finalize: ({ oscId, partnershipId, workPlanId, requestId, expectedRevision }) => call('POST', { oscId, partnershipId, workPlanId, requestId, action: 'finalize', expectedRevision, confirm: true }),
    createVersion: (r) => call('POST', { oscId: r.oscId, partnershipId: r.partnershipId, requestId: r.requestId, action: 'create-version', baseWorkPlanId: r.baseWorkPlanId, baseRevision: r.baseRevision, formalAct: r.formalAct }),
    updateFormalAct: (r) => call('PATCH', { oscId: r.oscId, partnershipId: r.partnershipId, workPlanId: r.workPlanId, requestId: r.requestId, expectedRevision: r.expectedRevision, formalAct: r.formalAct }),
    correct: (r) => call('POST', { oscId: r.oscId, partnershipId: r.partnershipId, workPlanId: r.workPlanId, requestId: r.requestId, action: 'correct', expectedRevision: r.expectedRevision, changes: r.changes, justification: r.justification, declaration: r.declaration }),
    async history({ oscId, partnershipId, workPlanId }) {
      const result = await request('GET', null, `?${new URLSearchParams({ oscId, partnershipId, ...(workPlanId ? { workPlanId } : {}) }).toString()}`)
      if (!result.ok) return result
      return Array.isArray(result.body.entries) ? { ok: true, entries: result.body.entries as CorrectionEntry[] } : { ok: false, error: 'unknown' }
    },
  }
}
