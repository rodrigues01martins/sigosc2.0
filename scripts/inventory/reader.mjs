/**
 * INV-UXPT-01 — LEITURA paginada e montagem do relatório AGREGADO (somente leitura).
 *
 * `source` é uma abstração mínima de leitura: `listPage(collectionPath, fields, pageSize, afterId)`
 * → `[{ id, data }]`. Em produção é `firestoreSource` (abaixo); nos testes, uma fonte fictícia em
 * memória (offline). Este módulo NÃO contém métodos de escrita (verificado por teste estático e por
 * teste de execução com um banco fictício que registra qualquer tentativa de escrita).
 *
 * Três propriedades DISTINTAS são relatadas (nenhuma implica as outras):
 *  - completude das consultas (`queryComplete`): todas as seções lidas integralmente;
 *  - integridade aritmética (`arithmeticConsistent`): as contagens fecham entre si;
 *  - anomalias dos dados históricos (`dataAnomalies`): achados sobre os dados, nunca corrigidos.
 *
 * Política de falha: qualquer erro de leitura, paginação ou classificação INTERROMPE a seção
 * afetada; seus números ficam `null` ("não verificável") — nunca zero fabricado.
 */
import { EVENT_FIELDS, KNOWN_EVENT_ACTIONS, PARTNERSHIP_FIELDS, WORK_PLAN_FIELDS, checkTotals, classifyEvents, classifyPartnership, dataAnomalies, zeroCounters } from './classify.mjs'

export const EXPECTED_PROJECT = 'sigorsc-testes'
export const DEFAULT_PAGE_SIZE = 200
export const MAX_PAGES_PER_COLLECTION = 1000
const STAGES = ['oscs', 'partnerships', 'workPlans', 'events', 'classification']
const INTERNAL_CODES = ['pagination-limit', 'pagination-invalid', 'pagination-stalled']

/**
 * Código de erro SEGURO: somente códigos gRPC numéricos (0–16) ou códigos internos fixos. Mensagens e
 * códigos textuais de terceiros podem conter caminhos ou identificadores e nunca são propagados.
 */
export function safeErrorCode(e) {
  if (e && typeof e === 'object' && 'code' in e && Number.isInteger(e.code) && e.code >= 0 && e.code <= 16) return `grpc-${e.code}`
  if (e instanceof Error && INTERNAL_CODES.includes(e.message)) return e.message
  if (e && typeof e === 'object' && 'code' in e && INTERNAL_CODES.includes(e.code)) return e.code
  return 'unknown'
}

export class InventoryReadError extends Error {
  constructor(stage, cause) {
    const code = safeErrorCode(cause)
    // Mensagem SEM caminhos, identificadores ou conteúdo: apenas a etapa e o código seguro.
    super(`leitura interrompida na etapa "${STAGES.includes(stage) ? stage : 'unknown'}" (${code})`)
    this.stage = STAGES.includes(stage) ? stage : 'unknown'
    this.code = code
  }
}

/** Lê TODOS os documentos de uma coleção, página a página, falhando com segurança. */
export async function readAll(source, path, fields, stage, pageSize = DEFAULT_PAGE_SIZE, maxPages = MAX_PAGES_PER_COLLECTION) {
  const docs = []
  // IDs no formato __x__ são reservados pelo Firestore; um objeto simples basta como conjunto.
  const seen = {}
  let after = null
  for (let page = 0; ; page++) {
    if (page >= maxPages) throw new InventoryReadError(stage, new Error('pagination-limit'))
    let batchDocs
    try {
      batchDocs = await source.listPage(path, fields, pageSize, after)
    } catch (error) {
      throw new InventoryReadError(stage, error)
    }
    if (!Array.isArray(batchDocs) || batchDocs.length > pageSize) throw new InventoryReadError(stage, new Error('pagination-invalid'))
    for (const d of batchDocs) {
      if (!d || typeof d.id !== 'string' || d.id === '' || typeof d.data !== 'object' || d.data === null) throw new InventoryReadError(stage, new Error('pagination-invalid'))
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
export async function runInventory(source, { pageSize = DEFAULT_PAGE_SIZE, now = new Date(), maxPages = MAX_PAGES_PER_COLLECTION } = {}) {
  const c = zeroCounters()
  const secrets = []
  const sections = { oscs: 'not-verifiable', partnerships: 'not-verifiable', workPlans: 'not-verifiable', events: 'not-verifiable' }
  const failures = []
  let oscs = []
  try {
    oscs = await readAll(source, 'oscs', [], 'oscs', pageSize, maxPages)
    sections.oscs = 'complete'
    for (const o of oscs) secrets.push(o.id)
  } catch (error) {
    failures.push(stageOf(error, 'oscs'))
  }

  if (sections.oscs === 'complete') {
    // Parcerias + versões (dependentes): uma falha em QUALQUER OSC ou parceria invalida as duas seções.
    try {
      for (const o of oscs) {
        const partnerships = await readAll(source, `oscs/${o.id}/partnerships`, PARTNERSHIP_FIELDS, 'partnerships', pageSize, maxPages)
        for (const p of partnerships) {
          secrets.push(p.id)
          const plans = await readAll(source, `oscs/${o.id}/partnerships/${p.id}/workPlans`, WORK_PLAN_FIELDS, 'workPlans', pageSize, maxPages)
          try {
            classifyPartnership(c, o.id, p.id, plans)
          } catch (error) {
            throw new InventoryReadError('classification', error)
          }
        }
      }
      sections.partnerships = 'complete'
      sections.workPlans = 'complete'
    } catch (error) {
      failures.push(stageOf(error, 'workPlans'))
    }
    // Eventos: seção independente.
    try {
      for (const o of oscs) {
        const events = await readAll(source, `oscs/${o.id}/workPlanEvents`, EVENT_FIELDS, 'events', pageSize, maxPages)
        try {
          classifyEvents(c, events)
        } catch (error) {
          throw new InventoryReadError('classification', error)
        }
      }
      sections.events = 'complete'
    } catch (error) {
      failures.push(stageOf(error, 'events'))
    }
  }
  return { report: buildReport(c, sections, oscs.length, failures, now), secrets }
}
const stageOf = (error, fallback) => (error instanceof InventoryReadError ? `${error.stage}:${error.code}` : `${fallback}:unknown`)

/** Rótulo de cada número: encontrado / não encontrado após consulta completa / não verificável. */
export const finding = (value) => (value === null ? 'not-verifiable' : value > 0 ? 'found' : 'not-found')
const nullify = (obj) => JSON.parse(JSON.stringify(obj), (_k, v) => (typeof v === 'number' ? null : v))

export function buildReport(c, sections, oscCount, failures, now) {
  const plansOk = sections.workPlans === 'complete'
  const eventsOk = sections.events === 'complete'
  const pick = (ok, value) => (ok ? value : nullify(value))
  const status = Object.values(sections).every((s) => s === 'complete') ? 'complete' : sections.oscs === 'complete' ? 'partial' : 'failed'
  const complete = plansOk && eventsOk
  const totals = complete ? checkTotals(c) : null
  const correctionMismatch = complete ? c.corrections.correctionCountSum !== c.events.byAction['material-correction'] : null
  const body = {
    oscs: sections.oscs === 'complete' ? oscCount : null,
    partnerships: pick(plansOk, c.partnerships),
    originals: pick(plansOk, c.originals),
    laterVersions: pick(plansOk, c.laterVersions),
    current: pick(plansOk, c.current),
    derived: pick(plansOk, c.derived),
    transcriptions: pick(plansOk, c.transcriptions),
    corrections: pick(plansOk, c.corrections),
    integrity: pick(plansOk, c.integrity),
    events: pick(eventsOk, c.events),
  }
  return {
    inventory: 'INV-UXPT-01',
    reference: 'docs/uxpt/DEV-UXPT-01-compatibilidade.md (E1-E15)',
    project: EXPECTED_PROJECT,
    generatedAt: now.toISOString(),
    status,
    queryComplete: status === 'complete',
    sections,
    failures,
    arithmeticConsistent: totals === null ? null : totals.length === 0,
    arithmeticIssues: totals ?? [],
    correctionCountMatchesEvents: correctionMismatch === null ? null : !correctionMismatch,
    dataAnomalies: complete ? dataAnomalies(c, correctionMismatch) : null,
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
    E7_storedSuperseded: sum(o.storedSuperseded, l.storedSuperseded),
    E7_shownSuperseded: n(d.superseded),
    E8_awaitingFinalization: n(l.awaitingFinalization),
    E9a_pendingDecisionFinalized: n(l.pendingDecisionFinalized),
    E9b_withoutValidActivation: n(l.withoutValidActivation),
    E9c_inconsistentChains: n(cur.inconsistent),
    E9d_multipleActive: n(cur.multipleActive),
    E9e_activeNotFinalized: n(l.activeNotFinalized),
    E9f_originalSupersededWithoutSuccessor: n(cur.originalSupersededWithoutActiveSuccessor),
    E10_complementaryOpen: n(t.complementaryOpen),
    E11_complementaryClosed: n(t.complementaryClosed),
    E12_financialOpen: n(t.financialOpen),
    E13_financialClosed: n(t.financialClosed),
    E14_materialCorrections: e.byAction ? n(e.byAction['material-correction']) : null,
    E15_events: n(e.total),
  }
  return Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { value: v, finding: finding(v) }]))
}

// ------------------------------------------------------------------ verificação de vazamento

const FAILURE_PATTERN = new RegExp(`^(${STAGES.join('|')}):(grpc-([0-9]|1[0-6])|${INTERNAL_CODES.join('|')}|unknown)$`)
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** Vocabulário FIXO de chaves e textos do relatório (derivado do próprio modelo, sem dados lidos). */
function vocabulary() {
  const words = {}
  const fixed = ['INV-UXPT-01', EXPECTED_PROJECT, 'docs/uxpt/DEV-UXPT-01-compatibilidade.md (E1-E15)', 'complete', 'partial', 'failed', 'not-verifiable', 'found', 'not-found', 'value', 'finding']
  const issues = ['originals', 'laterVersions', 'partnerships-vs-originals', 'current', 'events']
  for (const w of [...fixed, ...KNOWN_EVENT_ACTIONS, ...issues]) words[w] = true
  const template = buildReport(zeroCounters(), { oscs: 'complete', partnerships: 'complete', workPlans: 'complete', events: 'complete' }, 0, [], new Date(0))
  const walk = (v) => {
    if (!v || typeof v !== 'object') return
    for (const [k, x] of Object.entries(v)) {
      words[k] = true
      walk(x)
    }
  }
  walk(template)
  return Object.freeze(words)
}
const VOCABULARY = vocabulary()
const inVocabulary = (w) => Object.hasOwn(VOCABULARY, w)

/**
 * Validação ESTRUTURAL (lista de permissões): todo texto do relatório — chaves e valores — deve
 * pertencer ao vocabulário fixo, a uma data ISO ou a um código de falha seguro; números, booleanos e
 * `null` são os únicos outros valores. Assim, nenhum dado lido pode chegar ao relatório.
 */
export function assertReportShape(report) {
  const check = (v, key) => {
    if (key !== null && !inVocabulary(key) && !/^\d+$/.test(key)) throw new Error('report-unexpected-key')
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return
    if (typeof v === 'string') {
      if (inVocabulary(v) || (key === 'generatedAt' && ISO_PATTERN.test(v)) || FAILURE_PATTERN.test(v)) return
      throw new Error('report-unexpected-text')
    }
    if (Array.isArray(v)) return v.forEach((x) => check(x, null))
    if (typeof v === 'object') return Object.entries(v).forEach(([k, x]) => check(x, k))
    throw new Error('report-unexpected-value')
  }
  check(report, null)
  return true
}

/**
 * Verificação de vazamento (defesa em profundidade, falha fechada): o relatório é estruturalmente
 * válido, o Markdown é exatamente o derivado do relatório validado, não há e-mails e nenhum
 * identificador lido aparece como TOKEN (nem como trecho, se tiver 12+ caracteres) — exceto identificadores que coincidam com uma palavra do
 * vocabulário fixo ou sejam só dígitos (não revelam nada e gerariam falsos positivos sistemáticos).
 */
export function assertAggregateOnly(report, markdown, secrets) {
  assertReportShape(report)
  if (markdown !== renderMarkdown(report)) throw new Error('report-markdown-mismatch')
  const serialized = `${JSON.stringify(report)}\n${markdown}`
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(serialized)) throw new Error('report-contains-email')
  const tokens = new Set(serialized.split(/[\s"'`|,:;()[\]{}<>]+/))
  for (const s of secrets) {
    if (typeof s !== 'string' || s === '' || inVocabulary(s) || /^\d+$/.test(s)) continue
    if (tokens.has(s) || (s.length >= 12 && serialized.includes(s))) throw new Error('report-contains-identifier')
  }
  return true
}

/** Relatório legível (Markdown) a partir do agregado — apenas números e rótulos fixos. */
export function renderMarkdown(r) {
  const fmt = (v) => (v === null || v === undefined ? 'não verificável' : String(v))
  const yesNo = (v) => (v === null ? 'não verificável' : v ? 'sim' : 'não')
  const lines = [
    '# INV-UXPT-01 — Inventário agregado (somente leitura)',
    '',
    `- Projeto: ${r.project}`,
    `- Gerado em (UTC): ${r.generatedAt}`,
    `- Situação das consultas: ${r.status}`,
    `- Consultas completas: ${yesNo(r.queryComplete)}`,
    `- Integridade aritmética das contagens: ${yesNo(r.arithmeticConsistent)}`,
    `- Correções: soma de correctionCount igual aos eventos material-correction: ${yesNo(r.correctionCountMatchesEvents)}`,
    `- Anomalias nos dados históricos: ${r.dataAnomalies === null ? 'não verificável' : String(r.dataAnomalies.total)}`,
    `- Falhas: ${r.failures.length ? r.failures.join(', ') : 'nenhuma'}`,
    '',
    '## Estados E1–E15 (sobreponíveis; não somar)',
    '',
    '| Estado | Quantidade | Resultado |',
    '| --- | --- | --- |',
    ...Object.entries(r.states).map(([k, v]) => `| ${k} | ${fmt(v.value)} | ${v.finding} |`),
    '',
    '## Contagens detalhadas',
    '',
  ]
  const sections = { ...r.counts, dataAnomalies: r.dataAnomalies }
  for (const [section, values] of Object.entries(sections)) {
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
 * .limit().startAfter().get()` — projeção de campos e paginação por ID do documento. `select()` sem
 * campos devolve apenas referências. `documentId` = `FieldPath.documentId()` (injetado para manter
 * este módulo sem dependência do SDK).
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
