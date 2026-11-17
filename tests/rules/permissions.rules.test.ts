/**
 * DEV-01.3 — Security Rules para permissões (PER-01, PER-02, PER-16, PER-17, PER-20 e
 * funções preparatórias). Executar com `npm run test:rules` (emuladores, projeto fictício).
 * Com controles positivos: os documentos existem e o dono consegue lê-los.
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { MEMBERS, OSCS, USERS, memberDocument, memberPath, oscDocument, oscPath } from '../support/organizationFixtures.ts'
import { PERMISSION_MEMBERS, PERMISSION_USERS } from '../support/permissionFixtures.ts'
import { PROJECT_ID, createTestEnvironment } from './setup.ts'

const ALFA = OSCS.ALFA.id
const operatorPath = memberPath({ oscId: ALFA, uid: PERMISSION_USERS.OPERATOR.uid })
const delegatePath = memberPath({ oscId: ALFA, uid: PERMISSION_USERS.DELEGATE.uid })

async function seed(env: RulesTestEnvironment) {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore()
    for (const osc of Object.values(OSCS)) await db.doc(oscPath(osc)).set(oscDocument(osc))
    for (const member of [...MEMBERS, ...PERMISSION_MEMBERS]) await db.doc(memberPath(member)).set(memberDocument(member))
    await db.doc(`oscs/${ALFA}/permissionEvents/evento-1`).set({ action: 'grant-permission', actorUid: USERS.MULTI.uid })
    assert.deepEqual((await db.doc(operatorPath).get()).data()?.permissions, ['partnerships.view'])
    assert.equal((await db.doc(`oscs/${ALFA}/permissionEvents/evento-1`).get()).exists, true)
  })
}

describe('Firestore — permissões individuais', () => {
  let env: RulesTestEnvironment
  before(async () => { env = await createTestEnvironment() })
  after(async () => { await env.cleanup() })
  beforeEach(() => seed(env))
  const as = (uid: string) => env.authenticatedContext(uid).firestore()

  test('PER-01 — usuário comum consulta apenas as próprias permissões', async () => {
    const own = await assertSucceeds(as(PERMISSION_USERS.OPERATOR.uid).doc(operatorPath).get())
    assert.deepEqual(own.data()?.permissions, ['partnerships.view'])
    const list = await assertSucceeds(
      as(PERMISSION_USERS.OPERATOR.uid).collectionGroup('members').where('uid', '==', PERMISSION_USERS.OPERATOR.uid).get(),
    )
    assert.equal(list.size, 1)
  })

  test('PER-02 — permissões de terceiros e a relação da OSC não são legíveis pelo cliente', async () => {
    // Controle: o delegado lê o próprio vínculo.
    await assertSucceeds(as(PERMISSION_USERS.DELEGATE.uid).doc(delegatePath).get())
    for (const uid of [PERMISSION_USERS.OPERATOR.uid, PERMISSION_USERS.DELEGATE.uid, USERS.MULTI.uid]) {
      const db = as(uid)
      await assertFails(db.collection(`oscs/${ALFA}/members`).get())
      await assertFails(db.collectionGroup('members').where('oscId', '==', ALFA).get())
      await assertFails(db.collectionGroup('members').where('canManagePermissions', '==', true).get())
      await assertFails(db.collection(`oscs/${ALFA}/permissionEvents`).get())
      await assertFails(db.doc(`oscs/${ALFA}/permissionEvents/evento-1`).get())
    }
    await assertFails(as(PERMISSION_USERS.OPERATOR.uid).doc(delegatePath).get())
    // Nem o administrador lê vínculos de terceiros diretamente (só pelo servidor).
    await assertFails(as(USERS.MULTI.uid).doc(operatorPath).get())
  })

  test('PER-16 — permissões de uma OSC não abrem dados de outra', async () => {
    await assertFails(as(PERMISSION_USERS.OPERATOR.uid).doc(oscPath(OSCS.BETA)).get())
    await assertFails(as(PERMISSION_USERS.DELEGATE.uid).doc(memberPath({ oscId: OSCS.BETA.id, uid: USERS.MULTI.uid })).get())
  })

  test('PER-17 — escritas diretas de permissões, delegação, administrador e auditoria são negadas', async () => {
    const attempts: [string, string, Record<string, unknown>][] = [
      [PERMISSION_USERS.OPERATOR.uid, operatorPath, { permissions: ['partnerships.view', 'financial.view'] }],
      [PERMISSION_USERS.OPERATOR.uid, operatorPath, { canManagePermissions: true }],
      [PERMISSION_USERS.DELEGATE.uid, delegatePath, { permissions: ['documents.view'] }],
      [PERMISSION_USERS.DELEGATE.uid, operatorPath, { permissions: ['documents.view'] }],
      [PERMISSION_USERS.DELEGATE.uid, operatorPath, { canManagePermissions: true }],
      [USERS.MULTI.uid, operatorPath, { permissions: ['documents.view'] }],
      [USERS.MULTI.uid, delegatePath, { canManagePermissions: false }],
      [PERMISSION_USERS.DELEGATE.uid, oscPath(OSCS.ALFA), { administratorUid: PERMISSION_USERS.DELEGATE.uid }],
      [USERS.MULTI.uid, oscPath(OSCS.ALFA), { commercialStatus: 'active' }],
    ]
    for (const [uid, path, data] of attempts) {
      await assertFails(as(uid).doc(path).update(data))
      await assertFails(as(uid).doc(path).set(data, { merge: true }))
    }
    await assertFails(as(USERS.MULTI.uid).collection(`oscs/${ALFA}/permissionEvents`).add({ action: 'grant-permission' }))
    await assertFails(as(USERS.MULTI.uid).doc(`oscs/${ALFA}/permissionEvents/evento-1`).delete())
    await assertFails(as(USERS.MULTI.uid).doc(`users/${USERS.MULTI.uid}/memberships/${ALFA}`).set({ canManagePermissions: true }))
    await env.withSecurityRulesDisabled(async (admin) => {
      const db = admin.firestore()
      assert.deepEqual((await db.doc(operatorPath).get()).data()?.permissions, ['partnerships.view'])
      assert.equal((await db.doc(operatorPath).get()).data()?.canManagePermissions, undefined)
      assert.equal((await db.doc(oscPath(OSCS.ALFA)).get()).data()?.administratorUid, USERS.MULTI.uid)
      assert.equal((await db.collection(`oscs/${ALFA}/permissionEvents`).get()).size, 1)
    })
  })

  test('PER-20 — Storage permanece integralmente bloqueado para administrador, delegado e operador', async () => {
    const rules = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8')
    assert.doesNotMatch(rules, /if (?!false)/)
    const bytes = new TextEncoder().encode('conteudo ficticio')
    await env.withSecurityRulesDisabled(async (admin) => {
      await admin.storage().ref(`oscs/${ALFA}/documentos/ata.pdf`).put(bytes)
    })
    for (const uid of [USERS.MULTI.uid, PERMISSION_USERS.DELEGATE.uid, PERMISSION_USERS.OPERATOR.uid]) {
      const storage = env.authenticatedContext(uid).storage()
      await assertFails(storage.ref(`oscs/${ALFA}/documentos/ata.pdf`).getMetadata())
      await assertFails(storage.ref(`oscs/${ALFA}/documentos/novo.pdf`).put(bytes).then())
    }
    await env.clearStorage()
  })
})

describe('Funções preparatórias hasPermission/canOperate (módulos futuros)', () => {
  // Sonda SOMENTE de teste: acrescenta ao texto real das regras um caminho que usa as funções.
  let env: RulesTestEnvironment
  before(async () => {
    const real = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')
    const probe = real.replace(
      /(match \/\{path=\*\*\}\/members\/\{memberUid\} \{[\s\S]*?\n {4}\})/,
      `$1\n\n    match /sonda-teste/{oscId}/permissoes/{permission} {\n      allow get: if hasPermission(oscId, permission);\n    }`,
    )
    assert.notEqual(probe, real, 'sonda inserida')
    const [host = '127.0.0.1', port = ''] = (process.env.FIRESTORE_EMULATOR_HOST ?? '').split(':')
    env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { host, port: Number(port), rules: probe } })
  })
  after(async () => { await env.cleanup() })
  beforeEach(async () => {
    await seed(env)
    await env.withSecurityRulesDisabled(async (admin) => {
      for (const p of ['partnerships.view', 'documents.view']) await admin.firestore().doc(`sonda-teste/${ALFA}/permissoes/${p}`).set({ ok: true })
      await admin.firestore().doc(`sonda-teste/${OSCS.BETA.id}/permissoes/partnerships.view`).set({ ok: true })
    })
  })
  const probe = (uid: string, permission: string, oscId = ALFA) =>
    env.authenticatedContext(uid).firestore().doc(`sonda-teste/${oscId}/permissoes/${permission}`).get()

  test('exige vínculo ativo, permissão concedida e OSC não suspensa; admin sem permissões implícitas', async () => {
    await assertSucceeds(probe(PERMISSION_USERS.OPERATOR.uid, 'partnerships.view'))
    await assertFails(probe(PERMISSION_USERS.OPERATOR.uid, 'documents.view'))
    await assertFails(probe(USERS.MULTI.uid, 'partnerships.view'))
    await assertFails(probe(PERMISSION_USERS.DELEGATE.uid, 'partnerships.view'))
    await assertFails(probe(PERMISSION_USERS.FORMER.uid, 'documents.view'))
    await assertFails(probe(PERMISSION_USERS.OPERATOR.uid, 'partnerships.view', OSCS.BETA.id))
    await env.withSecurityRulesDisabled(async (admin) => {
      await admin.firestore().doc(oscPath(OSCS.ALFA)).update({ commercialStatus: 'suspended' })
    })
    await assertFails(probe(PERMISSION_USERS.OPERATOR.uid, 'partnerships.view'))
  })
})
