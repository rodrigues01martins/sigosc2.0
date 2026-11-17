/**
 * Cliente da API de permissões (DEV-01.3) — `/api/osc-permissions`.
 *
 * O cliente NUNCA decide autorização: apenas envia o token de ID e os
 * identificadores; o servidor verifica tudo com dados atuais. Respostas são
 * validadas antes do uso, e falhas de infraestrutura (função não publicada,
 * servidor sem credenciais, ambiente de desenvolvimento) viram `unavailable` —
 * nunca um sucesso simulado.
 */
import {
  isGrantablePermission,
  sanitizePermissions,
  type Authority,
  type DenialReason,
  type GrantablePermissionId,
} from '../../domain/authorization.ts'

export interface ManagedMember {
  readonly uid: string
  readonly email: string | null
  readonly status: 'active' | 'inactive'
  readonly isAdministrator: boolean
  readonly canManagePermissions: boolean
  readonly permissions: readonly GrantablePermissionId[]
}

export interface MemberDirectory {
  readonly oscId: string
  readonly organizationName: string
  readonly commercialStatus: string
  readonly readOnly: boolean
  readonly viewerAuthority: Authority
  readonly members: readonly ManagedMember[]
}

export type MutationAction = 'grant-permission' | 'revoke-permission' | 'grant-delegation' | 'revoke-delegation'

export interface MutationRequest {
  readonly oscId: string
  readonly targetUid: string
  readonly action: MutationAction
  readonly permission?: GrantablePermissionId
}

export type PermissionsApiError = 'unavailable' | 'network' | 'session-expired' | 'forbidden' | 'invalid-request' | 'unknown'

export type ApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: PermissionsApiError; readonly reason?: DenialReason }

export interface PermissionsApi {
  listMembers(oscId: string): Promise<ApiResult<MemberDirectory>>
  mutate(request: MutationRequest): Promise<ApiResult<{ changed: boolean }>>
}

interface Dependencies {
  fetch: typeof globalThis.fetch
  /** Token de ID do usuário atual; `null` sem sessão. */
  getIdToken(): Promise<string | null>
  endpoint?: string
}

const AUTHORITIES: readonly Authority[] = ['administrator', 'delegate', 'member']

function parseMember(value: unknown): ManagedMember | null {
  if (typeof value !== 'object' || value === null) return null
  const m = value as Record<string, unknown>
  if (typeof m.uid !== 'string' || (m.status !== 'active' && m.status !== 'inactive')) return null
  return {
    uid: m.uid,
    email: typeof m.email === 'string' ? m.email : null,
    status: m.status,
    isAdministrator: m.isAdministrator === true,
    canManagePermissions: m.canManagePermissions === true,
    permissions: sanitizePermissions(m.permissions),
  }
}

function parseDirectory(body: Record<string, unknown>, oscId: string): MemberDirectory | null {
  const organization = body.organization as Record<string, unknown> | undefined
  const viewer = body.viewer as Record<string, unknown> | undefined
  if (body.oscId !== oscId || !organization || !viewer || !Array.isArray(body.members)) return null
  const authority = viewer.authority
  if (typeof authority !== 'string' || !(AUTHORITIES as readonly string[]).includes(authority)) return null
  return {
    oscId,
    organizationName: typeof organization.name === 'string' ? organization.name : oscId,
    commercialStatus: typeof organization.commercialStatus === 'string' ? organization.commercialStatus : 'unknown',
    readOnly: body.readOnly === true,
    viewerAuthority: authority as Authority,
    members: body.members.map(parseMember).filter((m): m is ManagedMember => m !== null),
  }
}

export function createPermissionsApi({ fetch, getIdToken, endpoint = '/api/osc-permissions' }: Dependencies): PermissionsApi {
  async function call(init: RequestInit, query = ''): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: PermissionsApiError; reason?: DenialReason }> {
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
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}`, Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
      })
    } catch {
      return { ok: false, error: 'network' }
    }

    // Função ausente/servidor de desenvolvimento costumam devolver HTML.
    if (!(response.headers.get('content-type') ?? '').includes('application/json')) return { ok: false, error: 'unavailable' }
    let body: Record<string, unknown>
    try {
      body = (await response.json()) as Record<string, unknown>
    } catch {
      return { ok: false, error: 'unavailable' }
    }
    if (response.ok) return { ok: true, body }

    const reason = typeof body.reason === 'string' ? (body.reason as DenialReason) : undefined
    switch (response.status) {
      case 401:
        return { ok: false, error: 'session-expired' }
      case 403:
        return { ok: false, error: 'forbidden', reason }
      case 404:
        return reason ? { ok: false, error: 'forbidden', reason } : { ok: false, error: 'unavailable' }
      case 400:
        return { ok: false, error: 'invalid-request' }
      case 503:
        return { ok: false, error: 'unavailable' }
      default:
        return { ok: false, error: 'unknown' }
    }
  }

  return {
    async listMembers(oscId) {
      const result = await call({ method: 'GET' }, `?oscId=${encodeURIComponent(oscId)}`)
      if (!result.ok) return result
      const directory = parseDirectory(result.body, oscId)
      return directory ? { ok: true, data: directory } : { ok: false, error: 'unknown' }
    },
    async mutate(request) {
      const needsPermission = request.action === 'grant-permission' || request.action === 'revoke-permission'
      if (needsPermission && !isGrantablePermission(request.permission)) return { ok: false, error: 'invalid-request' }
      const body = needsPermission
        ? { oscId: request.oscId, targetUid: request.targetUid, action: request.action, permission: request.permission }
        : { oscId: request.oscId, targetUid: request.targetUid, action: request.action }
      const result = await call({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!result.ok) return result
      return { ok: true, data: { changed: result.body.changed === true } }
    },
  }
}
