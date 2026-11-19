/** DEV-02.4 — leitura de números digitados (padrão brasileiro) e estados de informação. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseNumber, toNumber, toText } from './componentForm.ts'

test('DEV-02.4-T08 — "1.200" = 1200; "12,5" = 12,5; "0" = zero informado; vazio = não informado', () => {
  for (const [raw, expected] of [['1.200', 1200], ['1.234.567,89', 1234567.89], ['12,5', 12.5], ['12.5', 12.5], ['0', 0], ['-3', -3], [' 80 ', 80]] as const) assert.equal(parseNumber(raw), expected, raw)
  for (const raw of ['1,2,3', 'abc', '1e3', '12.34.5', '1..2']) assert.equal(parseNumber(raw), 'invalid', raw)
  assert.equal(parseNumber(''), null)
  assert.deepEqual(toNumber({ text: '0', na: false }), { state: 'informed', value: 0 })
  assert.deepEqual(toNumber({ text: '', na: false }), { state: 'not-informed' })
  assert.deepEqual(toNumber({ text: '5', na: true }), { state: 'not-applicable' })
  assert.deepEqual(toText({ text: '   ', na: false }), { state: 'not-informed' })
})
