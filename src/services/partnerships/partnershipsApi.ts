/**
 * Cliente do cadastro de parcerias (DEV-02.1) — `/api/osc-partnerships`. PREPARADO.
 *
 * O cliente nunca decide autorização: envia o token de ID e o rascunho; o servidor
 * relê vínculo e OSC, decide e valida. Enquanto `partnerships.edit` estiver pendente
 * de especificação, o servidor responde 403 `pending-specification`. Falhas de
 * infraestrutura viram `unavailable` — nunca um sucesso simulado.
 */
import type { DraftErrors, PartnershipDraft, RegistrationDenial } from '../../domain/partnerships.ts'

export type PartnershipsApiError =
  | 'unavailable'
  | 'network'
  | 'session-expired'
  | 'forbidden'
  | 'invalid-draft'
  | 'duplicate'
  | 'invalid-request'
  | 'unknown'

export type CreateResult =
  | { readonly ok: true; readonly id: string; readonly created: boolean }
  | { readonly ok: false; readonly error: PartnershipsApiError; readonly reason?: RegistrationDenial; readonly fields?: DraftErrors }

export interface CreateRequest {
  readonly oscId: string
  /** Identificador do pedido (idempotência): o mesmo pedido reenviado não duplica o cadastro. */
  readonly requestId: string
  readonly draft: PartnershipDraft
}

export interface PartnershipsApi {
  create(request: CreateRequest): Promise<CreateResult>
}

interface Dependencies {
  fetch: typeof globalThis.fetch
  getIdToken(): Promise<string | null>
  endpoint?: string
}

export function createPartnershipsApi({ fetch, getIdToken, endpoint = '/api/osc-partnerships' }: Dependencies): PartnershipsApi {
  return {
    async create({ oscId, requestId, draft }) {
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
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ oscId, requestId, draft }),
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
        const partnership = body.partnership as Record<string, unknown> | undefined
        return typeof partnership?.id === 'string'
          ? { ok: true, id: partnership.id, created: body.created === true }
          : { ok: false, error: 'unknown' }
      }
      switch (response.status) {
        case 401:
          return { ok: false, error: 'session-expired' }
        case 403:
          return { ok: false, error: 'forbidden', reason: typeof body.reason === 'string' ? (body.reason as RegistrationDenial) : undefined }
        case 409:
          return { ok: false, error: 'duplicate' }
        case 422:
          return { ok: false, error: 'invalid-draft', fields: (body.fields ?? {}) as DraftErrors }
        case 400:
          return { ok: false, error: 'invalid-request' }
        case 503:
          return { ok: false, error: 'unavailable' }
        default:
          return { ok: false, error: 'unknown' }
      }
    },
  }
}
