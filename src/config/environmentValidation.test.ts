/**
 * Testes da validação de ambiente — executar com `npm test`.
 * Usa apenas o executor nativo do Node (node:test). Valores fictícios.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateEnvironmentConfig, type EnvironmentInput } from './environmentValidation.ts'

const firebaseBase = {
  VITE_FIREBASE_API_KEY: 'fake-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'fake.firebaseapp.com',
  VITE_FIREBASE_STORAGE_BUCKET: 'fake.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  VITE_FIREBASE_APP_ID: '1:000000000000:web:fake',
} satisfies EnvironmentInput

test('C01 — configuração correta de testes é válida', () => {
  const r = validateEnvironmentConfig({
    ...firebaseBase,
    VITE_FIREBASE_PROJECT_ID: 'projeto-testes',
    VITE_EXPECTED_FIREBASE_PROJECT_ID: 'projeto-testes',
    VITE_APP_ENV: 'test',
  })
  assert.equal(r.status, 'valid')
  assert.equal(r.environment, 'test')
  assert.deepEqual(r.missingKeys, [])
  assert.deepEqual(r.issues, [])
})

test('C02 — configuração correta de produção é válida', () => {
  const r = validateEnvironmentConfig({
    ...firebaseBase,
    VITE_FIREBASE_PROJECT_ID: 'projeto-producao',
    VITE_EXPECTED_FIREBASE_PROJECT_ID: 'projeto-producao',
    VITE_APP_ENV: 'production',
  })
  assert.equal(r.status, 'valid')
  assert.equal(r.environment, 'production')
})

test('C03 — projeto Firebase incorreto é incompatível', () => {
  const r = validateEnvironmentConfig({
    ...firebaseBase,
    VITE_FIREBASE_PROJECT_ID: 'projeto-producao',
    VITE_EXPECTED_FIREBASE_PROJECT_ID: 'projeto-testes',
    VITE_APP_ENV: 'test',
  })
  assert.equal(r.status, 'incompatible')
  assert.deepEqual(r.issues, ['project-id-mismatch'])
})

test('C03b — comparação de IDs é exata (maiúsculas/espaços divergem)', () => {
  const base = { ...firebaseBase, VITE_APP_ENV: 'test', VITE_EXPECTED_FIREBASE_PROJECT_ID: 'projeto-testes' }
  assert.equal(validateEnvironmentConfig({ ...base, VITE_FIREBASE_PROJECT_ID: 'Projeto-Testes' }).status, 'incompatible')
  assert.equal(validateEnvironmentConfig({ ...base, VITE_FIREBASE_PROJECT_ID: 'projeto-testes ' }).status, 'incompatible')
})

test('C04 — variáveis ausentes resultam em configuração incompleta', () => {
  const r = validateEnvironmentConfig({
    VITE_FIREBASE_API_KEY: 'fake-api-key',
    VITE_FIREBASE_PROJECT_ID: 'projeto-testes',
    VITE_FIREBASE_APP_ID: '   ',
    VITE_APP_ENV: 'test',
  })
  assert.equal(r.status, 'incomplete')
  assert.deepEqual(r.missingKeys, [
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_EXPECTED_FIREBASE_PROJECT_ID',
  ])
})

test('C04b — nenhuma variável definida é incompleta e sem ambiente', () => {
  const r = validateEnvironmentConfig({})
  assert.equal(r.status, 'incomplete')
  assert.equal(r.environment, null)
  assert.equal(r.missingKeys.length, 8)
})

test('C05 — ambiente inválido é incompatível', () => {
  for (const appEnv of ['staging', 'Production', 'TEST', 'prod']) {
    const r = validateEnvironmentConfig({
      ...firebaseBase,
      VITE_FIREBASE_PROJECT_ID: 'projeto-testes',
      VITE_EXPECTED_FIREBASE_PROJECT_ID: 'projeto-testes',
      VITE_APP_ENV: appEnv,
    })
    assert.equal(r.status, 'incompatible', appEnv)
    assert.equal(r.environment, null)
    assert.deepEqual(r.issues, ['invalid-app-env'])
  }
})

test('Precedência — incompatibilidade prevalece sobre ausência', () => {
  const r = validateEnvironmentConfig({ VITE_APP_ENV: 'staging' })
  assert.equal(r.status, 'incompatible')
  assert.deepEqual(r.issues, ['missing-variables', 'invalid-app-env'])
})
