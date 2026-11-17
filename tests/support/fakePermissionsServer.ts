/**
 * Servidor de permissões SIMULADO (DEV-01.3) para testes de interface.
 * Mantém sua PRÓPRIA verdade (independente do estado React) e decide com o
 * mesmo avaliador de domínio usado pelo servidor real. Não é o servidor real:
 * este é verificado em `npm run test:server` (Admin SDK + emuladores).
 */
import {
  evaluate,
  isCommerciallySuspended,
  sanitizePermissions,
  type MembershipFacts,
  type OrganizationFacts,
} from '../../src/domain/authorization.ts'
import type { ManagedMember, PermissionsApi, PermissionsApiError } from '../../src/services/permissions/permissionsApi.ts'

export type FakeServerMember = { -readonly [K in keyof MembershipFacts]: MembershipFacts[K] } & {
  email: string | null
}

export function createFakePermissionsServer(organizations: OrganizationFacts[], members: Record<string, FakeServerMember[]>) {
  const orgs = new Map(organizations.map((o) => [o.id, { ...o }]))
  const truth = new Map(Object.entries(members).map(([oscId, list]) => [oscId, new Map(list.map((m) => [m.uid, { ...m }]))]))
  const calls: string[] = []
  let failure: PermissionsApiError | null = null
  /** Quando definido, as alterações aguardam `release()` (testes de "processando"). */
  let gate: Promise<void> | null = null

  const facts = (oscId: string, uid: string) => truth.get(oscId)?.get(uid) ?? null

  function apiFor(actorUid: () => string | null): PermissionsApi {
    return {
      async listMembers(oscId) {
        calls.push(`list:${oscId}`)
        if (failure) return { ok: false, error: failure }
        const uid = actorUid()
        const organization = orgs.get(oscId) ?? null
        const decision = evaluate({ uid, oscId, organization, membership: uid ? facts(oscId, uid) : null }, { kind: 'list-members' })
        if (!decision.allowed || !organization) return { ok: false, error: 'forbidden', reason: decision.allowed ? 'no-membership' : decision.reason }
        const list: ManagedMember[] = [...(truth.get(oscId)?.values() ?? [])].map((m) => ({
          uid: m.uid,
          email: m.email,
          status: m.status,
          isAdministrator: organization.administratorUid === m.uid,
          canManagePermissions: m.canManagePermissions,
          permissions: m.permissions,
        }))
        return {
          ok: true,
          data: {
            oscId,
            organizationName: oscId,
            commercialStatus: organization.commercialStatus,
            readOnly: isCommerciallySuspended(organization),
            viewerAuthority: decision.authority,
            members: list,
          },
        }
      },
      async mutate(request) {
        calls.push(`${request.action}:${request.targetUid}:${request.permission ?? ''}`)
        if (gate) await gate
        if (failure) return { ok: false, error: failure }
        const uid = actorUid()
        const organization = orgs.get(request.oscId) ?? null
        const target = facts(request.oscId, request.targetUid)
        const operation =
          request.action === 'grant-permission' || request.action === 'revoke-permission'
            ? ({ kind: request.action, target, permission: request.permission } as const)
            : ({ kind: request.action, target } as const)
        const decision = evaluate({ uid, oscId: request.oscId, organization, membership: uid ? facts(request.oscId, uid) : null }, operation)
        if (!decision.allowed) return { ok: false, error: 'forbidden', reason: decision.reason }
        if (!target) return { ok: false, error: 'forbidden', reason: 'target-not-member' }
        const stored = truth.get(request.oscId)?.get(request.targetUid) as FakeServerMember
        if (request.action === 'grant-permission') stored.permissions = sanitizePermissions([...stored.permissions, request.permission])
        if (request.action === 'revoke-permission') stored.permissions = stored.permissions.filter((p) => p !== request.permission)
        if (request.action === 'grant-delegation') stored.canManagePermissions = true
        if (request.action === 'revoke-delegation') stored.canManagePermissions = false
        return {
          ok: true,
          data: { changed: true, member: { uid: stored.uid, permissions: [...stored.permissions], canManagePermissions: stored.canManagePermissions } },
        }
      },
    }
  }

  return {
    apiFor,
    calls,
    truth,
    orgs,
    fail: (error: PermissionsApiError | null) => { failure = error },
    hold() {
      let release!: () => void
      gate = new Promise<void>((resolve) => { release = resolve })
      return () => { gate = null; release() }
    },
  }
}
