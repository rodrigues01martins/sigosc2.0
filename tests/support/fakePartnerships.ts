/**
 * Parcerias SIMULADAS (DEV-02.1) para testes de interface — em memória, sem rede.
 * NÃO valida Security Rules (feito no emulador, `npm run test:rules`): reproduz apenas o
 * isolamento por CAMINHO (`oscs/{oscId}/partnerships`) e a ordenação/paginação.
 * O cadastro e a correção simulados, por padrão, GRAVAM no mapa em memória (como o servidor confirmaria),
 * sem decidir autorização — a autorização real é testada em tests/server com emuladores.
 */
import type { PartnershipsSdk } from '../../src/services/partnerships/partnershipService.ts'
import type { CreateRequest, CreateResult, PartnershipsApi, UpdateRequest, UpdateResult } from '../../src/services/partnerships/partnershipsApi.ts'
import type { RawDocument } from '../../src/services/organizations/parsing.ts'
import { PARTNERSHIPS, partnershipDocument, partnershipPath, type PartnershipFixture } from './partnershipFixtures.ts'

export interface FakePartnershipsDb {
  readonly kind: 'fake-partnerships'
}

export function createFakePartnerships(fixtures: PartnershipFixture[] = PARTNERSHIPS) {
  const db: FakePartnershipsDb = { kind: 'fake-partnerships' }
  const docs = new Map<string, Record<string, unknown>>()
  for (const p of fixtures) docs.set(partnershipPath(p), partnershipDocument(p))
  const calls: string[] = []
  const failures = new Map<'list' | 'get', unknown>()
  let gate: Promise<void> | null = null

  const step = async (name: 'list' | 'get', detail: string) => {
    calls.push(`${name}:${detail}`)
    if (gate) await gate
    if (failures.has(name)) throw failures.get(name)
  }

  const sdk: PartnershipsSdk<FakePartnershipsDb> = {
    async listPartnerships(_db, oscId, limit, after) {
      await step('list', `${oscId}:${after ? (after as { id: string }).id : 'inicio'}`)
      const prefix = `oscs/${oscId}/partnerships/`
      const ordered = [...docs.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .sort(([, a], [, b]) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
      const start = after ? ordered.findIndex(([path]) => path === `${prefix}${(after as { id: string }).id}`) + 1 : 0
      const page = ordered.slice(start, start + limit)
      return {
        docs: page.map(([path, data]): RawDocument => ({ path, data: { ...data } })),
        cursors: page.map(([path]) => ({ id: path.slice(prefix.length) })),
      }
    },
    async getPartnership(_db, oscId, id) {
      await step('get', `${oscId}/${id}`)
      const path = `oscs/${oscId}/partnerships/${id}`
      const data = docs.get(path)
      return data ? { path, data: { ...data } } : null
    },
  }

  const requests: CreateRequest[] = []
  const updates: UpdateRequest[] = []
  let sequence = 0
  let respond: (request: CreateRequest) => Promise<CreateResult> | CreateResult = (request) => {
    const id = `criada${++sequence}xxxxxxxxx`
    const now = new Date()
    docs.set(`oscs/${request.oscId}/partnerships/${id}`, {
      ...request.draft,
      schemaVersion: 2,
      id,
      oscId: request.oscId,
      administrativeStatusDeclaredAt: now,
      administrativeStatusDeclaredBy: 'simulado',
      workPlan: { approvalDeclared: true, document: 'not-incorporated' },
      revision: 1,
      createdAt: now,
      createdBy: 'simulado',
      updatedAt: now,
      updatedBy: 'simulado',
    })
    return { ok: true, id, created: true, warnings: {} }
  }
  let respondUpdate: (request: UpdateRequest) => Promise<UpdateResult> | UpdateResult = (request) => {
    const path = `oscs/${request.oscId}/partnerships/${request.partnershipId}`
    const current = docs.get(path)
    if (!current) return { ok: false, error: 'not-found' }
    const revision = (current.revision as number | undefined) ?? 1
    if (revision !== request.expectedRevision) return { ok: false, error: 'stale' }
    docs.set(path, { ...current, ...request.changes, revision: revision + 1, updatedAt: new Date() })
    return { ok: true, id: request.partnershipId, changed: true, revision: revision + 1 }
  }
  const api: PartnershipsApi = {
    async create(request) {
      requests.push(request)
      return respond(request)
    },
    async update(request) {
      updates.push(request)
      return respondUpdate(request)
    },
  }

  return {
    db,
    sdk,
    api,
    docs,
    calls,
    requests,
    updates,
    failures,
    respondWith(handler: typeof respond) {
      respond = handler
    },
    respondUpdateWith(handler: typeof respondUpdate) {
      respondUpdate = handler
    },
    hold() {
      let release!: () => void
      gate = new Promise((resolve) => (release = resolve))
      return () => {
        gate = null
        release()
      }
    },
  }
}
