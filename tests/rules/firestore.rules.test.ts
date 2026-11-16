/**
 * DEV-00.8 — Testes de negação integral do Cloud Firestore (S01–S05).
 * Executar com `npm run test:rules` (emulador local, projeto fictício).
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { USER_OSC_A, USER_OSC_B, createTestEnvironment } from './setup.ts'

/** Caminhos representativos: raiz, OSCs diferentes, subcoleções e documento do próprio usuário. */
const DOCS = [
  'configuracoes/sistema',
  'oscs/osc-a',
  'oscs/osc-b',
  'oscs/osc-a/parcerias/parceria-001',
  'oscs/osc-b/parcerias/parceria-002',
  `usuarios/${USER_OSC_A.uid}`,
] as const

const COLLECTIONS = ['oscs', 'oscs/osc-a/parcerias', 'oscs/osc-b/parcerias', 'usuarios'] as const

let env: RulesTestEnvironment

before(async () => { env = await createTestEnvironment() })
after(async () => { await env.cleanup() })

/** Preparação com acesso privilegiado do emulador (ignora regras) — só para criar dados fictícios. */
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore()
    for (const path of DOCS) await db.doc(path).set({ ficticio: true, caminho: path })
    // Controle positivo: os documentos existem, logo a negação não se deve à ausência de dados.
    for (const path of DOCS) assert.equal((await db.doc(path).get()).exists, true, path)
  })
})

const contexts = () => ({
  anonimo: env.unauthenticatedContext().firestore(),
  oscA: env.authenticatedContext(USER_OSC_A.uid, USER_OSC_A.claims).firestore(),
  oscB: env.authenticatedContext(USER_OSC_B.uid, USER_OSC_B.claims).firestore(),
})

describe('Cloud Firestore — negação integral', () => {
  test('S01 — leitura não autenticada é negada (get e list)', async () => {
    const { anonimo } = contexts()
    for (const path of DOCS) await assertFails(anonimo.doc(path).get())
    for (const path of COLLECTIONS) await assertFails(anonimo.collection(path).get())
    await assertFails(anonimo.collectionGroup('parcerias').get())
  })

  test('S02 — escrita não autenticada é negada (criação e atualização)', async () => {
    const { anonimo } = contexts()
    await assertFails(anonimo.doc('oscs/osc-nova').set({ nome: 'x' }))
    await assertFails(anonimo.collection('oscs/osc-a/parcerias').add({ nome: 'x' }))
    for (const path of DOCS) {
      await assertFails(anonimo.doc(path).update({ alterado: true }))
      await assertFails(anonimo.doc(path).set({ sobrescrito: true }))
    }
  })

  test('S03 — leitura autenticada é negada, inclusive na própria OSC e no próprio usuário', async () => {
    const { oscA, oscB } = contexts()
    for (const db of [oscA, oscB]) {
      for (const path of DOCS) await assertFails(db.doc(path).get())
      for (const path of COLLECTIONS) await assertFails(db.collection(path).get())
      await assertFails(db.collectionGroup('parcerias').get())
    }
    await assertFails(oscA.doc(`usuarios/${USER_OSC_A.uid}`).get())
    await assertFails(oscA.collection('oscs/osc-a/parcerias').where('ficticio', '==', true).get())
  })

  test('S04 — escrita autenticada é negada (própria OSC, outra OSC e raiz)', async () => {
    const { oscA, oscB } = contexts()
    for (const db of [oscA, oscB]) {
      await assertFails(db.doc('oscs/osc-nova').set({ nome: 'x' }))
      await assertFails(db.collection('oscs/osc-a/parcerias').add({ nome: 'x' }))
      await assertFails(db.collection('oscs/osc-b/parcerias').add({ nome: 'x' }))
      for (const path of DOCS) {
        await assertFails(db.doc(path).update({ alterado: true }))
        await assertFails(db.doc(path).set({ sobrescrito: true }, { merge: true }))
      }
    }
    await assertFails(oscA.doc(`usuarios/${USER_OSC_A.uid}`).set({ perfil: 'administrador' }))
    const batch = oscA.batch()
    batch.set(oscA.doc('oscs/osc-a/parcerias/lote'), { nome: 'x' })
    await assertFails(batch.commit())
  })

  test('S05 — exclusão de documentos é negada (anônimo e autenticado)', async () => {
    const { anonimo, oscA, oscB } = contexts()
    for (const db of [anonimo, oscA, oscB]) {
      for (const path of DOCS) await assertFails(db.doc(path).delete())
    }
    // Os documentos continuam existindo após as tentativas.
    await env.withSecurityRulesDisabled(async (admin) => {
      for (const path of DOCS) assert.equal((await admin.firestore().doc(path).get()).exists, true, path)
    })
  })
})
