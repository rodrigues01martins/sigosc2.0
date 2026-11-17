/**
 * Firestore SIMULADO para o serviço de organizações (DEV-01.2) — `npm test`.
 * Dados fictícios em memória; sem rede. NÃO valida Security Rules (isso é
 * feito nos emuladores, `npm run test:rules`). Registra cada chamada.
 */
import type { OrganizationsSdk } from '../../src/services/organizations/organizationService.ts'
import type { RawDocument } from '../../src/services/organizations/parsing.ts'
import { MEMBERS, OSCS, memberDocument, memberPath, oscDocument, oscPath } from './organizationFixtures.ts'

export interface FakeDb {
  readonly kind: 'fake-firestore'
}

export function firestoreError(code: string, message = 'detalhe interno do projeto'): Error {
  return Object.assign(new Error(message), { code, name: 'FirebaseError' })
}

export function createFakeOrganizationsSdk() {
  const db: FakeDb = { kind: 'fake-firestore' }
  const docs = new Map<string, Record<string, unknown>>()
  for (const osc of Object.values(OSCS)) docs.set(oscPath(osc), oscDocument(osc))
  for (const member of MEMBERS) docs.set(memberPath(member), memberDocument(member))

  const calls: string[] = []
  const failures = new Map<keyof OrganizationsSdk<FakeDb>, unknown>()
  /** Atraso controlado (para testar respostas tardias). */
  let gate: Promise<void> | null = null

  const raw = (path: string): RawDocument | null => {
    const data = docs.get(path)
    return data ? { path, data: { ...data } } : null
  }
  const step = async (name: keyof OrganizationsSdk<FakeDb>, detail: string) => {
    calls.push(`${name}:${detail}`)
    if (gate) await gate
    if (failures.has(name)) throw failures.get(name)
  }

  const sdk: OrganizationsSdk<FakeDb> = {
    async listMembershipsByUid(_db, uid) {
      await step('listMembershipsByUid', uid)
      return [...docs.keys()]
        .filter((path) => /\/members\//.test(path) && docs.get(path)?.uid === uid)
        .map((path) => raw(path) as RawDocument)
    },
    async getMembership(_db, oscId, uid) {
      await step('getMembership', `${oscId}/${uid}`)
      return raw(`oscs/${oscId}/members/${uid}`)
    },
    async getOrganization(_db, oscId) {
      await step('getOrganization', oscId)
      return raw(`oscs/${oscId}`)
    },
  }

  return {
    db,
    sdk,
    calls,
    docs,
    fail: (name: keyof OrganizationsSdk<FakeDb>, error: unknown) => void failures.set(name, error),
    recover: () => failures.clear(),
    /** Pausa as respostas até `release()`. */
    hold() {
      let release!: () => void
      gate = new Promise<void>((resolve) => { release = resolve })
      return () => { gate = null; release() }
    },
  }
}
