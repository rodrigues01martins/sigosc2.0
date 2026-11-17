/**
 * DEV-01.2 — Testes de segurança Multi-Tenant (MT01–MT12).
 * Executar com `npm run test:rules` (emuladores locais, projeto fictício `demo-sigosc-rules`).
 *
 * Cada negação é acompanhada de CONTROLE POSITIVO: o documento existe (verificado
 * com acesso administrativo do emulador) e, quando aplicável, o mesmo acesso é
 * permitido ao usuário autorizado — a negação não decorre de dados ausentes.
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  MEMBERS,
  OSCS,
  USERS,
  memberDocument,
  memberPath,
  oscDocument,
  oscPath,
} from '../support/organizationFixtures.ts'
import { createTestEnvironment } from './setup.ts'

let env: RulesTestEnvironment

before(async () => { env = await createTestEnvironment() })
after(async () => { await env.cleanup() })

const OTHER_PATHS = ['configuracoes/sistema', 'oscs/osc-alfa/parcerias/p-001', `users/${USERS.MULTI.uid}/memberships/osc-alfa`]

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore()
    for (const osc of Object.values(OSCS)) await db.doc(oscPath(osc)).set(oscDocument(osc))
    for (const member of MEMBERS) await db.doc(memberPath(member)).set(memberDocument(member))
    for (const path of OTHER_PATHS) await db.doc(path).set({ ficticio: true })
    // Controle positivo: todos os dados de teste existem.
    for (const osc of Object.values(OSCS)) assert.equal((await db.doc(oscPath(osc)).get()).exists, true)
    for (const member of MEMBERS) assert.equal((await db.doc(memberPath(member)).get()).exists, true)
    for (const path of OTHER_PATHS) assert.equal((await db.doc(path).get()).exists, true)
  })
})

const as = (uid: string) => env.authenticatedContext(uid).firestore()
const anonymous = () => env.unauthenticatedContext().firestore()
const myMemberships = (uid: string) => as(uid).collectionGroup('members').where('uid', '==', uid)

describe('Firestore — estrutura Multi-Tenant', () => {
  test('MT01 — usuário autenticado consulta o próprio vínculo (ativo e inativo) e lista os seus', async () => {
    const db = as(USERS.MULTI.uid)
    const active = await assertSucceeds(db.doc(memberPath({ oscId: OSCS.ALFA.id, uid: USERS.MULTI.uid })).get())
    assert.equal(active.data()?.status, 'active')
    const inactive = await assertSucceeds(db.doc(memberPath({ oscId: OSCS.GAMA.id, uid: USERS.MULTI.uid })).get())
    assert.equal(inactive.data()?.status, 'inactive')
    const list = await assertSucceeds(myMemberships(USERS.MULTI.uid).get())
    assert.deepEqual(list.docs.map((d) => d.ref.parent.parent?.id).sort(), ['osc-alfa', 'osc-beta', 'osc-delta', 'osc-gama'])
    // Usuário sem vínculos: consulta permitida, resultado vazio.
    const none = await assertSucceeds(myMemberships(USERS.NONE.uid).get())
    assert.equal(none.size, 0)
  })

  test('MT02 — usuário não autenticado não consulta vínculos nem OSCs', async () => {
    const db = anonymous()
    for (const member of MEMBERS) await assertFails(db.doc(memberPath(member)).get())
    await assertFails(db.collectionGroup('members').where('uid', '==', USERS.MULTI.uid).get())
    await assertFails(db.collectionGroup('members').get())
    for (const osc of Object.values(OSCS)) await assertFails(db.doc(oscPath(osc)).get())
  })

  test('MT03 — usuário não consulta vínculo de terceiros (controle: o dono consegue)', async () => {
    const target = memberPath({ oscId: OSCS.GAMA.id, uid: USERS.SINGLE.uid })
    await assertSucceeds(as(USERS.SINGLE.uid).doc(target).get())
    // MULTI tem vínculo (inativo) na mesma OSC, mas não lê o vínculo de SINGLE.
    await assertFails(as(USERS.MULTI.uid).doc(target).get())
    await assertFails(as(USERS.NONE.uid).doc(target).get())
    await assertFails(as(USERS.MULTI.uid).collectionGroup('members').where('uid', '==', USERS.SINGLE.uid).get())
    await assertFails(as(USERS.MULTI.uid).collection(`oscs/${OSCS.ALFA.id}/members`).get())
  })

  test('MT04 — vínculo ativo autoriza a leitura da própria OSC', async () => {
    const alfa = await assertSucceeds(as(USERS.MULTI.uid).doc(oscPath(OSCS.ALFA)).get())
    assert.equal(alfa.data()?.name, OSCS.ALFA.name)
    assert.equal(alfa.data()?.administratorUid, USERS.MULTI.uid)
    await assertSucceeds(as(USERS.MULTI.uid).doc(oscPath(OSCS.BETA)).get())
    await assertSucceeds(as(USERS.SINGLE.uid).doc(oscPath(OSCS.GAMA)).get())
  })

  test('MT05 — sem vínculo não há leitura da OSC (controle: membro ativo consegue)', async () => {
    await assertSucceeds(as(USERS.MULTI.uid).doc(oscPath(OSCS.ALFA)).get())
    await assertFails(as(USERS.SINGLE.uid).doc(oscPath(OSCS.ALFA)).get())
    await assertFails(as(USERS.NONE.uid).doc(oscPath(OSCS.ALFA)).get())
    await assertFails(as(USERS.NONE.uid).doc(oscPath(OSCS.GAMA)).get())
  })

  test('MT06 — vínculo inativo não autoriza a leitura da OSC (controle: membro ativo consegue)', async () => {
    await assertSucceeds(as(USERS.SINGLE.uid).doc(oscPath(OSCS.GAMA)).get())
    await assertFails(as(USERS.MULTI.uid).doc(oscPath(OSCS.GAMA)).get())
    // Vínculo inconsistente (campo uid divergente do caminho) também não autoriza.
    await env.withSecurityRulesDisabled(async (admin) => {
      await admin.firestore().doc(memberPath({ oscId: OSCS.ALFA.id, uid: USERS.NONE.uid })).set(
        memberDocument({ oscId: OSCS.ALFA.id, uid: 'outro-uid', status: 'active', specialRole: null }),
      )
    })
    await assertFails(as(USERS.NONE.uid).doc(oscPath(OSCS.ALFA)).get())
  })

  test('MT07 — usuário não cria, altera ou exclui vínculos pelo cliente', async () => {
    const db = as(USERS.MULTI.uid)
    const own = memberPath({ oscId: OSCS.ALFA.id, uid: USERS.MULTI.uid })
    const inactiveOwn = memberPath({ oscId: OSCS.GAMA.id, uid: USERS.MULTI.uid })
    await assertFails(db.doc(own).update({ status: 'inactive' }))
    await assertFails(db.doc(inactiveOwn).update({ status: 'active' }))
    await assertFails(db.doc(inactiveOwn).set(memberDocument({ oscId: OSCS.GAMA.id, uid: USERS.MULTI.uid, status: 'active', specialRole: null })))
    await assertFails(db.doc(own).delete())
    const none = as(USERS.NONE.uid)
    await assertFails(none.doc(memberPath({ oscId: OSCS.ALFA.id, uid: USERS.NONE.uid })).set(
      memberDocument({ oscId: OSCS.ALFA.id, uid: USERS.NONE.uid, status: 'active', specialRole: null }),
    ))
    await assertFails(none.collection(`oscs/${OSCS.ALFA.id}/members`).add({ uid: USERS.NONE.uid, status: 'active' }))
    await assertFails(anonymous().doc(own).delete())
    // Vínculos inalterados.
    await env.withSecurityRulesDisabled(async (admin) => {
      const db2 = admin.firestore()
      assert.equal((await db2.doc(own).get()).data()?.status, 'active')
      assert.equal((await db2.doc(inactiveOwn).get()).data()?.status, 'inactive')
      assert.equal((await db2.doc(memberPath({ oscId: OSCS.ALFA.id, uid: USERS.NONE.uid })).get()).exists, false)
    })
  })

  test('MT08 — usuário não altera o administrador nem os dados da OSC', async () => {
    // Nem o administrador atual, nem membro ativo comum, nem terceiros.
    for (const uid of [USERS.MULTI.uid, USERS.SINGLE.uid, USERS.NONE.uid]) {
      const db = as(uid)
      await assertFails(db.doc(oscPath(OSCS.ALFA)).update({ administratorUid: uid }))
      await assertFails(db.doc(oscPath(OSCS.BETA)).update({ administratorUid: uid }))
      await assertFails(db.doc(oscPath(OSCS.ALFA)).set({ administratorUid: uid }, { merge: true }))
      await assertFails(db.doc(oscPath(OSCS.ALFA)).delete())
      await assertFails(db.doc('oscs/osc-nova').set({ id: 'osc-nova', name: 'x', administratorUid: uid }))
    }
    await assertFails(as(USERS.MULTI.uid).doc(memberPath({ oscId: OSCS.BETA.id, uid: USERS.MULTI.uid })).update({ specialRole: 'administrator' }))
    await env.withSecurityRulesDisabled(async (admin) => {
      const alfa = (await admin.firestore().doc(oscPath(OSCS.ALFA)).get()).data()
      assert.equal(alfa?.administratorUid, USERS.MULTI.uid)
      assert.equal((await admin.firestore().doc(oscPath(OSCS.BETA)).get()).data()?.administratorUid, null)
      assert.equal((await admin.firestore().doc('oscs/osc-nova').get()).exists, false)
    })
  })

  test('MT09 — vínculos em duas OSCs mantêm acessos independentes', async () => {
    const db = as(USERS.MULTI.uid)
    await assertSucceeds(db.doc(oscPath(OSCS.ALFA)).get())
    await assertSucceeds(db.doc(oscPath(OSCS.BETA)).get())
    // Desvinculação (inativação) em BETA não afeta ALFA.
    await env.withSecurityRulesDisabled(async (admin) => {
      await admin.firestore().doc(memberPath({ oscId: OSCS.BETA.id, uid: USERS.MULTI.uid })).update({ status: 'inactive' })
    })
    await assertFails(db.doc(oscPath(OSCS.BETA)).get())
    await assertSucceeds(db.doc(oscPath(OSCS.ALFA)).get())
    // Ser administrador de ALFA não dá acesso a GAMA (vínculo inativo) nem a dados internos de ALFA.
    await assertFails(db.doc(oscPath(OSCS.GAMA)).get())
    await assertFails(db.doc('oscs/osc-alfa/parcerias/p-001').get())
  })

  test('MT10 — não há leitura global das OSCs', async () => {
    for (const uid of [USERS.MULTI.uid, USERS.SINGLE.uid, USERS.NONE.uid]) {
      const db = as(uid)
      await assertFails(db.collection('oscs').get())
      await assertFails(db.collection('oscs').where('registrationStatus', '==', 'active').get())
      await assertFails(db.collection('oscs').where('administratorUid', '==', uid).get())
      await assertFails(db.collectionGroup('members').get())
      await assertFails(db.collectionGroup('members').where('status', '==', 'active').get())
    }
    // Controle positivo: as OSCs existem e são listáveis administrativamente.
    await env.withSecurityRulesDisabled(async (admin) => {
      assert.equal((await admin.firestore().collection('oscs').get()).size, 4)
    })
  })

  test('MT11 — demais caminhos do Firestore permanecem bloqueados', async () => {
    for (const db of [as(USERS.MULTI.uid), as(USERS.NONE.uid), anonymous()]) {
      for (const path of OTHER_PATHS) {
        await assertFails(db.doc(path).get())
        await assertFails(db.doc(path).set({ alterado: true }))
        await assertFails(db.doc(path).delete())
      }
      await assertFails(db.collection('users').get())
      await assertFails(db.collectionGroup('parcerias').get())
      await assertFails(db.collectionGroup('memberships').get())
    }
  })

  test('MT12 — Storage permanece integralmente bloqueado, inclusive para membros ativos', async () => {
    const rules = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8')
    assert.match(rules, /allow read, write: if false;/)
    assert.doesNotMatch(rules, /if (?!false)/)
    const bytes = new TextEncoder().encode('conteudo ficticio')
    await env.withSecurityRulesDisabled(async (admin) => {
      await admin.storage().ref('oscs/osc-alfa/documentos/estatuto.pdf').put(bytes)
    })
    const storage = env.authenticatedContext(USERS.MULTI.uid).storage()
    await assertFails(storage.ref('oscs/osc-alfa/documentos/estatuto.pdf').getMetadata())
    await assertFails(storage.ref('oscs/osc-alfa/documentos/novo.pdf').put(bytes).then())
    await assertFails(storage.ref('oscs/osc-alfa/documentos').listAll())
    await env.clearStorage()
  })
})
