/**
 * Adaptador do Cloud Firestore SDK modular — parcerias (DEV-02.1). SOMENTE LEITURAS
 * no servidor (nunca do cache). Não há escrita, exclusão ou listener em tempo real.
 */
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import type { PartnershipsSdk } from './partnershipService.ts'

export const firestorePartnershipsSdk: PartnershipsSdk<Firestore> = {
  async listPartnerships(db, oscId, size, after) {
    const base = collection(db, 'oscs', oscId, 'partnerships')
    const constraints = after
      ? [orderBy('createdAt', 'desc'), startAfter(after as QueryDocumentSnapshot), limit(size)]
      : [orderBy('createdAt', 'desc'), limit(size)]
    const snapshot = await getDocsFromServer(query(base, ...constraints))
    return { docs: snapshot.docs.map((d) => ({ path: d.ref.path, data: d.data() })), cursors: snapshot.docs }
  },
  async getPartnership(db, oscId, partnershipId) {
    const snapshot = await getDocFromServer(doc(db, 'oscs', oscId, 'partnerships', partnershipId))
    return snapshot.exists() ? { path: snapshot.ref.path, data: snapshot.data() } : null
  },
}
