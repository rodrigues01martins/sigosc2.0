/**
 * Domínio da Gestão de Parcerias (DEV-02.1 e complemento C01) — puro e sem dependências.
 *
 * Usado pela interface (exibição e validação imediata) e pelo servidor
 * (`api/_lib/partnershipsService.ts`), que valida novamente e decide.
 *
 * Escopo: identificação de parcerias JÁ FORMALIZADAS sob a Lei 13.019/2014 (MROSC).
 * O cadastro NÃO representa aprovação jurídica nem validação oficial do instrumento.
 *
 * Decisões aplicadas (C01): DEC-PAR-001 (consulta, cadastro e edição independentes),
 * DEC-PAR-003 (suspensa não bloqueia), DEC-PAR-004 (vigência encerrada admitida),
 * DEC-PAR-005 (validações proporcionais; avisos em vez de bloqueios não homologados),
 * DEC-PAR-006 (situação administrativa inicial declarada pelo usuário).
 */
import { evaluate, type AuthorizationContext, type Authority, type DenialReason } from './authorization.ts'

// ---------------------------------------------------------------------------
// Instrumentos e situações
// ---------------------------------------------------------------------------

/** Instrumentos admitidos (Lei 13.019/2014, art. 2º, VII, VIII e VIII-A). Nenhum outro é aceito. */
export const INSTRUMENTS = [
  { id: 'termo-colaboracao', label: 'Termo de Colaboração', short: 'TC', financialTransfer: true },
  { id: 'termo-fomento', label: 'Termo de Fomento', short: 'TF', financialTransfer: true },
  { id: 'acordo-cooperacao', label: 'Acordo de Cooperação', short: 'AC', financialTransfer: false },
] as const

export type InstrumentId = (typeof INSTRUMENTS)[number]['id']

export function isInstrument(value: unknown): value is InstrumentId {
  return typeof value === 'string' && INSTRUMENTS.some((i) => i.id === value)
}

export function instrumentOf(id: InstrumentId) {
  return INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[0]
}

/** Acordo de Cooperação não envolve transferência de recursos financeiros. */
export function hasFinancialTransfer(id: InstrumentId): boolean {
  return instrumentOf(id).financialTransfer
}

/**
 * Situação ADMINISTRATIVA da parceria (não confundir com a situação comercial da OSC).
 * DEC-PAR-006: declarada pelo usuário no cadastro; nunca calculada pelas datas de vigência.
 * Transições posteriores (suspender, encerrar, arquivar, desarquivar) NÃO estão implementadas.
 */
export const ADMINISTRATIVE_STATUSES = [
  { id: 'em-execucao', label: 'Em execução' },
  { id: 'suspensa', label: 'Suspensa' },
  { id: 'encerrada', label: 'Encerrada' },
  { id: 'arquivada', label: 'Arquivada' },
] as const

export type AdministrativeStatus = (typeof ADMINISTRATIVE_STATUSES)[number]['id']

export function isAdministrativeStatus(value: unknown): value is AdministrativeStatus {
  return typeof value === 'string' && ADMINISTRATIVE_STATUSES.some((s) => s.id === value)
}

export function administrativeStatusLabel(id: AdministrativeStatus): string {
  return ADMINISTRATIVE_STATUSES.find((s) => s.id === id)?.label ?? id
}

/**
 * Efeito da situação sobre NOVOS registros operacionais (inclusive alterações cadastrais).
 * - Arquivada: bloqueados (consulta preservada; desarquivamento só pela Administração da Plataforma).
 * - Suspensa (DEC-PAR-003) e Encerrada: NÃO há bloqueio automático geral; aplicam-se as
 *   restrições do próprio instrumento ou ato administrativo, fora do controle do sistema.
 */
export function allowsNewOperationalRecords(status: AdministrativeStatus): boolean {
  return status !== 'arquivada'
}

/** Situação documental do Plano de Trabalho aprovado: nunca "incorporado/validado" nesta versão. */
export const WORK_PLAN_DOCUMENT_STATUS = 'not-incorporated' as const

/**
 * DEC-PAR-005 — valor global com aplicabilidade explícita:
 * - `informed`: valor constante do instrumento (centavos; zero é um valor informado);
 * - `not-informed`: TC/TF cujo valor não foi informado no SIGOSC (NUNCA convertido em zero);
 * - `not-applicable`: Acordo de Cooperação (sem transferência de recursos financeiros).
 */
export const GLOBAL_VALUE_STATUSES = ['informed', 'not-informed', 'not-applicable'] as const
export type GlobalValueStatus = (typeof GLOBAL_VALUE_STATUSES)[number]

// ---------------------------------------------------------------------------
// Rascunho do cadastro e validação
// ---------------------------------------------------------------------------

/** Limites TÉCNICOS (proteção da aplicação), sem mínimo jurídico artificial. */
export const LIMITS = {
  instrumentNumber: { min: 1, max: 60 },
  publicPartner: { min: 1, max: 300 },
  object: { min: 1, max: 4000 },
  administrativeProcess: { max: 100 },
  /** R$ 1 trilhão em centavos: proteção numérica, não regra de negócio. */
  globalValueCents: { min: 0, max: 100_000_000_000_000 },
} as const

/**
 * Data de vigência da Lei 13.019/2014 para União, Estados e DF. NÃO é limite de cadastro
 * (DEC-PAR-005): formalizações anteriores geram apenas AVISO para conferência.
 */
export const MROSC_REFERENCE_DATE = '2016-01-23'

export interface PartnershipDraft {
  readonly instrument: InstrumentId
  readonly instrumentNumber: string
  readonly publicPartner: string
  readonly object: string
  readonly administrativeProcess: string | null
  readonly formalizationDate: string
  readonly termStart: string
  readonly termEnd: string
  readonly globalValueStatus: GlobalValueStatus
  /** Centavos somente quando `informed`; caso contrário `null`. */
  readonly globalValueCents: number | null
  /** DEC-PAR-006: situação administrativa efetiva, declarada pelo usuário. */
  readonly administrativeStatus: AdministrativeStatus
  /** Declaração de que o instrumento está formalizado e o Plano de Trabalho foi aprovado. */
  readonly workPlanApprovalDeclared: true
}

export const DRAFT_FIELDS = [
  'instrument',
  'instrumentNumber',
  'publicPartner',
  'object',
  'administrativeProcess',
  'formalizationDate',
  'termStart',
  'termEnd',
  'globalValueStatus',
  'globalValueCents',
  'administrativeStatus',
  'workPlanApprovalDeclared',
] as const

export type DraftField = (typeof DRAFT_FIELDS)[number]

export type DraftErrorCode =
  | 'required'
  | 'too-long'
  | 'invalid'
  | 'instrument-not-allowed'
  | 'invalid-date'
  | 'in-future'
  | 'end-before-start'
  | 'not-applicable'
  | 'out-of-range'
  | 'status-required'
  | 'declaration-required'

export type DraftErrors = Partial<Record<DraftField, DraftErrorCode>>

/** Avisos NÃO impeditivos: situação documental que pede conferência (DEC-PAR-005). */
export type DraftWarningCode = 'start-before-formalization' | 'before-mrosc-reference' | 'zero-value'
export type DraftWarnings = Partial<Record<DraftField, DraftWarningCode>>

export type DraftValidation =
  | { readonly ok: true; readonly draft: PartnershipDraft; readonly warnings: DraftWarnings }
  | { readonly ok: false; readonly errors: DraftErrors; readonly warnings: DraftWarnings }

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
// Caracteres de controle e separadores invisíveis não são aceitos em textos.
// eslint-disable-next-line no-control-regex -- recusa intencional de caracteres de controle
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u2028\\u2029]')

/** Data civil válida no formato AAAA-MM-DD (anos 1900–2999). */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DATE_PATTERN.exec(value)
  if (!match) return false
  const [, y, m, d] = match.map(Number) as [number, number, number, number]
  if (y < 1900 || y > 2999) return false
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/** Texto obrigatório/opcional com limite técnico. `null` quando inválido ou ausente. */
export function cleanText(value: unknown, max: number, multiline = false): { value: string | null; error: DraftErrorCode | null } {
  if (value === undefined || value === null || value === '') return { value: null, error: 'required' }
  if (typeof value !== 'string') return { value: null, error: 'invalid' }
  const trimmed = multiline ? value.trim() : value.trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0) return { value: null, error: 'required' }
  if (CONTROL.test(multiline ? trimmed.replace(/[\n\r\t]/g, ' ') : trimmed)) return { value: null, error: 'invalid' }
  if (trimmed.length > max) return { value: null, error: 'too-long' }
  return { value: trimmed, error: null }
}

/**
 * Valida o rascunho de cadastro. Determinística: `today` (AAAA-MM-DD) é informado pelo
 * chamador (no servidor, a data do servidor em Brasília). O servidor recusa o corpo
 * inteiro se houver campos fora de `DRAFT_FIELDS`.
 */
export function validatePartnershipDraft(input: Record<string, unknown>, today: string): DraftValidation {
  const errors: DraftErrors = {}
  const warnings: DraftWarnings = {}

  const instrument = input.instrument
  if (instrument === undefined || instrument === null || instrument === '') errors.instrument = 'required'
  else if (!isInstrument(instrument)) errors.instrument = 'instrument-not-allowed'

  const texts = {
    instrumentNumber: cleanText(input.instrumentNumber, LIMITS.instrumentNumber.max),
    publicPartner: cleanText(input.publicPartner, LIMITS.publicPartner.max),
    object: cleanText(input.object, LIMITS.object.max, true),
  }
  for (const [field, result] of Object.entries(texts)) if (result.error) errors[field as DraftField] = result.error

  let administrativeProcess: string | null = null
  if (input.administrativeProcess !== undefined && input.administrativeProcess !== null && input.administrativeProcess !== '') {
    const result = cleanText(input.administrativeProcess, LIMITS.administrativeProcess.max)
    if (result.error) errors.administrativeProcess = result.error
    administrativeProcess = result.value
  }

  // Datas: reais, formalização não futura, término coerente com o início (DEC-PAR-004/005).
  const { formalizationDate, termStart, termEnd } = input
  if (!formalizationDate) errors.formalizationDate = 'required'
  else if (!isValidDate(formalizationDate)) errors.formalizationDate = 'invalid-date'
  else if (formalizationDate > today) errors.formalizationDate = 'in-future'
  else if (formalizationDate < MROSC_REFERENCE_DATE) warnings.formalizationDate = 'before-mrosc-reference'

  if (!termStart) errors.termStart = 'required'
  else if (!isValidDate(termStart)) errors.termStart = 'invalid-date'
  else if (isValidDate(formalizationDate) && termStart < formalizationDate) warnings.termStart = 'start-before-formalization'

  if (!termEnd) errors.termEnd = 'required'
  else if (!isValidDate(termEnd)) errors.termEnd = 'invalid-date'
  else if (isValidDate(termStart) && termEnd < termStart) errors.termEnd = 'end-before-start'

  // Valor global com aplicabilidade explícita (DEC-PAR-005).
  let globalValueStatus: GlobalValueStatus | null = null
  let globalValueCents: number | null = null
  const status = input.globalValueStatus
  const cents = input.globalValueCents
  const noCents = cents === undefined || cents === null
  if (isInstrument(instrument) && !hasFinancialTransfer(instrument)) {
    if ((status !== undefined && status !== 'not-applicable') || !noCents) errors.globalValueCents = 'not-applicable'
    else globalValueStatus = 'not-applicable'
  } else if (isInstrument(instrument)) {
    if (status === 'not-informed') {
      if (!noCents) errors.globalValueCents = 'invalid'
      else globalValueStatus = 'not-informed'
    } else if (status === 'informed') {
      if (noCents) errors.globalValueCents = 'required'
      else if (typeof cents !== 'number' || !Number.isSafeInteger(cents)) errors.globalValueCents = 'invalid'
      else if (cents < LIMITS.globalValueCents.min || cents > LIMITS.globalValueCents.max) errors.globalValueCents = 'out-of-range'
      else {
        globalValueStatus = 'informed'
        globalValueCents = cents
        if (cents === 0) warnings.globalValueCents = 'zero-value'
      }
    } else {
      errors.globalValueStatus = status === undefined || status === null || status === '' ? 'required' : 'invalid'
    }
  }

  const administrativeStatus = input.administrativeStatus
  if (!isAdministrativeStatus(administrativeStatus)) errors.administrativeStatus = 'status-required'

  if (input.workPlanApprovalDeclared !== true) errors.workPlanApprovalDeclared = 'declaration-required'

  if (Object.keys(errors).length > 0) return { ok: false, errors, warnings }
  return {
    ok: true,
    warnings,
    draft: {
      instrument: instrument as InstrumentId,
      instrumentNumber: texts.instrumentNumber.value as string,
      publicPartner: texts.publicPartner.value as string,
      object: texts.object.value as string,
      administrativeProcess,
      formalizationDate: formalizationDate as string,
      termStart: termStart as string,
      termEnd: termEnd as string,
      globalValueStatus: globalValueStatus as GlobalValueStatus,
      globalValueCents,
      administrativeStatus: administrativeStatus as AdministrativeStatus,
      workPlanApprovalDeclared: true,
    },
  }
}

/** Mensagens objetivas por campo e motivo. */
export function draftErrorMessage(field: DraftField, code: DraftErrorCode): string {
  switch (code) {
    case 'required':
      if (field === 'instrument') return 'Selecione o instrumento MROSC.'
      if (field === 'globalValueStatus') return 'Informe o valor global ou indique que o instrumento não o informa.'
      if (field === 'globalValueCents') return 'Informe o valor global constante do instrumento.'
      return 'Campo obrigatório.'
    case 'too-long':
      return 'Texto acima do limite de caracteres.'
    case 'invalid':
      return field === 'globalValueCents' ? 'Informe um valor monetário válido (ex.: 150.000,00).' : 'Conteúdo inválido.'
    case 'instrument-not-allowed':
      return 'Instrumento não admitido. Somente Termo de Colaboração, Termo de Fomento ou Acordo de Cooperação.'
    case 'invalid-date':
      return 'Informe uma data válida.'
    case 'in-future':
      return 'Somente parcerias já formalizadas podem ser cadastradas: a data de formalização não pode ser futura.'
    case 'end-before-start':
      return 'O término da vigência não pode ser anterior ao início.'
    case 'not-applicable':
      return 'O Acordo de Cooperação não envolve transferência de recursos financeiros: o valor global não se aplica.'
    case 'out-of-range':
      return 'Valor fora do intervalo aceito.'
    case 'status-required':
      return 'Selecione a situação administrativa efetiva da parceria.'
    case 'declaration-required':
      return 'Confirme que o instrumento está formalizado e que o Plano de Trabalho foi aprovado.'
  }
}

/** Avisos para conferência (não impedem o cadastro). */
export function draftWarningMessage(code: DraftWarningCode): string {
  switch (code) {
    case 'start-before-formalization':
      return 'Início da vigência anterior à formalização. Confira as datas constantes do instrumento.'
    case 'before-mrosc-reference':
      return 'Formalização anterior a 23/01/2016 (vigência da Lei 13.019/2014 para União, Estados e DF). Confira se o instrumento é regido pelo MROSC.'
    case 'zero-value':
      return 'Valor global igual a zero. Confira se o instrumento informa esse valor.'
  }
}

// ---------------------------------------------------------------------------
// Alteração cadastral (DEC-PAR-001: partnerships.edit)
// ---------------------------------------------------------------------------

/**
 * Campos de CORREÇÃO cadastral. Os demais ficam protegidos porque sua alteração pode
 * constituir alteração formal do instrumento (aditivo, prorrogação, apostilamento) ou
 * transição de situação — matérias que exigem fluxos próprios ainda não especificados:
 * instrumento, datas de formalização e vigência, valor global, situação administrativa,
 * declaração do Plano de Trabalho, identificadores, OSC e autoria.
 */
export const EDITABLE_FIELDS = ['instrumentNumber', 'publicPartner', 'object', 'administrativeProcess'] as const
export type EditableField = (typeof EDITABLE_FIELDS)[number]
export type PartnershipChanges = Partial<Record<EditableField, string | null>>

export type ChangesValidation =
  | { readonly ok: true; readonly changes: PartnershipChanges }
  | { readonly ok: false; readonly errors: Partial<Record<EditableField | 'changes', DraftErrorCode>> }

export function validatePartnershipChanges(input: Record<string, unknown>): ChangesValidation {
  const errors: Partial<Record<EditableField | 'changes', DraftErrorCode>> = {}
  const changes: Record<string, string | null> = {}
  const keys = Object.keys(input)
  if (keys.length === 0) return { ok: false, errors: { changes: 'required' } }
  for (const key of keys) {
    if (!(EDITABLE_FIELDS as readonly string[]).includes(key)) return { ok: false, errors: { changes: 'invalid' } }
    const field = key as EditableField
    if (field === 'administrativeProcess' && (input[field] === null || input[field] === '')) {
      changes[field] = null
      continue
    }
    const max = field === 'object' ? LIMITS.object.max : field === 'publicPartner' ? LIMITS.publicPartner.max : field === 'instrumentNumber' ? LIMITS.instrumentNumber.max : LIMITS.administrativeProcess.max
    const result = cleanText(input[field], max, field === 'object')
    if (result.error) errors[field] = result.error
    else changes[field] = result.value
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, changes }
}

/** Chave de CONFERÊNCIA de possível duplicidade (não é restrição de unicidade — DEC-PAR-005). */
export function duplicateCheckKey(draft: Pick<PartnershipDraft, 'instrument' | 'instrumentNumber' | 'publicPartner'>): string {
  return [draft.instrument, normalizeForSearch(draft.instrumentNumber), normalizeForSearch(draft.publicPartner)].join('|')
}

/** Normaliza texto para pesquisa: minúsculas, sem acentos e espaços repetidos. */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** "Termo de Colaboração 06/2026" — identificação exibida (HF-G05). */
export function partnershipTitle(p: { instrument: InstrumentId; instrumentNumber: string }): string {
  return `${instrumentOf(p.instrument).label} ${p.instrumentNumber}`
}

// ---------------------------------------------------------------------------
// Autorização (DEC-PAR-001 e DEC-PAR-002)
// ---------------------------------------------------------------------------

export const CONSULT_PERMISSION = 'partnerships.view'
export const CREATE_PERMISSION = 'partnerships.create'
export const EDIT_PERMISSION = 'partnerships.edit'

export type PartnershipDenial = DenialReason | 'partnership-archived'
export type PartnershipDecision =
  | { readonly allowed: true; readonly authority: Authority }
  | { readonly allowed: false; readonly reason: PartnershipDenial }

/**
 * CADASTRO: exige `partnerships.create` (nunca `edit` nem `view`), vínculo ativo, OSC ativa
 * e situação comercial não suspensa. O administrador NÃO tem a permissão implicitamente.
 */
export function decidePartnershipCreation(context: AuthorizationContext): PartnershipDecision {
  return evaluate(context, { kind: 'operate', permission: CREATE_PERMISSION })
}

/**
 * ALTERAÇÃO CADASTRAL: exige `partnerships.edit` (nunca `create`). Parceria ARQUIVADA não
 * admite novos registros nem alterações; suspensa ou encerrada não são bloqueadas (DEC-PAR-003).
 */
export function decidePartnershipEdit(context: AuthorizationContext, status: AdministrativeStatus): PartnershipDecision {
  const decision = evaluate(context, { kind: 'operate', permission: EDIT_PERMISSION })
  if (!decision.allowed) return decision
  if (!allowsNewOperationalRecords(status)) return { allowed: false, reason: 'partnership-archived' }
  return decision
}

/** Mensagens das áreas de cadastro e edição. */
export const PARTNERSHIP_MESSAGE: Partial<Record<PartnershipDenial, string>> = {
  'commercial-suspension': 'A OSC está com a situação comercial suspensa. Novos registros estão bloqueados.',
  'partnership-archived': 'Parceria arquivada: somente consulta. Novos registros e alterações estão bloqueados; o desarquivamento compete exclusivamente à Administração da Plataforma.',
}

export const NO_CREATE_PERMISSION_MESSAGE = 'Você pode consultar as parcerias desta organização, mas não possui autorização para cadastrá-las.'
