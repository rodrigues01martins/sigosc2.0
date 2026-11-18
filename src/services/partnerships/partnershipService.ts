/**
 * Consulta de parcerias da OSC ativa (DEV-02.1) — SOMENTE LEITURA, sempre no servidor.
 * O caminho `oscs/{oscId}/partnerships` isola a OSC; as Security Rules exigem vínculo ativo
 * e a permissão `partnerships.view`. Paginação por cursor, sem carregar todos os registros.
 */
import { mapFirestoreError } from '../organizations/errors.ts'
import type { RawDocument } from '../organizations/parsing.ts'
import { parsePartnership } from './parsing.ts'
import { PARTNERSHIP_ID_PATTERN, type Partnership, type PartnershipService } from './types.ts'

export const PAGE_SIZE = 25

/** Leituras do Firestore usadas pelo serviço — e somente elas (sem escrita). */
export interface PartnershipsSdk<TDb> {
  /** Até `limit` documentos ordenados por `createdAt` decrescente, após o cursor. */
  listPartnerships(db: TDb, oscId: string, limit: number, after: unknown): Promise<{ docs: RawDocument[]; cursors: unknown[] }>
  getPartnership(db: TDb, oscId: string, partnershipId: string): Promise<RawDocument | null>
}

const UNAVAILABLE = { ok: false, error: 'unknown' } as const

export function createPartnershipService<TDb>(db: TDb | null, sdk: PartnershipsSdk<TDb>, pageSize = PAGE_SIZE): PartnershipService {
  if (db === null) {
    return { available: false, listPage: () => Promise.resolve(UNAVAILABLE), get: () => Promise.resolve(UNAVAILABLE) }
  }
  const instance: TDb = db
  return {
    available: true,
    async listPage(oscId, cursor) {
      try {
        // Um registro a mais indica se há próxima página.
        const { docs, cursors } = await sdk.listPartnerships(instance, oscId, pageSize + 1, cursor ?? null)
        const page = docs.slice(0, pageSize)
        const items = page.map((raw) => parsePartnership(raw, oscId)).filter((p): p is Partnership => p !== null)
        const next = docs.length > pageSize ? (cursors[pageSize - 1] ?? null) : null
        return { ok: true, data: { items, next } }
      } catch (error) {
        return { ok: false, error: mapFirestoreError(error) }
      }
    },
    async get(oscId, partnershipId) {
      // Identificadores fora do formato (ex.: caminhos manipulados na URL) não são consultados.
      if (!PARTNERSHIP_ID_PATTERN.test(partnershipId)) return { ok: true, data: null }
      try {
        const raw = await sdk.getPartnership(instance, oscId, partnershipId)
        return { ok: true, data: raw ? parsePartnership(raw, oscId) : null }
      } catch (error) {
        return { ok: false, error: mapFirestoreError(error) }
      }
    },
  }
}
