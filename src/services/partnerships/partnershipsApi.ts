/**
 * Cliente do cadastro e da correção cadastral de parcerias (DEV-02.1-C01) — `/api/osc-partnerships`.
 *
 * O cliente nunca decide autorização: envia o token de ID e os dados; o servidor relê
 * vínculo, OSC e parceria, decide e valida. Falhas de infraestrutura viram `unavailable`
 * — nunca um sucesso simulado.
 */
import type { DraftErrors, DraftWarnings, PartnershipChanges, PartnershipDenial, PartnershipDraft } from '../../domain/partnerships.ts'

export type PartnershipsApiError =
  | 'unavailable'
  | 'network'
  | 'session-expired'
  | 'forbidden'
  | 'invalid-draft'
  | 'possible-duplicate'
  | 'stale'
  | 'not-found'
  | 'invalid-request'
  | 'unknown'

export interface DuplicateCandidate {
  readonly id: string
  readonly title: string
  readonly publicPartner: string
  readonly formalizationDate: string
  readonly termStart: string
  readonly termEnd: string
  readonly administrativeStatus: string
  /** Mesmas datas de formalização e vigência: provável recadastramento do mesmo instrumento. */
  readonly sameDates: boolean
}

export type ApiFailure = {
  readonly ok: false
  readonly error: PartnershipsApiError
  readonly reason?: PartnershipDenial
  readonly fields?: DraftErrors
  readonly duplicates?: { readonly count: number; readonly candidates: readonly DuplicateCandidate[] }
}

export type CreateResult = { readonly ok: true; readonly id: string; readonly created: boolean; readonly warnings: DraftWarnings } | ApiFailure
export type UpdateResult = { readonly ok: true; readonly id: string; readonly changed: boolean; readonly revision: number } | ApiFailure

export interface CreateRequest {
  readonly oscId: string
  /** Identificador do pedido (idempotência): o mesmo pedido reenviado não duplica o cadastro. */
  readonly requestId: string
  readonly draft: PartnershipDraft
  /** Confirmação explícita após o aviso de possível duplicidade. */
  readonly acknowledgeDuplicates?: boolean
}

export interface UpdateRequest {
  readonly oscId: string
  readonly partnershipId: string
  readonly requestId: string
  readonly expectedRevision: number
  readonly changes: PartnershipChanges
}

export interface PartnershipsApi {
  create(request: CreateRequest): Promise<CreateResult>
  update(request: UpdateRequest): Promise<UpdateResult>
}

interface Dependencies {
  fetch: typeof globalThis.fetch
  getIdToken(): Promise<string | null>
  endpoint?: string
}

export function createPartnershipsApi({ fetch, getIdToken, endpoint = '/api/osc-partnerships' }: Dependencies): PartnershipsApi {
  async function call(method: 'POST' | 'PATCH', payload: unknown): Promise<{ ok: true; body: Record<string, unknown> } | ApiFailure> {
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
    if (response.ok) return { ok: true, body }
    switch (response.status) {
      case 401:
        return { ok: false, error: 'session-expired' }
      case 403:
        return { ok: false, error: 'forbidden', reason: typeof body.reason === 'string' ? (body.reason as PartnershipDenial) : undefined }
      case 404:
        return body.error === 'not-found' ? { ok: false, error: 'not-found' } : { ok: false, error: 'unavailable' }
      case 409:
        if (body.error === 'possible-duplicate') {
          const candidates = Array.isArray(body.candidates) ? (body.candidates as DuplicateCandidate[]) : []
          return { ok: false, error: 'possible-duplicate', duplicates: { count: typeof body.count === 'number' ? body.count : candidates.length, candidates } }
        }
        return { ok: false, error: body.error === 'stale' ? 'stale' : 'unknown' }
      case 422:
        return { ok: false, error: 'invalid-draft', fields: (body.fields ?? {}) as DraftErrors }
      case 400:
        return { ok: false, error: 'invalid-request' }
      case 503:
        return { ok: false, error: 'unavailable' }
      default:
        return { ok: false, error: 'unknown' }
    }
  }

  return {
    async create({ oscId, requestId, draft, acknowledgeDuplicates }) {
      const payload = acknowledgeDuplicates ? { oscId, requestId, draft, acknowledgeDuplicates: true } : { oscId, requestId, draft }
      const result = await call('POST', payload)
      if (!result.ok) return result
      const partnership = result.body.partnership as Record<string, unknown> | undefined
      return typeof partnership?.id === 'string'
        ? { ok: true, id: partnership.id, created: result.body.created === true, warnings: (result.body.warnings ?? {}) as DraftWarnings }
        : { ok: false, error: 'unknown' }
    },
    async update(request) {
      const result = await call('PATCH', request)
      if (!result.ok) return result
      const partnership = result.body.partnership as Record<string, unknown> | undefined
      return partnership?.id === request.partnershipId && typeof partnership.revision === 'number'
        ? { ok: true, id: request.partnershipId, changed: result.body.changed === true, revision: partnership.revision }
        : { ok: false, error: 'unknown' }
    },
  }
}
