/**
 * Domínio da Gestão de Parcerias (DEV-02.1) — puro e sem dependências.
 *
 * Usado pela interface (exibição e validação imediata) e pelo servidor
 * (`api/_lib/partnershipsService.ts`), que valida novamente e decide.
 *
 * Escopo: identificação de parcerias JÁ FORMALIZADAS sob a Lei 13.019/2014 (MROSC).
 * O cadastro NÃO representa aprovação jurídica nem validação oficial do instrumento.
 */
import { evaluate, PERMISSION_CATALOG, type AuthorizationContext, type Authority, type DenialReason } from './authorization.ts'

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
 * As transições (suspender, encerrar, arquivar) NÃO estão implementadas: a situação
 * inicial é definida pelo servidor e não é escolhida pelo usuário.
 */
export const ADMINISTRATIVE_STATUSES = [
  { id: 'em-execucao', label: 'Em execução' },
  { id: 'suspensa', label: 'Suspensa' },
  { id: 'encerrada', label: 'Encerrada' },
  { id: 'arquivada', label: 'Arquivada' },
] as const

export type AdministrativeStatus = (typeof ADMINISTRATIVE_STATUSES)[number]['id']
export const INITIAL_ADMINISTRATIVE_STATUS: AdministrativeStatus = 'em-execucao'

export function isAdministrativeStatus(value: unknown): value is AdministrativeStatus {
  return typeof value === 'string' && ADMINISTRATIVE_STATUSES.some((s) => s.id === value)
}

export function administrativeStatusLabel(id: AdministrativeStatus): string {
  return ADMINISTRATIVE_STATUSES.find((s) => s.id === id)?.label ?? id
}

/** Situação documental do Plano de Trabalho aprovado: nesta versão, nunca "incorporado/validado". */
export const WORK_PLAN_DOCUMENT_STATUS = 'not-incorporated' as const

// ---------------------------------------------------------------------------
// Rascunho do cadastro e validação
// ---------------------------------------------------------------------------

export const LIMITS = {
  instrumentNumber: { min: 1, max: 40 },
  publicPartner: { min: 3, max: 200 },
  object: { min: 10, max: 1000 },
  administrativeProcess: { max: 60 },
  globalValueCents: { min: 1, max: 100_000_000_000_00 },
} as const

/**
 * Data inicial de vigência da Lei 13.019/2014 para União, Estados e DF (art. 88).
 * Formalizações anteriores não são parcerias do MROSC. (Para municípios, a lei vigora
 * desde 01/01/2017; a data menor é usada para não recusar instrumentos válidos.)
 */
export const MROSC_START_DATE = '2016-01-23'

export interface PartnershipDraft {
  readonly instrument: InstrumentId
  readonly instrumentNumber: string
  readonly publicPartner: string
  readonly object: string
  readonly administrativeProcess: string | null
  readonly formalizationDate: string
  readonly termStart: string
  readonly termEnd: string
  /** Centavos. Obrigatório para TC/TF; DEVE ser `null` para Acordo de Cooperação. */
  readonly globalValueCents: number | null
  /** Declaração de que o instrumento está formalizado e o Plano de Trabalho foi aprovado. */
  readonly workPlanApprovalDeclared: true
}

export type DraftField =
  | 'instrument'
  | 'instrumentNumber'
  | 'publicPartner'
  | 'object'
  | 'administrativeProcess'
  | 'formalizationDate'
  | 'termStart'
  | 'termEnd'
  | 'globalValueCents'
  | 'workPlanApprovalDeclared'

export type DraftErrorCode =
  | 'required'
  | 'too-short'
  | 'too-long'
  | 'invalid'
  | 'instrument-not-allowed'
  | 'invalid-date'
  | 'before-mrosc'
  | 'in-future'
  | 'start-before-formalization'
  | 'end-not-after-start'
  | 'term-ended'
  | 'not-applicable'
  | 'out-of-range'
  | 'declaration-required'

export type DraftErrors = Partial<Record<DraftField, DraftErrorCode>>

export type DraftValidation =
  | { readonly ok: true; readonly draft: PartnershipDraft }
  | { readonly ok: false; readonly errors: DraftErrors }

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
// Caracteres de controle e separadores invisíveis não são aceitos em textos.
// eslint-disable-next-line no-control-regex -- recusa intencional de caracteres de controle
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u2028\\u2029]')

/** Data civil válida no formato AAAA-MM-DD. */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DATE_PATTERN.exec(value)
  if (!match) return false
  const [, y, m, d] = match.map(Number) as [number, number, number, number]
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function text(value: unknown, field: DraftField, limits: { min?: number; max: number }, errors: DraftErrors, multiline = false): string | null {
  if (typeof value !== 'string') {
    errors[field] = 'required'
    return null
  }
  const trimmed = multiline ? value.trim() : value.trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0) {
    errors[field] = 'required'
    return null
  }
  if (CONTROL.test(multiline ? trimmed.replace(/[\n\r\t]/g, ' ') : trimmed)) {
    errors[field] = 'invalid'
    return null
  }
  if (limits.min !== undefined && trimmed.length < limits.min) errors[field] = 'too-short'
  else if (trimmed.length > limits.max) errors[field] = 'too-long'
  return trimmed
}

/**
 * Valida o rascunho de cadastro. Determinística: `today` (AAAA-MM-DD) é informado
 * pelo chamador (no servidor, a data do servidor). Campos desconhecidos são ignorados
 * aqui; o servidor recusa o corpo inteiro se houver campos fora do esquema.
 */
export function validatePartnershipDraft(input: Record<string, unknown>, today: string): DraftValidation {
  const errors: DraftErrors = {}

  const instrument = input.instrument
  if (instrument === undefined || instrument === null || instrument === '') errors.instrument = 'required'
  else if (!isInstrument(instrument)) errors.instrument = 'instrument-not-allowed'

  const instrumentNumber = text(input.instrumentNumber, 'instrumentNumber', LIMITS.instrumentNumber, errors)
  const publicPartner = text(input.publicPartner, 'publicPartner', LIMITS.publicPartner, errors)
  const object = text(input.object, 'object', LIMITS.object, errors, true)

  let administrativeProcess: string | null = null
  if (input.administrativeProcess !== undefined && input.administrativeProcess !== null && input.administrativeProcess !== '') {
    administrativeProcess = text(input.administrativeProcess, 'administrativeProcess', LIMITS.administrativeProcess, errors)
  }

  const { formalizationDate, termStart, termEnd } = input
  if (!formalizationDate) errors.formalizationDate = 'required'
  else if (!isValidDate(formalizationDate)) errors.formalizationDate = 'invalid-date'
  else if (formalizationDate < MROSC_START_DATE) errors.formalizationDate = 'before-mrosc'
  else if (formalizationDate > today) errors.formalizationDate = 'in-future'

  if (!termStart) errors.termStart = 'required'
  else if (!isValidDate(termStart)) errors.termStart = 'invalid-date'
  else if (isValidDate(formalizationDate) && termStart < formalizationDate) errors.termStart = 'start-before-formalization'

  if (!termEnd) errors.termEnd = 'required'
  else if (!isValidDate(termEnd)) errors.termEnd = 'invalid-date'
  else if (isValidDate(termStart) && termEnd <= termStart) errors.termEnd = 'end-not-after-start'
  else if (termEnd < today) errors.termEnd = 'term-ended'

  let globalValueCents: number | null = null
  const value = input.globalValueCents
  const empty = value === undefined || value === null || value === ''
  if (isInstrument(instrument) && !hasFinancialTransfer(instrument)) {
    // Acordo de Cooperação: o campo não se aplica e não pode ser informado.
    if (!empty) errors.globalValueCents = 'not-applicable'
  } else if (isInstrument(instrument)) {
    if (empty) errors.globalValueCents = 'required'
    else if (typeof value !== 'number' || !Number.isSafeInteger(value)) errors.globalValueCents = 'invalid'
    else if (value < LIMITS.globalValueCents.min || value > LIMITS.globalValueCents.max) errors.globalValueCents = 'out-of-range'
    else globalValueCents = value
  }

  if (input.workPlanApprovalDeclared !== true) errors.workPlanApprovalDeclared = 'declaration-required'

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    draft: {
      instrument: instrument as InstrumentId,
      instrumentNumber: instrumentNumber as string,
      publicPartner: publicPartner as string,
      object: object as string,
      administrativeProcess,
      formalizationDate: formalizationDate as string,
      termStart: termStart as string,
      termEnd: termEnd as string,
      globalValueCents,
      workPlanApprovalDeclared: true,
    },
  }
}

/** Mensagens objetivas por campo e motivo. */
export function draftErrorMessage(field: DraftField, code: DraftErrorCode): string {
  switch (code) {
    case 'required':
      return field === 'instrument' ? 'Selecione o instrumento MROSC.' : 'Campo obrigatório.'
    case 'too-short':
      return field === 'object' ? `Descreva o objeto com pelo menos ${LIMITS.object.min} caracteres.` : 'Texto muito curto.'
    case 'too-long':
      return 'Texto acima do limite de caracteres.'
    case 'invalid':
      return field === 'globalValueCents' ? 'Informe um valor monetário válido (ex.: 150.000,00).' : 'Conteúdo inválido.'
    case 'instrument-not-allowed':
      return 'Instrumento não admitido. Somente Termo de Colaboração, Termo de Fomento ou Acordo de Cooperação.'
    case 'invalid-date':
      return 'Informe uma data válida.'
    case 'before-mrosc':
      return 'Data anterior à vigência da Lei 13.019/2014 (23/01/2016).'
    case 'in-future':
      return 'Somente parcerias já formalizadas podem ser cadastradas: a data de formalização não pode ser futura.'
    case 'start-before-formalization':
      return 'O início da vigência não pode ser anterior à data de formalização.'
    case 'end-not-after-start':
      return 'O término da vigência deve ser posterior ao início.'
    case 'term-ended':
      return 'A vigência já terminou. Parcerias encerradas não podem ser incorporadas nesta versão.'
    case 'not-applicable':
      return 'O Acordo de Cooperação não envolve transferência de recursos financeiros: não informe valor global.'
    case 'out-of-range':
      return 'Valor fora do intervalo aceito.'
    case 'declaration-required':
      return 'Confirme que o instrumento está formalizado e que o Plano de Trabalho foi aprovado.'
  }
}

/** Chave de unicidade por OSC: instrumento + número + parceiro público (normalizados). */
export function uniquenessKey(draft: Pick<PartnershipDraft, 'instrument' | 'instrumentNumber' | 'publicPartner'>): string {
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
// Autorização do cadastro
// ---------------------------------------------------------------------------

/** Permissão do catálogo que corresponde ao registro de parcerias. */
export const REGISTRATION_PERMISSION = 'partnerships.edit'
export const CONSULT_PERMISSION = 'partnerships.view'

export type RegistrationDenial = DenialReason | 'pending-specification'
export type RegistrationDecision =
  | { readonly allowed: true; readonly authority: Authority }
  | { readonly allowed: false; readonly reason: RegistrationDenial }

/**
 * Decide o CADASTRO de parceria. Enquanto `partnerships.edit` estiver
 * "pendente de especificação" no catálogo, NENHUM usuário pode cadastrar
 * (motivo `pending-specification`). As demais negações (sessão, vínculo,
 * suspensão comercial) continuam prevalecendo, na ordem do avaliador.
 */
export function decidePartnershipRegistration(context: AuthorizationContext): RegistrationDecision {
  const decision = evaluate(context, { kind: 'operate', permission: REGISTRATION_PERMISSION })
  if (decision.allowed) return decision
  const entry = PERMISSION_CATALOG.find((e) => e.id === REGISTRATION_PERMISSION)
  if (decision.reason === 'invalid-permission' && entry?.status === 'pending-specification') {
    return { allowed: false, reason: 'pending-specification' }
  }
  return decision
}

/** Mensagens da área de cadastro (PAG-OSC02). */
export const REGISTRATION_MESSAGE: Partial<Record<RegistrationDenial, string>> = {
  'pending-specification':
    'O cadastro de parcerias aguarda a especificação da competência de registro (permissão “Registrar e editar parcerias”). Nesta versão, nenhuma parceria pode ser cadastrada.',
  'commercial-suspension': 'A OSC está com a situação comercial suspensa. Novos registros estão bloqueados.',
  'permission-not-granted': 'Você pode consultar as parcerias desta organização, mas não possui autorização para cadastrá-las.',
}
