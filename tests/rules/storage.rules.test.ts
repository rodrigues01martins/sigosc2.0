/**
 * DEV-00.8 — Testes de negação integral do Cloud Storage (S06–S10).
 * Executar com `npm run test:rules` (emulador local, projeto fictício).
 * Nenhum arquivo é enviado ao Storage real.
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { USER_OSC_A, USER_OSC_B, createTestEnvironment } from './setup.ts'

/** Arquivos fictícios em caminhos representativos de OSCs diferentes. */
const FILES = [
  'oscs/osc-a/documentos/estatuto.pdf',
  'oscs/osc-b/documentos/estatuto.pdf',
  'oscs/osc-a/parcerias/parceria-001/prestacao-contas.pdf',
  `usuarios/${USER_OSC_A.uid}/foto.png`,
  'publico/logo.png',
] as const

const FOLDERS = ['', 'oscs', 'oscs/osc-a/documentos', 'oscs/osc-b/documentos', 'publico'] as const

const BYTES = new TextEncoder().encode('conteudo ficticio de teste')

let env: RulesTestEnvironment

before(async () => { env = await createTestEnvironment() })
after(async () => { await env.cleanup() })

/** Preparação com acesso privilegiado do emulador — só para criar arquivos fictícios. */
beforeEach(async () => {
  await env.clearStorage()
  await env.withSecurityRulesDisabled(async (admin) => {
    const storage = admin.storage()
    for (const path of FILES) await storage.ref(path).put(BYTES, { contentType: 'application/octet-stream' })
    // Controle positivo: os arquivos existem.
    for (const path of FILES) assert.equal((await storage.ref(path).getMetadata()).fullPath, path)
  })
})

const contexts = () => ({
  anonimo: env.unauthenticatedContext().storage(),
  oscA: env.authenticatedContext(USER_OSC_A.uid, USER_OSC_A.claims).storage(),
  oscB: env.authenticatedContext(USER_OSC_B.uid, USER_OSC_B.claims).storage(),
})

/** Converte a tarefa de upload (thenable) em Promise. */
const upload = async (task: PromiseLike<unknown>) => { await task }

describe('Cloud Storage — negação integral', () => {
  test('S06 — download não autenticado é negado (URL e metadados)', async () => {
    const { anonimo } = contexts()
    for (const path of FILES) {
      await assertFails(anonimo.ref(path).getDownloadURL())
      await assertFails(anonimo.ref(path).getMetadata())
    }
  })

  test('S07 — upload não autenticado é negado (novo arquivo e sobrescrita)', async () => {
    const { anonimo } = contexts()
    await assertFails(upload(anonimo.ref('oscs/osc-a/documentos/novo.pdf').put(BYTES)))
    await assertFails(upload(anonimo.ref('publico/novo.png').putString('x')))
    for (const path of FILES) await assertFails(upload(anonimo.ref(path).put(BYTES)))
  })

  test('S08 — download autenticado é negado, inclusive arquivos da própria OSC e do próprio usuário', async () => {
    const { oscA, oscB } = contexts()
    for (const storage of [oscA, oscB]) {
      for (const path of FILES) {
        await assertFails(storage.ref(path).getDownloadURL())
        await assertFails(storage.ref(path).getMetadata())
      }
    }
  })

  test('S09 — upload autenticado é negado (própria OSC, outra OSC e pasta do usuário)', async () => {
    const { oscA, oscB } = contexts()
    for (const storage of [oscA, oscB]) {
      await assertFails(upload(storage.ref('oscs/osc-a/documentos/novo.pdf').put(BYTES)))
      await assertFails(upload(storage.ref('oscs/osc-b/documentos/novo.pdf').put(BYTES)))
      for (const path of FILES) await assertFails(upload(storage.ref(path).put(BYTES)))
    }
    await assertFails(upload(oscA.ref(`usuarios/${USER_OSC_A.uid}/nova-foto.png`).put(BYTES)))
  })

  test('S10 — exclusão, listagem e alteração de metadados são negadas', async () => {
    const { anonimo, oscA, oscB } = contexts()
    for (const storage of [anonimo, oscA, oscB]) {
      for (const path of FILES) {
        await assertFails(storage.ref(path).delete())
        await assertFails(storage.ref(path).updateMetadata({ contentType: 'text/plain' }))
      }
      for (const folder of FOLDERS) {
        await assertFails(storage.ref(folder).listAll())
        await assertFails(storage.ref(folder).list({ maxResults: 10 }))
      }
    }
    // Os arquivos continuam existindo após as tentativas.
    await env.withSecurityRulesDisabled(async (admin) => {
      for (const path of FILES) assert.equal((await admin.storage().ref(path).getMetadata()).fullPath, path)
    })
  })
})
