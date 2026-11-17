/**
 * Operações privilegiadas de permissões (DEV-01.3) — AMBIENTE CONFIÁVEL (servidor).
 *
 * O Firebase Admin SDK IGNORA as Security Rules. Por isso, toda autorização é
 * implementada EXPLICITAMENTE aqui, a cada requisição:
 *  1. Token de ID verificado (assinatura, expiração, projeto e revogação).
 *  2. OSC e alvo identificados por parâmetros validados (formato estrito).
 *  3. Vínculo, administrador e delegação lidos AGORA do Firestore (nunca do cliente).
 *  4. Decisão pelo avaliador de domínio compartilhado (`src/domain/authorization.ts`).
 *  5. Escrita em TRANSAÇÃO (releitura em caso de concorrência), com autoria, data
 *     e evento de auditoria imutável.
 * Campos enviados pelo cliente além do esquema (ex.: papel, uid do solicitante)
 * são REJEITADOS.
 */
import { FieldValue, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore'
import {
  evaluate,
  isCommerciallySuspended,
  sanitizePermissions,
  type DenialReason,
  type GrantablePermissionId,
  type MembershipFacts,
  type Operation,
  type OrganizationFacts,
} from '../../src/domain/authorization.ts'
import { MAX_BODY_BYTES } from './limits.ts'

export interface ServerDeps {
  readonly db: Firestore
  /** Verifica o token de ID (inclusive revogação) e devolve o UID. Lança em caso de falha. */
  verifyIdToken(token: string): Promise<{ uid: string }>
  /** E-mails dos usuários (Auth), para identificação na gestão. */
  lookupEmails(uids: readonly string[]): Promise<Map<string, string | null>>
}

export interface ApiRequest {
  readonly method: string | undefined
  readonly authorization: string | undefined
  readonly query: URLSearchParams
  readonly rawBody: string
}

export interface ApiResponse {
  readonly status: number
  readonly body: Record<string, unknown>
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

const MUTATIONS = ['grant-permission', 'revoke-permission', 'grant-delegation', 'revoke-delegation'] as const
type MutationAction = (typeof MUTATIONS)[number]

interface MutationRequest {
  oscId: string
  targetUid: string
  action: MutationAction
  permission: string | null
}

const json = (status: number, body: Record<string, unknown>): ApiResponse => ({ status, body })
const DENIAL_STATUS = (reason: DenialReason) => (reason === 'target-not-member' ? 404 : 403)

// ---------------------------------------------------------------------------
// Leitura defensiva dos documentos (falha fechada)
// ---------------------------------------------------------------------------

export function organizationFacts(snap: DocumentSnapshot | undefined, oscId: string): OrganizationFacts | null {
  const data = snap?.exists ? snap.data() : undefined
  if (!data || data.id !== oscId) return null
  const { registrationStatus, commercialStatus, administratorUid } = data
  if (typeof registrationStatus !== 'string' || typeof commercialStatus !== 'string') return null
  if (administratorUid !== null && (typeof administratorUid !== 'string' || administratorUid === '')) return null
  return { id: oscId, registrationStatus, commercialStatus, administratorUid }
}

export function membershipFacts(snap: DocumentSnapshot | undefined, oscId: string, uid: string): MembershipFacts | null {
  const data = snap?.exists ? snap.data() : undefined
  if (!data || data.uid !== uid || data.oscId !== oscId) return null
  if (data.status !== 'active' && data.status !== 'inactive') return null
  return {
    uid,
    status: data.status,
    permissions: sanitizePermissions(data.permissions),
    canManagePermissions: data.canManagePermissions === true,
  }
}

// ---------------------------------------------------------------------------
// Validação da requisição
// ---------------------------------------------------------------------------

function parseMutation(rawBody: string): MutationRequest | null {
  if (rawBody.length === 0 || Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return null
  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const record = body as Record<string, unknown>
  const { oscId, targetUid, action, permission } = record
  if (typeof oscId !== 'string' || !ID_PATTERN.test(oscId)) return null
  if (typeof targetUid !== 'string' || !ID_PATTERN.test(targetUid)) return null
  if (typeof action !== 'string' || !(MUTATIONS as readonly string[]).includes(action)) return null
  const needsPermission = action === 'grant-permission' || action === 'revoke-permission'
  const allowedKeys = needsPermission ? ['oscId', 'targetUid', 'action', 'permission'] : ['oscId', 'targetUid', 'action']
  const keys = Object.keys(record)
  if (keys.length !== allowedKeys.length || !keys.every((k) => allowedKeys.includes(k))) return null
  if (needsPermission && typeof permission !== 'string') return null
  return { oscId, targetUid, action: action as MutationAction, permission: needsPermission ? (permission as string) : null }
}

function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header ?? '')
  return match?.[1] ?? null
}

function authErrorCode(error: unknown): 'session-expired' | 'invalid-token' {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  return /id-token-(expired|revoked)|user-disabled|user-not-found/.test(code) ? 'session-expired' : 'invalid-token'
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

/** P02 — relação de vínculos para gestão (administrador; delegado fora da suspensão). */
async function listMembers(deps: ServerDeps, uid: string, oscId: string): Promise<ApiResponse> {
  const oscRef = deps.db.doc(`oscs/${oscId}`)
  const actorRef = deps.db.doc(`oscs/${oscId}/members/${uid}`)
  const [oscSnap, actorSnap] = await deps.db.getAll(oscRef, actorRef)
  const organization = organizationFacts(oscSnap, oscId)
  const membership = membershipFacts(actorSnap, oscId, uid)
  const decision = evaluate({ uid, oscId, organization, membership }, { kind: 'list-members' })
  if ('reason' in decision || !organization) {
    return json(403, { error: 'forbidden', reason: 'reason' in decision ? decision.reason : 'no-membership' })
  }

  const snapshot = await deps.db.collection(`oscs/${oscId}/members`).get()
  const members = snapshot.docs
    .map((doc) => membershipFacts(doc, oscId, doc.id))
    .filter((m): m is MembershipFacts => m !== null)
  const emails = await deps.lookupEmails(members.map((m) => m.uid))

  return json(200, {
    oscId,
    organization: {
      name: typeof oscSnap?.data()?.name === 'string' ? oscSnap.data()?.name : oscId,
      registrationStatus: organization.registrationStatus,
      commercialStatus: organization.commercialStatus,
    },
    viewer: { uid, authority: decision.authority },
    readOnly: isCommerciallySuspended(organization),
    members: members.map((m) => ({
      uid: m.uid,
      email: emails.get(m.uid) ?? null,
      status: m.status,
      isAdministrator: organization.administratorUid === m.uid,
      canManagePermissions: m.canManagePermissions,
      permissions: m.permissions,
    })),
  })
}

class Denied extends Error {
  readonly reason: DenialReason
  constructor(reason: DenialReason) {
    super(reason)
    this.reason = reason
  }
}

/** P03–P06 — concessão/revogação de permissão ou delegação, em transação. */
async function mutate(deps: ServerDeps, uid: string, request: MutationRequest): Promise<ApiResponse> {
  const { oscId, targetUid, action, permission } = request
  const oscRef = deps.db.doc(`oscs/${oscId}`)
  const actorRef = deps.db.doc(`oscs/${oscId}/members/${uid}`)
  const targetRef = deps.db.doc(`oscs/${oscId}/members/${targetUid}`)

  try {
    const result = await deps.db.runTransaction(async (tx) => {
      const refs = targetUid === uid ? [oscRef, actorRef] : [oscRef, actorRef, targetRef]
      const [oscSnap, actorSnap, targetSnap = actorSnap] = await tx.getAll(...refs)
      const organization = organizationFacts(oscSnap, oscId)
      const membership = membershipFacts(actorSnap, oscId, uid)
      const target = membershipFacts(targetSnap, oscId, targetUid)

      const operation: Operation =
        action === 'grant-permission' || action === 'revoke-permission'
          ? { kind: action, target, permission }
          : { kind: action, target }
      const decision = evaluate({ uid, oscId, organization, membership }, operation)
      if ('reason' in decision) throw new Denied(decision.reason)
      if (!target) throw new Denied('target-not-member')

      const before = { permissions: [...target.permissions], canManagePermissions: target.canManagePermissions }
      const after = { ...before }
      if (action === 'grant-permission' || action === 'revoke-permission') {
        const set = new Set<string>(target.permissions)
        if (action === 'grant-permission') set.add(permission as GrantablePermissionId)
        else set.delete(permission as GrantablePermissionId)
        after.permissions = sanitizePermissions([...set])
      } else {
        after.canManagePermissions = action === 'grant-delegation'
      }

      const changed =
        after.canManagePermissions !== before.canManagePermissions ||
        after.permissions.join() !== before.permissions.join()
      if (!changed) return { changed: false, after }

      const now = FieldValue.serverTimestamp()
      const updates: Record<string, unknown> = { updatedAt: now, updatedBy: uid }
      if (action.endsWith('-permission')) {
        Object.assign(updates, { permissions: after.permissions, permissionsUpdatedAt: now, permissionsUpdatedBy: uid })
      } else {
        Object.assign(updates, { canManagePermissions: after.canManagePermissions, delegationUpdatedAt: now, delegationUpdatedBy: uid })
      }
      tx.update(targetRef, updates)
      tx.create(deps.db.collection(`oscs/${oscId}/permissionEvents`).doc(), {
        action,
        permission,
        oscId,
        actorUid: uid,
        actorAuthority: decision.authority,
        targetUid,
        before,
        after,
        at: now,
      })
      return { changed: true, after }
    })
    return json(200, { ok: true, changed: result.changed, member: { uid: targetUid, ...result.after } })
  } catch (error) {
    if (error instanceof Denied) return json(DENIAL_STATUS(error.reason), { error: 'forbidden', reason: error.reason })
    throw error
  }
}

/** Ponto de entrada independente de plataforma (testável sem a Vercel). */
export async function handlePermissionsRequest(request: ApiRequest, deps: ServerDeps | null): Promise<ApiResponse> {
  if (deps === null) return json(503, { error: 'not-configured' })
  if (request.method !== 'GET' && request.method !== 'POST') return json(405, { error: 'method-not-allowed' })

  const token = bearerToken(request.authorization)
  if (!token) return json(401, { error: 'invalid-token' })
  let uid: string
  try {
    uid = (await deps.verifyIdToken(token)).uid
  } catch (error) {
    return json(401, { error: authErrorCode(error) })
  }

  try {
    if (request.method === 'GET') {
      const oscId = request.query.get('oscId')
      if (!oscId || !ID_PATTERN.test(oscId) || [...request.query.keys()].some((k) => k !== 'oscId')) {
        return json(400, { error: 'invalid-request' })
      }
      return await listMembers(deps, uid, oscId)
    }
    const mutation = parseMutation(request.rawBody)
    if (!mutation) return json(400, { error: 'invalid-request' })
    return await mutate(deps, uid, mutation)
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown'
    console.error(`[osc-permissions] falha interna (${code})`)
    return json(500, { error: 'internal' })
  }
}
