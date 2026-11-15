/**
 * Teste com o Firebase Web SDK REAL em Node, configuração fictícia.
 * A criação das instâncias é local: nenhuma requisição é feita porque nenhuma
 * operação (leitura, gravação, login, upload) é executada.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps } from 'firebase/app'
import { initializeFirebaseServices } from './initialization.ts'
import { firebaseWebSdk } from './sdk.ts'

test('F03/F05 — SDK real cria e reutiliza instâncias sem duplicação', async () => {
  const options = {
    apiKey: 'fake-api-key',
    authDomain: 'projeto-ficticio.firebaseapp.com',
    projectId: 'projeto-ficticio',
    storageBucket: 'projeto-ficticio.appspot.com',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000',
  }
  const first = initializeFirebaseServices('valid', options, firebaseWebSdk)
  assert.deepEqual(first.diagnostics, {
    app: { state: 'initialized' },
    auth: { state: 'initialized' },
    firestore: { state: 'initialized' },
    storage: { state: 'initialized' },
  })
  const second = initializeFirebaseServices('valid', options, firebaseWebSdk)
  assert.equal(getApps().length, 1)
  assert.equal(second.app, first.app)
  assert.equal(second.auth, first.auth)
  assert.equal(second.firestore, first.firestore)
  assert.equal(second.storage, first.storage)
  if (first.app) await deleteApp(first.app)
})
