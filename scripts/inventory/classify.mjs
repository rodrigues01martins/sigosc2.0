/**
 * INV-UXPT-01 — CLASSIFICAÇÃO PURA dos estados legados do Plano de Trabalho (sem Firestore, sem rede).
 *
 * Recebe METADADOS já lidos (em memória) e devolve SOMENTE contagens agregadas. Os critérios são os
 * estados E1–E15 de `docs/uxpt/DEV-UXPT-01-compatibilidade.md` (seção 2.1) e reutilizam o DOMÍNIO
 * atual (`resolveCurrentVersion`, `activationStatusOf`, `parseStoredActivation`, `isVersionId`,
 * `isValidDate`) para que a classificação coincida com a interpretação do código PUBLICADO — sem
 * antecipar regras aprovadas mas não implementadas (ex.: DEC-UXPT-P1). Os estados NÃO são mutuamente
 * exclusivos (ex.: uma versão pode ser E3 + E7 + E11 ao mesmo tempo) e não devem ser somados.
 *
 * Este módulo não importa SDK algum e não contém operações de escrita (verificado por teste).
 */
import { isValidDate } from '../../src/domain/partnerships.ts'
import { FORMAL_ACT_TYPES, activationStatusOf, isVersionId, parseStoredActivation, resolveCurrentVersion } from '../../src/domain/workPlanVersions.ts'

/** Campos lidos de cada versão (projeção). Nenhum valor de conteúdo do Plano é lido. */
export const WORK_PLAN_FIELDS = Object.freeze([
  'oscId',
  'partnershipId',
  'registrationStatus',
  'origin.sequence',
  'origin.previousWorkPlanId',
  'activation.status',
  'revision',
  'finalizedAt',
  'correctionCount',
  'formalAct.type',
  'formalAct.actDate',
  'complementaryTranscription.status',
  'financialTranscription.status',
])
/** Campo lido de cada evento de auditoria (somente o tipo). */
export const EVENT_FIELDS = Object.freeze(['action'])
/** OSCs e parcerias: nenhum campo (apenas a existência e o identificador técnico, em memória). */
export const PARTNERSHIP_FIELDS = Object.freeze([])

/** Tipos de evento conhecidos no código atual (E15; DEV-UXPT-01 seção 2.1). */
export const KNOWN_EVENT_ACTIONS = Object.freeze([
  'start',
  'update',
  'formal-act-update',
  'finalize',
  'components-reviewed',
  'version-created',
  'version-activated',
  'material-correction',
  'complementary-transcription-opened',
  'complementary-transcription-closed',
  'financial-transcription-opened',
  'financial-transcription-closed',
  'goal-created',
  'goal-updated',
  'indicator-created',
  'indicator-updated',
  'financial-category-created',
  'financial-category-updated',
  'financial-item-created',
  'financial-item-updated',
])

const REGISTRATION = ['in-registration', 'finalized']
const isRevision = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1
const isCount = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const isPresent = (v) => v !== undefined && v !== null

export function zeroCounters() {
  return {
    partnerships: { total: 0, withPlans: 0, withoutOriginal: 0, withVersionsButWithoutOriginal: 0 },
    originals: { total: 0, inRegistration: 0, finalized: 0, unknownRegistration: 0, finalizedWithoutFinalizedAt: 0, storedSuperseded: 0, unrecognizedActivationIgnored: 0 },
    laterVersions: {
      total: 0,
      inRegistration: 0,
      finalized: 0,
      unknownRegistration: 0,
      finalizedWithoutFinalizedAt: 0,
      storedActive: 0,
      storedSuperseded: 0,
      storedAwaitingFinalization: 0,
      storedPendingDecision: 0,
      withoutValidActivation: 0,
      awaitingFinalization: 0,
      pendingDecisionFinalized: 0,
      pendingDecisionInRegistration: 0,
      activeNotFinalized: 0,
      invalidFormalAct: 0,
    },
    current: { determinedOriginal: 0, determinedLater: 0, none: 0, inconsistent: 0, multipleActive: 0, originalSupersededWithoutActiveSuccessor: 0 },
    derived: { superseded: 0, legacyPending: 0 },
    transcriptions: { complementaryOpen: 0, complementaryClosed: 0, complementaryUnknown: 0, financialOpen: 0, financialClosed: 0, financialUnknown: 0 },
    corrections: { plansWithCorrections: 0, correctionCountSum: 0 },
    integrity: {
      invalidVersionId: 0,
      sequenceMismatch: 0,
      pathFieldMismatch: 0,
      previousVersionMissing: 0,
      previousVersionNotEarlier: 0,
      invalidRevision: 0,
      invalidCorrectionCount: 0,
      unrecognizedRegistrationStatus: 0,
      unrecognizedActivationStatus: 0,
      unrecognizedTranscriptionStatus: 0,
    },
    events: { total: 0, byAction: Object.fromEntries(KNOWN_EVENT_ACTIONS.map((a) => [a, 0])), unknownAction: 0, withoutValidAction: 0 },
  }
}

const sequenceFor = (id, data) => (id === 'original' ? 1 : isRevision(data['origin.sequence']) && data['origin.sequence'] > 1 ? data['origin.sequence'] : null)

/**
 * Classifica UMA parceria (metadados das versões em memória). `plans` = [{ id, data }], com `data`
 * contendo apenas os campos de WORK_PLAN_FIELDS (chaves com ponto). Acumula em `c`.
 */
export function classifyPartnership(c, oscId, partnershipId, plans) {
  c.partnerships.total += 1
  if (plans.length > 0) c.partnerships.withPlans += 1
  const valid = []
  const ids = plans.map((p) => p.id)
  const sequences = Object.fromEntries(plans.filter((p) => isVersionId(p.id)).map((p) => [p.id, sequenceFor(p.id, p.data)]))
  if (!ids.includes('original')) {
    c.partnerships.withoutOriginal += 1 // E1 (ausência de workPlans/original)
    if (plans.length > 0) c.partnerships.withVersionsButWithoutOriginal += 1 // cadeia apenas com versões posteriores
  }
  for (const { id, data } of plans) {
    const get = (k) => data[k]
    if (!isVersionId(id)) {
      c.integrity.invalidVersionId += 1
      continue
    }
    const sequence = sequences[id]
    if (sequence === null || (id !== 'original' && id !== `v${sequence}`)) c.integrity.sequenceMismatch += 1
    if (get('oscId') !== oscId || get('partnershipId') !== partnershipId) c.integrity.pathFieldMismatch += 1
    if (!isRevision(get('revision'))) c.integrity.invalidRevision += 1
    const corrections = get('correctionCount')
    if (isPresent(corrections)) {
      if (!isCount(corrections)) c.integrity.invalidCorrectionCount += 1
      else if (corrections > 0) {
        c.corrections.plansWithCorrections += 1
        c.corrections.correctionCountSum += corrections
      }
    }
    const reg = get('registrationStatus')
    const regKnown = REGISTRATION.includes(reg)
    if (!regKnown) c.integrity.unrecognizedRegistrationStatus += 1
    const rawActivation = get('activation.status')
    const activation = parseStoredActivation(rawActivation)
    if (isPresent(rawActivation) && activation === null) c.integrity.unrecognizedActivationStatus += 1
    for (const [field, open, closed, unknown] of [
      ['complementaryTranscription.status', 'complementaryOpen', 'complementaryClosed', 'complementaryUnknown'],
      ['financialTranscription.status', 'financialOpen', 'financialClosed', 'financialUnknown'],
    ]) {
      const t = get(field)
      if (t === 'open') c.transcriptions[open] += 1 // E10 / E12
      else if (t === 'closed') c.transcriptions[closed] += 1 // E11 / E13
      else if (isPresent(t)) {
        c.transcriptions[unknown] += 1
        c.integrity.unrecognizedTranscriptionStatus += 1
      }
    }
    const finalizedWithoutDate = reg === 'finalized' && !isPresent(get('finalizedAt'))

    if (id === 'original') {
      // E4 (+ E2/E3)
      c.originals.total += 1
      if (reg === 'in-registration') c.originals.inRegistration += 1
      else if (reg === 'finalized') c.originals.finalized += 1
      else c.originals.unknownRegistration += 1
      if (finalizedWithoutDate) c.originals.finalizedWithoutFinalizedAt += 1
      if (activation === 'superseded') c.originals.storedSuperseded += 1
      else if (isPresent(rawActivation)) c.originals.unrecognizedActivationIgnored += 1 // parseWorkPlan só reconhece 'superseded' na original
    } else {
      // E5 (+ E2/E3, E8, E9)
      const l = c.laterVersions
      l.total += 1
      if (reg === 'in-registration') l.inRegistration += 1
      else if (reg === 'finalized') l.finalized += 1
      else l.unknownRegistration += 1
      if (finalizedWithoutDate) l.finalizedWithoutFinalizedAt += 1
      if (activation === 'active') l.storedActive += 1
      if (activation === 'superseded') l.storedSuperseded += 1
      if (activation === 'awaiting-finalization') l.storedAwaitingFinalization += 1
      if (activation === 'pending-decision') l.storedPendingDecision += 1
      if (activation === null) l.withoutValidActivation += 1 // E9b
      // E8: em cadastramento com ativação aguardando, legada ou ausente (o cliente lê ausente como 'pending-decision').
      if (reg === 'in-registration' && (activation === 'awaiting-finalization' || activation === 'pending-decision' || activation === null)) l.awaitingFinalization += 1
      if (reg === 'in-registration' && activation === 'pending-decision') l.pendingDecisionInRegistration += 1
      if (reg === 'finalized' && activation === 'pending-decision') l.pendingDecisionFinalized += 1 // E9a
      if (reg !== 'finalized' && activation === 'active') l.activeNotFinalized += 1
      const actType = get('formalAct.type')
      if (!FORMAL_ACT_TYPES.some((t) => t.id === actType) || !isValidDate(get('formalAct.actDate'))) l.invalidFormalAct += 1
      const previous = get('origin.previousWorkPlanId')
      if (!isVersionId(previous) || !ids.includes(previous)) c.integrity.previousVersionMissing += 1
      // Referência para versão igual ou posterior (inclui auto-referência e ciclos): cadeia não ordenável.
      else if (sequence !== null && (sequences[previous] === null || sequences[previous] >= sequence)) c.integrity.previousVersionNotEarlier += 1
    }
    if (regKnown && sequence !== null) {
      valid.push({ id, sequence, registrationStatus: reg, activationStatus: activation, previousWorkPlanId: isVersionId(get('origin.previousWorkPlanId')) ? get('origin.previousWorkPlanId') : null })
    }
  }

  // E6 / E9c — vigência pela regra AUTORITATIVA do domínio (somente versões reconhecíveis).
  if (plans.length > 0) {
    const resolution = resolveCurrentVersion(valid)
    const activeLater = valid.filter((v) => v.sequence > 1 && v.activationStatus === 'active')
    if (activeLater.length > 1) c.current.multipleActive += 1
    const original = valid.find((v) => v.sequence === 1)
    if (original?.activationStatus === 'superseded' && !activeLater.some((v) => v.registrationStatus === 'finalized')) c.current.originalSupersededWithoutActiveSuccessor += 1
    if (resolution.status === 'determined') c.current[resolution.id === 'original' ? 'determinedOriginal' : 'determinedLater'] += 1
    else c.current[resolution.status] += 1
    const currentId = resolution.status === 'determined' ? resolution.id : null
    for (const v of valid) {
      // Situação APRESENTADA pelo servidor (activationStatusOf); difere do valor persistido.
      const shown = activationStatusOf(v, currentId)
      if (shown === 'superseded') c.derived.superseded += 1
      if (shown === 'legacy-pending') c.derived.legacyPending += 1
    }
  }
}

/** Classifica eventos (E14/E15) a partir apenas do campo `action`. */
export function classifyEvents(c, events) {
  for (const { data } of events) {
    c.events.total += 1
    const action = data.action
    if (typeof action !== 'string' || action === '') c.events.withoutValidAction += 1
    else if (Object.hasOwn(c.events.byAction, action)) c.events.byAction[action] += 1
    else c.events.unknownAction += 1
  }
}

/**
 * Integridade ARITMÉTICA das contagens (não é integridade dos dados históricos nem completude).
 * Retorna a lista de divergências (vazia = consistente).
 */
export function checkTotals(r) {
  const issues = []
  const o = r.originals
  const l = r.laterVersions
  const e = r.events
  const cur = r.current
  if (o.inRegistration + o.finalized + o.unknownRegistration !== o.total) issues.push('originals')
  if (l.inRegistration + l.finalized + l.unknownRegistration !== l.total) issues.push('laterVersions')
  if (r.partnerships.total - r.partnerships.withoutOriginal !== o.total) issues.push('partnerships-vs-originals')
  if (cur.determinedOriginal + cur.determinedLater + cur.none + cur.inconsistent !== r.partnerships.withPlans) issues.push('current')
  const byAction = Object.values(e.byAction).reduce((a, b) => a + b, 0)
  if (byAction + e.unknownAction + e.withoutValidAction !== e.total) issues.push('events')
  return issues
}

/**
 * Anomalias dos DADOS HISTÓRICOS (independentes da aritmética e da completude). São achados do
 * inventário, nunca corrigidos por ele. `correctionMismatch` = soma de `correctionCount` ≠ eventos
 * `material-correction` (exige as duas seções completas).
 */
export function dataAnomalies(r, correctionMismatch) {
  const i = r.integrity
  const items = {
    integrity: Object.values(i).reduce((a, b) => a + b, 0),
    inconsistentChains: r.current.inconsistent,
    activeNotFinalized: r.laterVersions.activeNotFinalized,
    invalidFormalAct: r.laterVersions.invalidFormalAct,
    unknownEvents: r.events.unknownAction + r.events.withoutValidAction,
    correctionMismatch: correctionMismatch ? 1 : 0,
  }
  return { total: Object.values(items).reduce((a, b) => a + b, 0), ...items }
}
