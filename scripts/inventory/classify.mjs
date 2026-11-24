/**
 * INV-UXPT-01 — CLASSIFICAÇÃO PURA dos estados legados do Plano de Trabalho (sem Firestore, sem rede).
 *
 * Recebe METADADOS já lidos (em memória) e devolve SOMENTE contagens agregadas. Os critérios são os
 * estados E1–E15 de `docs/uxpt/DEV-UXPT-01-compatibilidade.md` (seção 2.1) e reutilizam o DOMÍNIO
 * atual (`resolveCurrentVersion`, `activationStatusOf`, `parseStoredActivation`, `isVersionId`) para
 * que a classificação coincida com a interpretação do código. Os estados NÃO são mutuamente
 * exclusivos (ex.: uma versão pode ser E3 + E7 + E11 ao mesmo tempo).
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
  'formalAct.type',
  'formalAct.actDate',
  'complementaryTranscription.status',
  'financialTranscription.status',
])
/** Campo lido de cada evento de auditoria (somente o tipo). */
export const EVENT_FIELDS = Object.freeze(['action'])
/** Parcerias: nenhum campo (apenas a existência e o identificador técnico, em memória). */
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
const TRANSCRIPTION = ['open', 'closed']
const isRevision = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1
const isPresent = (v) => v !== undefined && v !== null

function zeroCounters() {
  return {
    partnerships: { total: 0, withoutOriginal: 0, withVersionsButWithoutOriginal: 0 },
    originals: { total: 0, inRegistration: 0, finalized: 0, unknownRegistration: 0, finalizedWithoutFinalizedAt: 0, storedSuperseded: 0, unrecognizedActivationIgnored: 0 },
    laterVersions: {
      total: 0,
      inRegistration: 0,
      finalized: 0,
      unknownRegistration: 0,
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
    current: { determinedOriginal: 0, determinedLater: 0, none: 0, inconsistent: 0, multipleActive: 0 },
    derived: { superseded: 0, legacyPending: 0 },
    transcriptions: { complementaryOpen: 0, complementaryClosed: 0, complementaryUnknown: 0, financialOpen: 0, financialClosed: 0, financialUnknown: 0 },
    integrity: {
      invalidVersionId: 0,
      sequenceMismatch: 0,
      pathFieldMismatch: 0,
      previousVersionMissing: 0,
      invalidRevision: 0,
      unrecognizedRegistrationStatus: 0,
      unrecognizedActivationStatus: 0,
      unrecognizedTranscriptionStatus: 0,
    },
    events: { total: 0, byAction: Object.fromEntries(KNOWN_EVENT_ACTIONS.map((a) => [a, 0])), otherKnownFormat: 0, withoutValidAction: 0 },
  }
}

/**
 * Classifica UMA parceria (metadados das versões em memória). `plans` = [{ id, data }], com `data`
 * contendo apenas os campos de WORK_PLAN_FIELDS (chaves com ponto). Acumula em `c`.
 */
export function classifyPartnership(c, oscId, partnershipId, plans) {
  c.partnerships.total += 1
  const valid = []
  const ids = plans.map((p) => p.id)
  if (!ids.includes('original')) {
    c.partnerships.withoutOriginal += 1 // E1
    if (plans.length > 0) c.partnerships.withVersionsButWithoutOriginal += 1
  }
  for (const { id, data } of plans) {
    const get = (k) => data[k]
    if (!isVersionId(id)) {
      c.integrity.invalidVersionId += 1
      continue
    }
    const sequence = id === 'original' ? 1 : isRevision(get('origin.sequence')) && get('origin.sequence') > 1 ? get('origin.sequence') : null
    if (sequence === null || (id !== 'original' && id !== `v${sequence}`)) c.integrity.sequenceMismatch += 1
    if (get('oscId') !== oscId || get('partnershipId') !== partnershipId) c.integrity.pathFieldMismatch += 1
    if (!isRevision(get('revision'))) c.integrity.invalidRevision += 1
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

    if (id === 'original') {
      // E4 (+ E2/E3)
      c.originals.total += 1
      if (reg === 'in-registration') c.originals.inRegistration += 1
      else if (reg === 'finalized') {
        c.originals.finalized += 1
        if (!isPresent(get('finalizedAt'))) c.originals.finalizedWithoutFinalizedAt += 1
      } else c.originals.unknownRegistration += 1
      if (activation === 'superseded') c.originals.storedSuperseded += 1
      else if (isPresent(rawActivation)) c.originals.unrecognizedActivationIgnored += 1 // parseWorkPlan só reconhece 'superseded' na original
    } else {
      // E5 (+ E2/E3, E8, E9)
      const l = c.laterVersions
      l.total += 1
      if (reg === 'in-registration') l.inRegistration += 1
      else if (reg === 'finalized') l.finalized += 1
      else l.unknownRegistration += 1
      if (activation === 'active') l.storedActive += 1
      if (activation === 'superseded') l.storedSuperseded += 1
      if (activation === 'awaiting-finalization') l.storedAwaitingFinalization += 1
      if (activation === 'pending-decision') l.storedPendingDecision += 1
      if (activation === null) l.withoutValidActivation += 1 // E9b
      if (reg === 'in-registration' && (activation === 'awaiting-finalization' || activation === 'pending-decision' || activation === null)) l.awaitingFinalization += 1 // E8
      if (reg === 'in-registration' && activation === 'pending-decision') l.pendingDecisionInRegistration += 1
      if (reg === 'finalized' && activation === 'pending-decision') l.pendingDecisionFinalized += 1 // E9a
      if (reg !== 'finalized' && activation === 'active') l.activeNotFinalized += 1
      const actType = get('formalAct.type')
      if (!FORMAL_ACT_TYPES.some((t) => t.id === actType) || !isValidDate(get('formalAct.actDate'))) l.invalidFormalAct += 1
      const previous = get('origin.previousWorkPlanId')
      if (!isVersionId(previous) || !ids.includes(previous)) c.integrity.previousVersionMissing += 1
    }
    if (regKnown && sequence !== null) {
      valid.push({ id, sequence, registrationStatus: reg, activationStatus: activation, previousWorkPlanId: isVersionId(get('origin.previousWorkPlanId')) ? get('origin.previousWorkPlanId') : null })
    }
  }

  // E6 / E9c — vigência pela regra AUTORITATIVA do domínio (somente versões reconhecíveis).
  if (plans.length > 0) {
    const resolution = resolveCurrentVersion(valid)
    if (valid.filter((v) => v.sequence > 1 && v.activationStatus === 'active').length > 1) c.current.multipleActive += 1
    if (resolution.status === 'determined') c.current[resolution.id === 'original' ? 'determinedOriginal' : 'determinedLater'] += 1
    else c.current[resolution.status] += 1
    const currentId = resolution.status === 'determined' ? resolution.id : null
    for (const v of valid) {
      const shown = activationStatusOf(v, currentId)
      if (shown === 'superseded') c.derived.superseded += 1 // E7 (situação apresentada)
      if (shown === 'legacy-pending') c.derived.legacyPending += 1 // E9a/E9b finalizadas
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
    else c.events.otherKnownFormat += 1
  }
}

export { zeroCounters }

/**
 * Coerência interna dos totais (seção 6 do pedido: "verificar a consistência dos totais").
 * Retorna a lista de divergências (vazia = consistente).
 */
export function checkTotals(r) {
  const issues = []
  const o = r.originals
  const l = r.laterVersions
  const e = r.events
  if (o.inRegistration + o.finalized + o.unknownRegistration !== o.total) issues.push('originals')
  if (l.inRegistration + l.finalized + l.unknownRegistration !== l.total) issues.push('laterVersions')
  if (r.partnerships.total - r.partnerships.withoutOriginal !== o.total) issues.push('partnerships-vs-originals')
  const withPlans = r.current.determinedOriginal + r.current.determinedLater + r.current.none + r.current.inconsistent
  if (withPlans > r.partnerships.total) issues.push('current')
  const byAction = Object.values(e.byAction).reduce((a, b) => a + b, 0)
  if (byAction + e.otherKnownFormat + e.withoutValidAction !== e.total) issues.push('events')
  return issues
}
