/** DEV-02.1 — Serviço de consulta de parcerias (`npm test`). SDK simulado, sem rede. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createFakePartnerships } from '../../../tests/support/fakePartnerships.ts'
import { firestoreError } from '../../../tests/support/fakeOrganizationsSdk.ts'
import { PARTNERSHIPS } from '../../../tests/support/partnershipFixtures.ts'
import { parsePartnership } from './parsing.ts'
import { createPartnershipService } from './partnershipService.ts'
import { firestorePartnershipsSdk } from './sdk.ts'

test('Adaptador real de parcerias: somente duas LEITURAS no servidor (sem cache, escrita ou tempo real)', () => {
  assert.deepEqual(Object.keys(firestorePartnershipsSdk).sort(), ['getPartnership', 'listPartnerships'])
  const code = readFileSync(new URL('./sdk.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(code, /\b(setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction|onSnapshot|getDocs|getDoc|collectionGroup)\s*\(/)
  assert.match(code, /getDocsFromServer\(/)
  assert.match(code, /getDocFromServer\(/)
})

test('Paginação por cursor: página + 1 registro para saber se há mais', async () => {
  const fake = createFakePartnerships()
  const service = createPartnershipService(fake.db, fake.sdk, 2)
  const first = await service.listPage('osc-alfa', null)
  assert.ok(first.ok)
  assert.deepEqual(first.data.items.map((p) => p.id), ['pAlfaColaboracao06', 'pAlfaFomento02xxxxx'])
  assert.notEqual(first.data.next, null)
  const second = await service.listPage('osc-alfa', first.data.next)
  assert.ok(second.ok)
  assert.deepEqual(second.data.items.map((p) => p.id), ['pAlfaCooperacao01xx'])
  assert.equal(second.data.next, null)
})

test('DEV-02.1-T02/T08 — documentos de outra OSC ou fora do formato são descartados (falha fechada)', async () => {
  const gama = PARTNERSHIPS.find((p) => p.oscId === 'osc-gama')
  assert.ok(gama)
  const raw = { path: `oscs/osc-gama/partnerships/${gama.id}`, data: { oscId: 'osc-gama', instrument: 'termo-colaboracao' } }
  assert.equal(parsePartnership(raw, 'osc-alfa'), null)
  const base = { oscId: 'osc-alfa', instrument: 'termo-fomento', administrativeStatus: 'em-execucao', instrumentNumber: '1/2026', publicPartner: 'Órgão', object: 'Objeto fictício', formalizationDate: '2026-01-01', termStart: '2026-01-01', termEnd: '2027-01-01' }
  const path = 'oscs/osc-alfa/partnerships/x1'
  assert.ok(parsePartnership({ path, data: base }, 'osc-alfa'))
  assert.equal(parsePartnership({ path, data: { ...base, oscId: 'osc-gama' } }, 'osc-alfa'), null)
  assert.equal(parsePartnership({ path, data: { ...base, instrument: 'convenio' } }, 'osc-alfa'), null)
  assert.equal(parsePartnership({ path, data: { ...base, administrativeStatus: 'aprovada' } }, 'osc-alfa'), null)
  assert.equal(parsePartnership({ path, data: { ...base, termEnd: '2027-13-01' } }, 'osc-alfa'), null)
  assert.equal(parsePartnership({ path, data: { ...base, id: 'outro' } }, 'osc-alfa'), null)
  // AC nunca exibe valor global, mesmo que gravado.
  assert.equal(parsePartnership({ path, data: { ...base, instrument: 'acordo-cooperacao', globalValueCents: 100 } }, 'osc-alfa')?.globalValueCents, null)
  // Identificador fora do formato não é consultado.
  const fake = createFakePartnerships()
  const service = createPartnershipService(fake.db, fake.sdk)
  assert.deepEqual(await service.get('osc-alfa', '../osc-gama/partnerships/x'), { ok: true, data: null })
  assert.deepEqual(fake.calls, [])
})

test('Erros do Firestore viram categorias seguras, sem mensagens internas', async () => {
  const fake = createFakePartnerships()
  const service = createPartnershipService(fake.db, fake.sdk)
  fake.failures.set('list', firestoreError('permission-denied', 'projects/segredo'))
  assert.deepEqual(await service.listPage('osc-alfa', null), { ok: false, error: 'permission-denied' })
  fake.failures.set('get', firestoreError('unavailable'))
  assert.deepEqual(await service.get('osc-alfa', 'pAlfaColaboracao06'), { ok: false, error: 'network' })
  const unavailable = createPartnershipService(null, fake.sdk)
  assert.equal(unavailable.available, false)
})
