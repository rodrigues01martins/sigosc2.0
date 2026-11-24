/**
 * INV-UXPT-01 — LEITURA paginada e montagem do relatório AGREGADO (somente leitura).
 *
 * `source` é uma abstração mínima de leitura: `listPage(collectionPath, fields, pageSize, afterId)`
 * → `[{ id, data }]`. Em produção é `firestoreSource` (abaixo); nos testes, uma fonte fictícia em
 * memória (offline). Este módulo NÃO contém métodos de escrita (verificado por teste estático e por
 * teste de execução com um banco fictício que registra qualquer tentativa de escrita).
 *
 * Política de falha: qualquer erro de leitura ou de paginação INTERROMPE a seção afetada; seus
 * números ficam `null` ("não verificável") — nunca zero fabricado. O relatório só é "completo" se
 * TODAS as seções forem lidas integralmente.
 */
import { EVENT_FIELDS, PARTNERSHIP_FIELDS, WORK_PLAN_FIELDS, checkTotals, classifyEvents, classifyPartnership, zeroCounters } from './classify.mjs'

export const EXPECTED_PROJECT = 'sigorsc-testes'
export const DEFAULT_PAGE_SIZE = 200
export const MAX_PAGES_PER_COLLECTION = 1000

export class InventoryReadError extends Error {
  constructor(stage, cause) {
    // Mensagem SEM caminhos, identificadores ou conteúdo: apenas a etapa e o código do erro.
    super(`leitura interrompida na etapa "${stage}" (${codeOf(cause)})`)
    this.stage = stage
    this.code = codeOf(cause)
  }
}
const codeOf = (e) => (e && typeof e === 'object' && 'code' in e ? String(e.code) : e instanceof Error && /^[a-z-]+$/.test(e.message) ? e.message : 'unknown')

/** Lê TODOS os documentos de uma coleção, página a página, falhando com segurança. */
export async function readAll(source, path, fields, stage, pageSize = DEFAULT_PAGE_SIZE) {
  const docs = []
  // IDs no formato __x__ são reservados pelo Firestore; um objeto simples basta como conjunto.
  const seen = {}
  let after = null
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES_PER_COLLECTION) throw new InventoryReadError(stage, new Error('pagination-limit'))
    let batchDocs
    try {
      batchDocs = await source.listPage(path, fields, pageSize, after)
    } catch (error) {
      throw new InventoryReadError(stage, error)
    }
    if (!Array.isArray(batchDocs) || batchDocs.length > pageSize) throw new InventoryReadError(stage, new Error('pagination-invalid'))
    for (const d of batchDocs) {
      if (!d || typeof d.id !== 'string' || typeof d.data !== 'object' || d.data === null) throw new InventoryReadError(stage, new Error('pagination-invalid'))
      // Documento repetido entre páginas = cursor que não avança: paginação não confiável.
      if (Object.hasOwn(seen, d.id)) throw new InventoryReadError(stage, new Error('pagination-stalled'))
      seen[d.id] = true
      docs.push(d)
    }
    if (batchDocs.length < pageSize) return docs
    after = batchDocs[batchDocs.length - 1].id
  }
}

/**
 * Executa o inventário. Retorna o relatório agregado e a lista de identificadores lidos (somente em
 * memória, para a verificação de vazamento — nunca impressa nem gravada).
 */
export async function runInventory(source, { pageSize = DEFAULT_PAGE_SIZE, now = new Date() } = {}) {
  const c = zeroCounters()
  const secrets = []
  const sections = { oscs: 'not-verifiable', partnerships: 'not-verifiable', workPlans: 'not-verifiable', events: 'not-verifiable' }
  const failures = []
  let oscs = []
  try {
    oscs = await readAll(source, 'oscs', [], 'oscs', pageSize)
    sections.oscs = 'complete'
    for (const o of oscs) secrets.push(o.id)
  } catch (error) {
    failures.push(stageOf(error))
  }

  if (sections.oscs === 'complete') {
    // Parcerias + versões (dependentes): uma falha invalida as duas seções.
    try {
      for (const o of oscs) {
        const partnerships = await readAll(source, `oscs/${o.id}/partnerships`, PARTNERSHIP_FIELDS, 'partnerships', pageSize)
        for (const p of partnerships) {
          secrets.push(p.id)
          const plans = await readAll(source, `oscs/${o.id}/partnerships/${p.id}/workPlans`, WORK_PLAN_FIELDS, 'workPlans', pageSize)
          classifyPartnership(c, o.id, p.id, plans)
        }
      }
      sections.partnerships = 'complete'
      sections.workPlans = 'complete'
    } catch (error) {
      failures.push(stageOf(error))
    }
    // Eventos: seção independente.
    try {
      for (const o of oscs) classifyEvents(c, await readAll(source, `oscs/${o.id}/workPlanEvents`, EVENT_FIELDS, 'events', pageSize))
      sections.events = 'complete'
    } catch (error) {
      failures.push(stageOf(error))
    }
  }
  return { report: buildReport(c, sections, oscs.length, failures, now), secrets }
}
const stageOf = (error) => (error instanceof InventoryReadError ? `${error.stage}:${error.code}` : 'unknown:unknown')

/** Rótulo de cada número: encontrado / não encontrado após consulta completa / não verificável. */
export const finding = (value) => (value === null ? 'not-verifiable' : value > 0 ? 'found' : 'not-found')
const nullify = (obj) => JSON.parse(JSON.stringify(obj), (_k, v) => (typeof v === 'number' ? null : v))

export function buildReport(c, sections, oscCount, failures, now) {
  const plansOk = sections.workPlans === 'complete'
  const eventsOk = sections.events === 'complete'
  const pick = (ok, value) => (ok ? value : nullify(value))
  const status = Object.values(sections).every((s) => s === 'complete') ? 'complete' : sections.oscs === 'complete' ? 'partial' : 'failed'
  const body = {
    oscs: sections.oscs === 'complete' ? oscCount : null,
    partnerships: pick(plansOk, c.partnerships),
    originals: pick(plansOk, c.originals),
    laterVersions: pick(plansOk, c.laterVersions),
    current: pick(plansOk, c.current),
    derived: pick(plansOk, c.derived),
    transcriptions: pick(plansOk, c.transcriptions),
    integrity: pick(plansOk, c.integrity),
    events: pick(eventsOk, c.events),
  }
  const totals = plansOk && eventsOk ? checkTotals({ ...c }) : ['not-verifiable']
  return {
    inventory: 'INV-UXPT-01',
    reference: 'docs/uxpt/DEV-UXPT-01-compatibilidade.md (E1–E15)',
    project: EXPECTED_PROJECT,
    generatedAt: now.toISOString(),
    status,
    sections,
    failures,
    totalsConsistent: totals.length === 0 ? true : totals[0] === 'not-verifiable' ? null : false,
    totalsIssues: totals,
    states: stateSummary(body),
    counts: body,
  }
}

/** Correspondência com E1–E15 (contagens de estados SOBREPONÍVEIS; não somam ao total). */
function stateSummary(b) {
  const n = (v) => (v === undefined ? null : v)
  const p = b.partnerships ?? {}
  const o = b.originals ?? {}
  const l = b.laterVersions ?? {}
  const cur = b.current ?? {}
  const d = b.derived ?? {}
  const t = b.transcriptions ?? {}
  const e = b.events ?? {}
  const sum = (...xs) => (xs.some((x) => x === null || x === undefined) ? null : xs.reduce((a, x) => a + x, 0))
  const rows = {
    E1_notStructured: n(p.withoutOriginal),
    E2_inRegistration: sum(o.inRegistration, l.inRegistration),
    E3_finalized: sum(o.finalized, l.finalized),
    E4_original: n(o.total),
    E5_laterVersions: n(l.total),
    E6_partnershipsWithCurrent: sum(cur.determinedOriginal, cur.determinedLater),
    E7_superseded: n(d.superseded),
    E8_awaitingFinalization: n(l.awaitingFinalization),
    E9a_pendingDecisionFinalized: n(l.pendingDecisionFinalized),
    E9b_withoutValidActivation: n(l.withoutValidActivation),
    E9c_inconsistentChains: n(cur.inconsistent),
    E10_complementaryOpen: n(t.complementaryOpen),
    E11_complementaryClosed: n(t.complementaryClosed),
    E12_financialOpen: n(t.financialOpen),
    E13_financialClosed: n(t.financialClosed),
    E14_materialCorrections: e.byAction ? n(e.byAction['material-correction']) : null,
    E15_events: n(e.total),
  }
  return Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { value: v, finding: finding(v) }]))
}

/**
 * Verificação de vazamento: o relatório serializado não pode conter NENHUM identificador técnico
 * lido (OSC, parceria) nem padrões de e-mail. Falha fechada: lança erro, o relatório não é emitido.
 */
export function assertAggregateOnly(serialized, secrets) {
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(serialized)) throw new Error('report-contains-email')
  for (const s of secrets) {
    if (typeof s === 'string' && s.length >= 3 && serialized.includes(s)) throw new Error('report-contains-identifier')
  }
  return true
}

/** Relatório legível (Markdown) a partir do agregado — apenas números e rótulos fixos. */
export function renderMarkdown(r) {
  const fmt = (v) => (v === null || v === undefined ? 'não verificável' : String(v))
  const lines = [
    '# INV-UXPT-01 — Inventário agregado (somente leitura)',
    '',
    `- Projeto: ${r.project}`,
    `- Gerado em (UTC): ${r.generatedAt}`,
    `- Situação: ${r.status}`,
    `- Totais consistentes: ${r.totalsConsistent === null ? 'não verificável' : r.totalsConsistent ? 'sim' : 'não'}`,
    `- Falhas: ${r.failures.length ? r.failures.join(', ') : 'nenhuma'}`,
    '',
    '## Estados E1–E15 (sobreponíveis)',
    '',
    '| Estado | Quantidade | Resultado |',
    '| --- | --- | --- |',
    ...Object.entries(r.states).map(([k, v]) => `| ${k} | ${fmt(v.value)} | ${v.finding} |`),
    '',
    '## Contagens detalhadas',
    '',
  ]
  for (const [section, values] of Object.entries(r.counts)) {
    if (values === null || typeof values !== 'object') {
      lines.push(`- ${section}: ${fmt(values)}`)
      continue
    }
    lines.push(`### ${section}`, '')
    for (const [k, v] of Object.entries(values)) {
      if (v !== null && typeof v === 'object') for (const [k2, v2] of Object.entries(v)) lines.push(`- ${k}.${k2}: ${fmt(v2)}`)
      else lines.push(`- ${k}: ${fmt(v)}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Adaptador de LEITURA do Firestore (Admin SDK). Usa somente `collection().select().orderBy()
 * .limit().startAfter().get()` — projeção de campos e paginação por ID do documento.
 * `documentId` = `FieldPath.documentId()` (injetado para manter este módulo sem dependência do SDK).
 */
export function firestoreSource(db, documentId) {
  return {
    async listPage(path, fields, pageSize, afterId) {
      let query = db.collection(path).select(...fields).orderBy(documentId).limit(pageSize)
      if (afterId !== null) query = query.startAfter(afterId)
      const snapshot = await query.get()
      return snapshot.docs.map((doc) => ({ id: doc.id, data: Object.fromEntries(fields.map((f) => [f, doc.get(f)])) }))
    },
  }
}
