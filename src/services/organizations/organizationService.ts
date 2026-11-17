/**
 * Serviço de consulta de vínculos e OSCs (DEV-01.2) — SOMENTE LEITURA.
 *
 * Estratégia de consulta (autorizável pelas Security Rules):
 * 1. `collectionGroup('members')` com `where('uid', '==', uid)` → apenas os
 *    vínculos do próprio usuário (a regra exige `resource.data.uid == request.auth.uid`).
 * 2. `get` individual de `oscs/{oscId}` SOMENTE para vínculos ativos
 *    (a regra exige vínculo ativo). Não há leitura global de `oscs`.
 *
 * Todas as leituras usam o servidor (nunca o cache), para que vínculos
 * revogados não sejam reutilizados.
 */
import { mapFirestoreError } from './errors.ts'
import { parseMember, parseOrganization, type ParsedMember, type RawDocument } from './parsing.ts'
import type {
  Membership,
  OrganizationResult,
  OrganizationService,
  OrganizationSummary,
  UnselectableReason,
} from './types.ts'

/** Leituras do Firestore usadas pelo serviço — e somente elas (sem escrita). */
export interface OrganizationsSdk<TDb> {
  listMembershipsByUid(db: TDb, uid: string): Promise<RawDocument[]>
  getMembership(db: TDb, oscId: string, uid: string): Promise<RawDocument | null>
  getOrganization(db: TDb, oscId: string): Promise<RawDocument | null>
}

const UNAVAILABLE = { ok: false, error: 'unknown' } as const

/** Ordena: selecionáveis primeiro, depois por nome/identificador. */
function compareMemberships(a: Membership, b: Membership): number {
  if (a.selectable !== b.selectable) return a.selectable ? -1 : 1
  const nameA = a.organization?.name ?? a.oscId
  const nameB = b.organization?.name ?? b.oscId
  return nameA.localeCompare(nameB, 'pt-BR')
}

export function createOrganizationService<TDb>(db: TDb | null, sdk: OrganizationsSdk<TDb>): OrganizationService {
  if (db === null) {
    return {
      available: false,
      loadMemberships: () => Promise.resolve(UNAVAILABLE),
      revalidateMembership: () => Promise.resolve(UNAVAILABLE),
    }
  }
  const instance: TDb = db

  /** Enriquece um vínculo. Vínculos inativos NÃO consultam a OSC. */
  async function toMembership(member: ParsedMember): Promise<Membership> {
    if (member.status !== 'active') {
      return build(member, null, 'membership-inactive')
    }
    let organization: OrganizationSummary | null = null
    try {
      const doc = await sdk.getOrganization(instance, member.oscId)
      organization = doc ? parseOrganization(doc, member.oscId) : null
    } catch (error) {
      const kind = mapFirestoreError(error)
      // Falha de rede invalida toda a consulta; negação/ausência torna só este vínculo indisponível.
      if (kind === 'network') throw error
    }
    if (organization === null) return build(member, null, 'organization-unavailable')
    if (organization.registrationStatus !== 'active') return build(member, organization, 'organization-not-active')
    return build(member, organization, null)
  }

  function build(
    member: ParsedMember,
    organization: OrganizationSummary | null,
    reason: UnselectableReason | null,
  ): Membership {
    return {
      oscId: member.oscId,
      status: member.status,
      organization,
      isAdministrator: member.status === 'active' && organization?.administratorUid === member.uid,
      selectable: reason === null,
      unselectableReason: reason,
    }
  }

  return {
    available: true,

    async loadMemberships(uid): Promise<OrganizationResult<Membership[]>> {
      try {
        const docs = await sdk.listMembershipsByUid(instance, uid)
        const seen = new Set<string>()
        const members: ParsedMember[] = []
        for (const doc of docs) {
          const member = parseMember(doc, uid)
          if (member && !seen.has(member.oscId)) {
            seen.add(member.oscId)
            members.push(member)
          }
        }
        const memberships = await Promise.all(members.map(toMembership))
        return { ok: true, data: memberships.sort(compareMemberships) }
      } catch (error) {
        return { ok: false, error: mapFirestoreError(error) }
      }
    },

    async revalidateMembership(uid, oscId): Promise<OrganizationResult<Membership | null>> {
      try {
        const doc = await sdk.getMembership(instance, oscId, uid)
        const member = doc ? parseMember(doc, uid) : null
        if (member === null || member.oscId !== oscId) return { ok: true, data: null }
        return { ok: true, data: await toMembership(member) }
      } catch (error) {
        return { ok: false, error: mapFirestoreError(error) }
      }
    },
  }
}
