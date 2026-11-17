/**
 * Adaptador do Cloud Firestore SDK modular (oficial) — DEV-01.2.
 *
 * Expõe SOMENTE três LEITURAS no servidor. Não há escrita, exclusão,
 * transação, listener em tempo real nem leitura global de `oscs`.
 */
import {
  collectionGroup,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  where,
  type Firestore,
} from 'firebase/firestore'
import type { OrganizationsSdk } from './organizationService.ts'
import type { RawDocument } from './parsing.ts'

export const firestoreOrganizationsSdk: OrganizationsSdk<Firestore> = {
  async listMembershipsByUid(db, uid) {
    const snapshot = await getDocsFromServer(query(collectionGroup(db, 'members'), where('uid', '==', uid)))
    return snapshot.docs.map((d): RawDocument => ({ path: d.ref.path, data: d.data() }))
  },
  async getMembership(db, oscId, uid) {
    const snapshot = await getDocFromServer(doc(db, 'oscs', oscId, 'members', uid))
    return snapshot.exists() ? { path: snapshot.ref.path, data: snapshot.data() } : null
  },
  async getOrganization(db, oscId) {
    const snapshot = await getDocFromServer(doc(db, 'oscs', oscId))
    return snapshot.exists() ? { path: snapshot.ref.path, data: snapshot.data() } : null
  },
}
