/**
 * Cliente de `/api/osc-work-plans` (DEV-02.2): iniciar, alterar e finalizar o cadastro estruturado.
 * O cliente não decide autorização; falhas de infraestrutura nunca viram sucesso simulado.
 */
import type { ComponentErrorCode, ComponentKind, ComponentReview, GoalData, IndicatorData } from '../../domain/workPlanComponents.ts'
import type { FinErrorCode, FinancialCategoryData, FinancialItemData, FinancialKind } from '../../domain/workPlanFinancial.ts'
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
  | 'invalid-component'
  | 'invalid-financial'
  | 'invalid-request'
  | 'unknown'

export type WorkPlansFailure = {
  readonly ok: false
  readonly error: WorkPlansApiError
  readonly reason?: WorkPlanDenial | VersionDenial
  readonly fields?: Partial<Record<CorrectionErrorKey | FormalActField | 'formalAct' | string, FieldErrorCode | CorrectionErrorCode | FormalActErrorCode | ComponentErrorCode | FinErrorCode | 'required'>>
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

/** DEV-02.4: resultado de gravação de meta ou indicador (estado confirmado pelo servidor). */
export type ComponentResult = { readonly ok: true; readonly id: string; readonly revision: number; readonly changed: boolean } | WorkPlansFailure

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
  /** DEC-PT-007: a finalização leva a conferência dos componentes, a impressão digital vista e a declaração. */
  finalize(request: { oscId: string; partnershipId: string; workPlanId: string; requestId: string; expectedRevision: number; review: ComponentReview; componentsToken: string; declaration: boolean }): Promise<WorkPlansResult>
  /** DEC-PT-006: abrir a incorporação complementar na versão vigente finalizada sem componentes. */
  openTranscription(request: { oscId: string; partnershipId: string; workPlanId: string; requestId: string; declaration: boolean }): Promise<WorkPlansResult>
  /** DEC-PT-011: abrir a incorporação FINANCEIRA na versão vigente finalizada sem planejamento financeiro. */
  openFinancialTranscription(request: { oscId: string; partnershipId: string; workPlanId: string; requestId: string; declaration: boolean }): Promise<WorkPlansResult>
  /** DEC-PT-011: encerrar a incorporação financeira (impressão digital + declaração final). */
  closeFinancialTranscription(request: { oscId: string; partnershipId: string; workPlanId: string; requestId: string; expectedTranscriptionRevision: number; financialToken: string; declaration: boolean }): Promise<WorkPlansResult>
  /** DEC-PT-006: encerrar a incorporação (conferência + declaração). */
  closeTranscription(request: { oscId: string; partnershipId: string; workPlanId: string; requestId: string; expectedTranscriptionRevision: number; review: ComponentReview; componentsToken: string; declaration: boolean }): Promise<WorkPlansResult>
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
  /** DEV-02.4: cadastrar meta ou indicador PREVISTO numa versão em cadastramento. */
  createComponent(request: { oscId: string; partnershipId: string; workPlanId: string; requestId: string; kind: ComponentKind; data: GoalData | IndicatorData }): Promise<ComponentResult>
  /** DEV-02.4: alterar meta ou indicador (componente completo; revisão conferida). */
  updateComponent(request: { oscId: string; partnershipId: string; workPlanId: string; requestId: string; kind: ComponentKind; componentId: string; expectedRevision: number; data: GoalData | IndicatorData }): Promise<ComponentResult>
  /** DEV-02.5: cadastrar categoria ou item do planejamento financeiro PREVISTO. */
  createFinancial(request: { oscId: string; partnershipId: string; workPlanId: string; requestId: string; kind: FinancialKind; data: FinancialCategoryData | FinancialItemData }): Promise<ComponentResult>
  /** DEV-02.5: alterar categoria ou item (registro completo; revisão conferida). */
  updateFinancial(request: { oscId: string; partnershipId: string; workPlanId: string; requestId: string; kind: FinancialKind; id: string; expectedRevision: number; data: FinancialCategoryData | FinancialItemData }): Promise<ComponentResult>
}

interface Dependencies {
  fetch: typeof globalThis.fetch
  getIdToken(): Promise<string | null>
  endpoint?: string
  componentsEndpoint?: string
  financialEndpoint?: string
}

export function createWorkPlansApi({ fetch, getIdToken, endpoint = '/api/osc-work-plans', componentsEndpoint = '/api/osc-work-plan-components', financialEndpoint = '/api/osc-work-plan-financial' }: Dependencies): WorkPlansApi {
  async function request(method: 'POST' | 'PATCH' | 'GET', payload: unknown, query = '', target = endpoint): Promise<{ ok: true; body: Record<string, unknown> } | WorkPlansFailure> {
    let token: string | null
    try {
      token = await getIdToken()
    } catch {
      token = null
    }
    if (!token) return { ok: false, error: 'session-expired' }
    let response: Response
    try {
      response = await fetch(`${target}${query}`, {
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
        return body.error === 'finalization-pending' || body.error === 'review-pending'
          ? { ok: false, error: 'finalization-pending', pending: (body.pending ?? []) as string[] }
          : body.error === 'declaration-required'
            ? { ok: false, error: 'finalization-pending', pending: ['Confirme a declaração de correspondência ao Plano aprovado.'] }
          : body.error === 'invalid-correction'
            ? { ok: false, error: 'invalid-correction', fields: (body.fields ?? {}) as WorkPlansFailure['fields'], pending: (body.pending ?? undefined) as string[] | undefined }
            : body.error === 'invalid-formal-act'
              ? { ok: false, error: 'invalid-formal-act', fields: (body.fields ?? {}) as WorkPlansFailure['fields'] }
              : body.error === 'invalid-component'
                ? { ok: false, error: 'invalid-component', fields: (body.fields ?? {}) as WorkPlansFailure['fields'] }
                : body.error === 'invalid-financial'
                  ? { ok: false, error: 'invalid-financial', fields: (body.fields ?? {}) as WorkPlansFailure['fields'] }
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
    const changed = body.created === true || body.changed === true || body.finalized === true || body.corrected === true || body.opened === true || body.closed === true
    const activation =
      plan.activationStatus === 'active' && typeof plan.supersededWorkPlanId === 'string' && typeof plan.sequence === 'number'
        ? { supersededWorkPlanId: plan.supersededWorkPlanId, sequence: plan.sequence, effectiveDate: typeof plan.effectiveDate === 'string' ? plan.effectiveDate : null }
        : null
    return { ok: true, id: plan.id, revision: plan.revision, changed, warnings: Array.isArray(body.warnings) ? (body.warnings as string[]) : [], activation }
  }

  async function component(method: 'POST' | 'PATCH', payload: unknown, target = componentsEndpoint): Promise<ComponentResult> {
    const result = await request(method, payload, '', target)
    if (!result.ok) return result
    const c = (result.body.component ?? result.body.record) as Record<string, unknown> | undefined
    if (typeof c?.id !== 'string' || typeof c.revision !== 'number') return { ok: false, error: 'unknown' }
    return { ok: true, id: c.id, revision: c.revision, changed: result.body.created === true || result.body.changed === true }
  }

  return {
    start: ({ oscId, partnershipId, requestId }) => call('POST', { oscId, partnershipId, requestId, action: 'start' }),
    update: (request) => call('PATCH', request),
    finalize: ({ oscId, partnershipId, workPlanId, requestId, expectedRevision, review, componentsToken, declaration }) =>
      call('POST', { oscId, partnershipId, workPlanId, requestId, action: 'finalize', expectedRevision, confirm: true, review, componentsToken, declaration }),
    openTranscription: (r) => call('POST', { oscId: r.oscId, partnershipId: r.partnershipId, workPlanId: r.workPlanId, requestId: r.requestId, action: 'open-transcription', declaration: r.declaration }),
    openFinancialTranscription: (r) => call('POST', { oscId: r.oscId, partnershipId: r.partnershipId, workPlanId: r.workPlanId, requestId: r.requestId, action: 'open-financial-transcription', declaration: r.declaration }),
    closeFinancialTranscription: (r) =>
      call('POST', { oscId: r.oscId, partnershipId: r.partnershipId, workPlanId: r.workPlanId, requestId: r.requestId, action: 'close-financial-transcription', expectedTranscriptionRevision: r.expectedTranscriptionRevision, financialToken: r.financialToken, declaration: r.declaration }),
    closeTranscription: (r) =>
      call('POST', { oscId: r.oscId, partnershipId: r.partnershipId, workPlanId: r.workPlanId, requestId: r.requestId, action: 'close-transcription', expectedTranscriptionRevision: r.expectedTranscriptionRevision, review: r.review, componentsToken: r.componentsToken, declaration: r.declaration }),
    createVersion: (r) => call('POST', { oscId: r.oscId, partnershipId: r.partnershipId, requestId: r.requestId, action: 'create-version', baseWorkPlanId: r.baseWorkPlanId, baseRevision: r.baseRevision, formalAct: r.formalAct }),
    updateFormalAct: (r) => call('PATCH', { oscId: r.oscId, partnershipId: r.partnershipId, workPlanId: r.workPlanId, requestId: r.requestId, expectedRevision: r.expectedRevision, formalAct: r.formalAct }),
    correct: (r) => call('POST', { oscId: r.oscId, partnershipId: r.partnershipId, workPlanId: r.workPlanId, requestId: r.requestId, action: 'correct', expectedRevision: r.expectedRevision, changes: r.changes, justification: r.justification, declaration: r.declaration }),
    createComponent: (r) =>
      component('POST', { oscId: r.oscId, partnershipId: r.partnershipId, workPlanId: r.workPlanId, requestId: r.requestId, action: r.kind === 'goal' ? 'create-goal' : 'create-indicator', data: r.data }),
    updateComponent: (r) =>
      component('PATCH', { oscId: r.oscId, partnershipId: r.partnershipId, workPlanId: r.workPlanId, requestId: r.requestId, componentKind: r.kind, componentId: r.componentId, expectedRevision: r.expectedRevision, data: r.data }),
    createFinancial: (r) =>
      component('POST', { oscId: r.oscId, partnershipId: r.partnershipId, workPlanId: r.workPlanId, requestId: r.requestId, action: r.kind === 'financial-category' ? 'create-category' : 'create-item', data: r.data }, financialEndpoint),
    updateFinancial: (r) =>
      component('PATCH', { oscId: r.oscId, partnershipId: r.partnershipId, workPlanId: r.workPlanId, requestId: r.requestId, kind: r.kind, id: r.id, expectedRevision: r.expectedRevision, data: r.data }, financialEndpoint),
    async history({ oscId, partnershipId, workPlanId }) {
      const result = await request('GET', null, `?${new URLSearchParams({ oscId, partnershipId, ...(workPlanId ? { workPlanId } : {}) }).toString()}`)
      if (!result.ok) return result
      return Array.isArray(result.body.entries) ? { ok: true, entries: result.body.entries as CorrectionEntry[] } : { ok: false, error: 'unknown' }
    },
  }
}
