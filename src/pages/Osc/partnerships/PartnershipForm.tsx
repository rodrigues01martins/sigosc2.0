import { useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import ds from '../../../components/ds/ds.module.css'
import { DENIAL_MESSAGE } from '../../../domain/authorization.ts'
import {
  ADMINISTRATIVE_STATUSES,
  INSTRUMENTS,
  LIMITS,
  PARTNERSHIP_MESSAGE,
  draftErrorMessage,
  draftWarningMessage,
  hasFinancialTransfer,
  isInstrument,
  validatePartnershipDraft,
  type DraftErrors,
  type DraftField,
  type DraftWarnings,
} from '../../../domain/partnerships.ts'
import { usePartnershipDependencies } from '../../../hooks/partnershipsContext.ts'
import type { ApiFailure, DuplicateCandidate } from '../../../services/partnerships/partnershipsApi.ts'
import { formatDate, formatTerm, parseMoneyToCents, todayInBrasilia } from './format.ts'
import styles from './Partnerships.module.css'

interface Props {
  oscId: string
  oscName: string
  onCancel(): void
  onCreated(partnershipId: string): void
  /** Data de referência (testes); por padrão, hoje no fuso de Brasília. */
  today?: string
}

interface Values {
  instrument: string
  instrumentNumber: string
  publicPartner: string
  object: string
  administrativeProcess: string
  formalizationDate: string
  termStart: string
  termEnd: string
  globalValue: string
  globalValueNotInformed: boolean
  administrativeStatus: string
  workPlanApprovalDeclared: boolean
}

const EMPTY: Values = {
  instrument: '',
  instrumentNumber: '',
  publicPartner: '',
  object: '',
  administrativeProcess: '',
  formalizationDate: '',
  termStart: '',
  termEnd: '',
  globalValue: '',
  globalValueNotInformed: false,
  administrativeStatus: '',
  workPlanApprovalDeclared: false,
}

const FIELD_ORDER: DraftField[] = [
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
]

const STATUS_HINT: Record<string, string> = {
  'em-execucao': 'Operações conforme as permissões.',
  suspensa: 'Sem bloqueio automático; valem as restrições do instrumento ou ato.',
  encerrada: 'Registros complementares e prestação de contas não são bloqueados.',
  arquivada: 'Somente consulta: novos registros bloqueados; desarquivar só pela Administração da Plataforma.',
}

export const SAVE_FAILURE = 'Não foi possível salvar a parceria. Nenhum cadastro foi confirmado.'

function failureMessage(result: ApiFailure): string {
  switch (result.error) {
    case 'forbidden':
      if (!result.reason) return SAVE_FAILURE
      return PARTNERSHIP_MESSAGE[result.reason] ?? (result.reason in DENIAL_MESSAGE ? DENIAL_MESSAGE[result.reason as keyof typeof DENIAL_MESSAGE] : SAVE_FAILURE)
    case 'session-expired':
      return 'Sua sessão expirou. Entre novamente para continuar. Nenhum cadastro foi confirmado.'
    case 'invalid-draft':
      return 'Revise os campos indicados. Nenhum cadastro foi confirmado.'
    case 'network':
      return `${SAVE_FAILURE} Verifique a conexão e tente novamente: os dados preenchidos foram mantidos.`
    default:
      return SAVE_FAILURE
  }
}

/** Monta os dados para o domínio a partir do formulário (valor monetário em centavos). */
function toInput(values: Values): Record<string, unknown> {
  const instrument = isInstrument(values.instrument) ? values.instrument : null
  const input: Record<string, unknown> = {
    instrument: values.instrument,
    instrumentNumber: values.instrumentNumber,
    publicPartner: values.publicPartner,
    object: values.object,
    administrativeProcess: values.administrativeProcess,
    formalizationDate: values.formalizationDate,
    termStart: values.termStart,
    termEnd: values.termEnd,
    administrativeStatus: values.administrativeStatus,
    workPlanApprovalDeclared: values.workPlanApprovalDeclared,
  }
  if (instrument && hasFinancialTransfer(instrument)) {
    if (values.globalValueNotInformed) input.globalValueStatus = 'not-informed'
    else if (values.globalValue.trim() !== '') {
      input.globalValueStatus = 'informed'
      input.globalValueCents = parseMoneyToCents(values.globalValue) ?? 'invalido'
    }
  }
  return input
}

/**
 * Cadastro da identificação de parceria formalizada (DEV-02.1-C01). Uma única tela, em grupos:
 * instrumento (seleção simples), identificação, datas, valor global (só TC/TF, com "não
 * informado" explícito), situação administrativa declarada e declaração do Plano aprovado.
 * Erros bloqueiam; avisos (DEC-PAR-005) apenas pedem conferência. Envio duplicado bloqueado;
 * sucesso somente após a confirmação do servidor; dados mantidos em caso de falha.
 */
export function PartnershipForm({ oscId, oscName, onCancel, onCreated, today = todayInBrasilia() }: Props) {
  const { api } = usePartnershipDependencies()
  const [values, setValues] = useState<Values>(EMPTY)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [duplicates, setDuplicates] = useState<{ count: number; candidates: readonly DuplicateCandidate[] } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Mesmo identificador em novas tentativas do MESMO cadastro (idempotência no servidor).
  const [requestId] = useState(() => globalThis.crypto.randomUUID())
  const inflight = useRef(false)
  const summaryRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const fid = (field: string) => `${id}-${field}`

  const instrument = isInstrument(values.instrument) ? values.instrument : null
  const financial = instrument !== null && hasFinancialTransfer(instrument)
  // Avisos calculados enquanto o usuário preenche (não bloqueiam o envio).
  const warnings: DraftWarnings = useMemo(() => validatePartnershipDraft(toInput(values), today).warnings, [values, today])

  function update<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((previous) => ({ ...previous, [key]: value }))
    if (duplicates) setDuplicates(null)
  }

  async function submit(acknowledgeDuplicates: boolean) {
    if (inflight.current) return
    setFailure(null)
    const validation = validatePartnershipDraft(toInput(values), today)
    if (!validation.ok) {
      setErrors(validation.errors)
      setDuplicates(null)
      queueMicrotask(() => summaryRef.current?.focus())
      return
    }
    setErrors({})
    inflight.current = true
    setSubmitting(true)
    const result = await api.create({ oscId, requestId, draft: validation.draft, acknowledgeDuplicates })
    inflight.current = false
    setSubmitting(false)
    if (result.ok) {
      onCreated(result.id)
      return
    }
    if (result.error === 'possible-duplicate' && result.duplicates) {
      setDuplicates(result.duplicates)
      queueMicrotask(() => summaryRef.current?.focus())
      return
    }
    if (result.error === 'invalid-draft' && result.fields) setErrors(result.fields)
    setFailure(failureMessage(result))
    queueMicrotask(() => summaryRef.current?.focus())
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void submit(false)
  }

  const errorList = FIELD_ORDER.filter((f) => errors[f])
  const describe = (field: DraftField, hint?: boolean) =>
    [hint ? fid(`${field}-hint`) : null, errors[field] ? fid(`${field}-error`) : null, warnings[field] ? fid(`${field}-warning`) : null]
      .filter(Boolean)
      .join(' ') || undefined
  const feedback = (field: DraftField) => (
    <>
      {errors[field] ? (
        <p id={fid(`${field}-error`)} className={styles.fieldError}>
          {draftErrorMessage(field, errors[field])}
        </p>
      ) : null}
      {warnings[field] && !errors[field] ? (
        <p id={fid(`${field}-warning`)} className={styles.fieldWarning}>
          Atenção: {draftWarningMessage(warnings[field])}
        </p>
      ) : null}
    </>
  )
  const req = (
    <span className={styles.required} aria-hidden="true">
      {' '}
      *
    </span>
  )
  const textField = (field: 'instrumentNumber' | 'publicPartner' | 'administrativeProcess', label: ReactNode, max: number, required: boolean, hint?: string) => (
    <div className={styles.formField}>
      <label className={styles.label} htmlFor={fid(field)}>
        {label}
        {required ? req : null}
      </label>
      <input
        id={fid(field)}
        className={styles.input}
        value={values[field]}
        maxLength={max}
        required={required}
        aria-invalid={errors[field] ? true : undefined}
        aria-describedby={describe(field, Boolean(hint))}
        onChange={(e) => update(field, e.target.value)}
      />
      {hint ? (
        <p id={fid(`${field}-hint`)} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {feedback(field)}
    </div>
  )
  const dateField = (field: 'formalizationDate' | 'termStart' | 'termEnd', label: string) => (
    <div className={styles.formField}>
      <label className={styles.label} htmlFor={fid(field)}>
        {label}
        {req}
      </label>
      <input
        id={fid(field)}
        type="date"
        className={styles.input}
        value={values[field]}
        max={field === 'formalizationDate' ? today : undefined}
        required
        aria-invalid={errors[field] ? true : undefined}
        aria-describedby={describe(field)}
        onChange={(e) => update(field, e.target.value)}
      />
      {feedback(field)}
    </div>
  )

  return (
    <section className={ds.card} aria-labelledby={fid('title')}>
      <div className={ds.stack}>
        <h2 id={fid('title')} className={ds.sectionTitle}>
          Cadastrar parceria formalizada
        </h2>
        <p className={ds.muted}>
          OSC proprietária: <strong>{oscName}</strong>. Somente instrumentos já formalizados (MROSC), em curso ou com vigência
          encerrada. O cadastro identifica a parceria no SIGOSC; não representa aprovação jurídica nem validação oficial do
          instrumento. Campos com <span aria-hidden="true">*</span>
          <span className={ds.srOnly}>asterisco</span> são obrigatórios.
        </p>
      </div>

      <div ref={summaryRef} tabIndex={-1}>
        {failure ? (
          <p className={ds.error} role="alert">
            {failure}
          </p>
        ) : null}
        {errorList.length > 0 && !failure ? (
          <div className={ds.error} role="alert">
            <div className={ds.stack}>
              <strong>
                Corrija {errorList.length} {errorList.length === 1 ? 'campo' : 'campos'} antes de salvar:
              </strong>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {errorList.map((f) => (
                  <li key={f}>
                    <a href={`#${fid(f === 'instrument' ? 'instrument-0' : f === 'administrativeStatus' ? 'administrativeStatus-0' : f === 'globalValueStatus' ? 'globalValueCents' : f)}`}>
                      {draftErrorMessage(f, errors[f] ?? 'invalid')}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        {duplicates ? (
          <div className={ds.warning} role="alert">
            <div className={ds.stack}>
              <strong>Possível duplicidade: confira antes de confirmar.</strong>
              <span>
                {duplicates.count === 1 ? 'Já existe 1 parceria' : `Já existem ${duplicates.count} parcerias`} nesta OSC com o mesmo
                instrumento, número e órgão público. Instrumentos distintos podem compartilhar esses dados; nenhum cadastro foi feito.
              </span>
              {duplicates.candidates.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: 20 }} aria-label="Parcerias semelhantes">
                  {duplicates.candidates.map((c) => (
                    <li key={c.id}>
                      {c.title} · {c.publicPartner} · formalizada em {formatDate(c.formalizationDate)} · vigência{' '}
                      {formatTerm(c.termStart, c.termEnd)}
                      {c.sameDates ? ' — mesmas datas: provável recadastramento do mesmo instrumento' : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <span>Os detalhes não são exibidos porque você não possui a permissão de consulta de parcerias.</span>
              )}
              <div className={styles.actions}>
                <button type="button" className={ds.secondary} disabled={submitting} onClick={() => void submit(true)}>
                  Confirmar cadastro de instrumento distinto
                </button>
                <button type="button" className={ds.linkButton} onClick={() => setDuplicates(null)} disabled={submitting}>
                  Revisar dados
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <form className={styles.form} noValidate onSubmit={onSubmit} aria-busy={submitting}>
        <fieldset className={styles.fieldset} aria-describedby={describe('instrument')}>
          <legend className={styles.label}>Instrumento MROSC{req}</legend>
          <div className={styles.choices}>
            {INSTRUMENTS.map((option, index) => (
              <label key={option.id} className={styles.choice}>
                <input
                  id={fid(`instrument-${index}`)}
                  type="radio"
                  name={fid('instrument')}
                  value={option.id}
                  checked={values.instrument === option.id}
                  aria-invalid={errors.instrument ? true : undefined}
                  onChange={() => update('instrument', option.id)}
                />
                {option.label}
              </label>
            ))}
          </div>
          {feedback('instrument')}
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.groupTitle}>Identificação</legend>
          <div className={styles.formGrid}>
            {textField('instrumentNumber', 'Número ou identificação do instrumento', LIMITS.instrumentNumber.max, true, 'Como consta do instrumento. Exemplo: 06/2026.')}
            {textField('publicPartner', 'Órgão ou entidade pública parceira', LIMITS.publicPartner.max, true)}
            <div className={`${styles.formField} ${styles.wide}`}>
              <label className={styles.label} htmlFor={fid('object')}>
                Objeto (descrição resumida){req}
              </label>
              <textarea
                id={fid('object')}
                className={styles.textarea}
                value={values.object}
                maxLength={LIMITS.object.max}
                required
                aria-invalid={errors.object ? true : undefined}
                aria-describedby={describe('object')}
                onChange={(e) => update('object', e.target.value)}
              />
              {feedback('object')}
            </div>
            {textField('administrativeProcess', 'Processo administrativo (opcional)', LIMITS.administrativeProcess.max, false)}
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.groupTitle}>Datas do instrumento</legend>
          <p className={styles.hint}>Informe as datas constantes do instrumento. A vigência pode estar em curso ou encerrada.</p>
          <div className={styles.formGrid}>
            {dateField('formalizationDate', 'Data de formalização')}
            {dateField('termStart', 'Início da vigência')}
            {dateField('termEnd', 'Término da vigência')}
          </div>
        </fieldset>

        {financial ? (
          <fieldset className={styles.group}>
            <legend className={styles.groupTitle}>Valor global{req}</legend>
            <div className={styles.formGrid}>
              <div className={styles.formField}>
                <label className={styles.label} htmlFor={fid('globalValueCents')}>
                  Valor global constante do instrumento (R$)
                </label>
                <input
                  id={fid('globalValueCents')}
                  className={styles.input}
                  inputMode="decimal"
                  value={values.globalValue}
                  disabled={values.globalValueNotInformed}
                  aria-invalid={errors.globalValueCents || errors.globalValueStatus ? true : undefined}
                  aria-describedby={[describe('globalValueCents', true), errors.globalValueStatus ? fid('globalValueStatus-error') : null].filter(Boolean).join(' ') || undefined}
                  onChange={(e) => update('globalValue', e.target.value)}
                />
                <p id={fid('globalValueCents-hint')} className={styles.hint}>
                  Exemplo: 150.000,00. Zero só se constar do instrumento.
                </p>
                {feedback('globalValueCents')}
                {feedback('globalValueStatus')}
              </div>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={values.globalValueNotInformed}
                  onChange={(e) => update('globalValueNotInformed', e.target.checked)}
                />
                <span>Valor global não informado no SIGOSC (fica registrado como “não informado”, não como zero).</span>
              </label>
            </div>
          </fieldset>
        ) : instrument === 'acordo-cooperacao' ? (
          <p className={ds.info} role="note">
            Acordo de Cooperação: sem transferência de recursos financeiros; o valor global não se aplica.
          </p>
        ) : null}

        <fieldset className={styles.group} aria-describedby={describe('administrativeStatus', true)}>
          <legend className={styles.groupTitle}>Situação administrativa atual{req}</legend>
          <p id={fid('administrativeStatus-hint')} className={styles.hint}>
            Informe a situação efetiva da parceria. Ela não é calculada pelas datas e não constitui validação jurídica do SIGOSC.
          </p>
          <div className={styles.choices}>
            {ADMINISTRATIVE_STATUSES.map((option, index) => (
              <label key={option.id} className={styles.choice}>
                <input
                  id={fid(`administrativeStatus-${index}`)}
                  type="radio"
                  name={fid('administrativeStatus')}
                  value={option.id}
                  checked={values.administrativeStatus === option.id}
                  aria-invalid={errors.administrativeStatus ? true : undefined}
                  onChange={() => update('administrativeStatus', option.id)}
                />
                {option.label}
              </label>
            ))}
          </div>
          {values.administrativeStatus ? <p className={styles.hint}>{STATUS_HINT[values.administrativeStatus]}</p> : null}
          {feedback('administrativeStatus')}
        </fieldset>

        <div>
          <label className={styles.check}>
            <input
              id={fid('workPlanApprovalDeclared')}
              type="checkbox"
              checked={values.workPlanApprovalDeclared}
              aria-invalid={errors.workPlanApprovalDeclared ? true : undefined}
              aria-describedby={describe('workPlanApprovalDeclared')}
              onChange={(e) => update('workPlanApprovalDeclared', e.target.checked)}
            />
            <span>
              Declaro que o instrumento está formalizado e que o Plano de Trabalho foi aprovado pela administração pública. O
              documento do Plano ainda não será incorporado ao SIGOSC.{req}
            </span>
          </label>
          {feedback('workPlanApprovalDeclared')}
        </div>

        <div className={styles.actions}>
          <button type="submit" className={ds.primary} disabled={submitting} aria-busy={submitting}>
            {submitting ? 'Salvando…' : 'Salvar parceria'}
          </button>
          <button type="button" className={ds.linkButton} onClick={onCancel} disabled={submitting}>
            Cancelar
          </button>
        </div>
      </form>
    </section>
  )
}
