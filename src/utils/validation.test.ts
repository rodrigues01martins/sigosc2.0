/** Testes das validações de formulário (DEV-01.1) — `npm test`. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPasswordProvided, isValidEmail, normalizeEmail } from './validation.ts'

test('V01 — e-mail: formatos válidos e inválidos', () => {
  assert.equal(isValidEmail('pessoa@exemplo.org'), true)
  assert.equal(isValidEmail('  pessoa@exemplo.org  '), true)
  for (const invalid of ['', '   ', 'pessoa', 'pessoa@', '@exemplo.org', 'pessoa@exemplo', 'a b@exemplo.org']) {
    assert.equal(isValidEmail(invalid), false, invalid)
  }
  assert.equal(isValidEmail(`${'a'.repeat(250)}@x.org`), false)
})

test('V02 — senha: apenas exige preenchimento, sem normalização', () => {
  assert.equal(isPasswordProvided(''), false)
  assert.equal(isPasswordProvided(' '), true)
  assert.equal(normalizeEmail('  a@b.co '), 'a@b.co')
})
