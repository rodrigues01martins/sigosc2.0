import { useId, useRef, useState, type FormEvent } from 'react'
import ds from '../../../components/ds/ds.module.css'
import { DENIAL_MESSAGE } from '../../../domain/authorization.ts'
import {
  INSTRUMENTS,
  LIMITS,
  REGISTRATION_MESSAGE,
  draftErrorMessage,
  hasFinancialTransfer,
  isInstrument,
  validatePartnershipDraft,
  type DraftErrors,
  type DraftField,
} from '../../../domain/partnerships.ts'
import { usePartnershipDependencies } from '../../../hooks/partnershipsContext.ts'
import type { CreateResult } from '../../../services/partnerships/partnershipsApi.ts'
import { parseMoneyToCents, todayInBrasilia } from './format.ts'
import styles from './Partnerships.module.css'

interface Props {
  oscId: string
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
  'globalValueCents',
  'workPlanApprovalDeclared',
]

export const SAVE_FAILURE = 'Não foi possível salvar a parceria. Nenhum cadastro foi confirmado.'

function failureMessage(result: Extract<CreateResult, { ok: false }>): string {
  switch (result.error) {
    case 'forbidden':
      return result.reason ? (REGISTRATION_MESSAGE[result.reason] ?? DENIAL_MESSAGE[result.reason as keyof typeof DENIAL_MESSAGE] ?? SAVE_FAILURE) : SAVE_FAILURE
    case 'session-expired':
      return 'Sua sessão expirou. Entre novamente para continuar. Nenhum cadastro foi confirmado.'
    case 'duplicate':
      return 'Já existe parceria cadastrada nesta OSC com o mesmo instrumento, número e órgão público. Nenhum cadastro foi confirmado.'
    case 'invalid-draft':
      return 'Revise os campos indicados. Nenhum cadastro foi confirmado.'
    case 'network':
      return `${SAVE_FAILURE} Verifique a conexão e tente novamente.`
    default:
      return SAVE_FAILURE
  }
}

/**
 * Cadastro da identificação de parceria formalizada (DEV-02.1) — PREPARADO.
 * Uma única tela: seleção simples do instrumento, campos adaptados (Acordo de
 * Cooperação sem valor global), validação imediata no envio, mensagens por campo,
 * bloqueio de envio duplicado e sucesso somente após a confirmação do servidor.
 * Só é exibido quando a decisão de cadastro é favorável (hoje: nunca — ver README).
 */
export function PartnershipForm({ oscId, onCancel, onCreated, today = todayInBrasilia() }: Props) {
  const { api } = usePartnershipDependencies()
  const [values, setValues] = useState<Values>(EMPTY)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Mesmo identificador em novas tentativas do MESMO cadastro (idempotência no servidor).
  const [requestId] = useState(() => globalThis.crypto.randomUUID())
  const inflight = useRef(false)
  const summaryRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const fid = (field: string) => `${id}-${field}`

  const instrument = isInstrument(values.instrument) ? values.instrument : null
  const financial = instrument !== null && hasFinancialTransfer(instrument)

  function update<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((previous) => ({ ...previous, [key]: value }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (inflight.current) return
    setFailure(null)

    const cents = values.globalValue.trim() === '' ? null : parseMoneyToCents(values.globalValue)
    const input: Record<string, unknown> = {
      instrument: values.instrument,
      instrumentNumber: values.instrumentNumber,
      publicPartner: values.publicPartner,
      object: values.object,
      administrativeProcess: values.administrativeProcess,
      formalizationDate: values.formalizationDate,
      termStart: values.termStart,
      termEnd: values.termEnd,
      workPlanApprovalDeclared: values.workPlanApprovalDeclared,
    }
    if (financial) input.globalValueCents = values.globalValue.trim() === '' ? null : (cents ?? 'invalido')
    const validation = validatePartnershipDraft(input, today)
    if (!validation.ok) {
      setErrors(validation.errors)
      queueMicrotask(() => summaryRef.current?.focus())
      return
    }
    setErrors({})
    inflight.current = true
    setSubmitting(true)
    const result = await api.create({ oscId, requestId, draft: validation.draft })
    inflight.current = false
    setSubmitting(false)
    if (result.ok) {
      onCreated(result.id)
      return
    }
    if (result.error === 'invalid-draft' && result.fields) setErrors(result.fields)
    setFailure(failureMessage(result))
    queueMicrotask(() => summaryRef.current?.focus())
  }

  const errorList = FIELD_ORDER.filter((f) => errors[f])
  const describe = (field: DraftField, hint?: boolean) =>
    [hint ? fid(`${field}-hint`) : null, errors[field] ? fid(`${field}-error`) : null].filter(Boolean).join(' ') || undefined
  const fieldError = (field: DraftField) =>
    errors[field] ? (
      <p id={fid(`${field}-error`)} className={styles.fieldError}>
        {draftErrorMessage(field, errors[field])}
      </p>
    ) : null
  const req = (
    <span className={styles.required} aria-hidden="true">
      {' '}
      *
    </span>
  )

  return (
    <section className={ds.card} aria-labelledby={fid('title')}>
      <div className={ds.stack}>
        <h2 id={fid('title')} className={ds.sectionTitle}>
          Cadastrar parceria formalizada
        </h2>
        <p className={ds.muted}>
          Somente instrumentos já formalizados (MROSC). O cadastro identifica a parceria no SIGOSC; não representa aprovação
          jurídica nem validação oficial do instrumento. Campos com <span aria-hidden="true">*</span>
          <span className={ds.srOnly}>asterisco</span> são obrigatórios.
        </p>
      </div>

      <div ref={summaryRef} tabIndex={-1} aria-live="assertive">
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
                    <a href={`#${fid(f === 'instrument' ? 'instrument-0' : f)}`}>{draftErrorMessage(f, errors[f] ?? 'invalid')}</a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>

      <form className={styles.form} noValidate onSubmit={(e) => void submit(e)} aria-busy={submitting}>
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
          {fieldError('instrument')}
        </fieldset>

        <div className={styles.formGrid}>
          <div className={styles.formField}>
            <label className={styles.label} htmlFor={fid('instrumentNumber')}>
              Número ou identificação do instrumento{req}
            </label>
            <input
              id={fid('instrumentNumber')}
              className={styles.input}
              value={values.instrumentNumber}
              maxLength={LIMITS.instrumentNumber.max}
              required
              aria-invalid={errors.instrumentNumber ? true : undefined}
              aria-describedby={describe('instrumentNumber', true)}
              onChange={(e) => update('instrumentNumber', e.target.value)}
            />
            <p id={fid('instrumentNumber-hint')} className={styles.hint}>
              Exemplo: 06/2026.
            </p>
            {fieldError('instrumentNumber')}
          </div>

          <div className={styles.formField}>
            <label className={styles.label} htmlFor={fid('publicPartner')}>
              Órgão ou entidade pública parceira{req}
            </label>
            <input
              id={fid('publicPartner')}
              className={styles.input}
              value={values.publicPartner}
              maxLength={LIMITS.publicPartner.max}
              required
              aria-invalid={errors.publicPartner ? true : undefined}
              aria-describedby={describe('publicPartner')}
              onChange={(e) => update('publicPartner', e.target.value)}
            />
            {fieldError('publicPartner')}
          </div>

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
            {fieldError('object')}
          </div>

          <div className={styles.formField}>
            <label className={styles.label} htmlFor={fid('administrativeProcess')}>
              Processo administrativo (opcional)
            </label>
            <input
              id={fid('administrativeProcess')}
              className={styles.input}
              value={values.administrativeProcess}
              maxLength={LIMITS.administrativeProcess.max}
              aria-invalid={errors.administrativeProcess ? true : undefined}
              aria-describedby={describe('administrativeProcess')}
              onChange={(e) => update('administrativeProcess', e.target.value)}
            />
            {fieldError('administrativeProcess')}
          </div>

          <div className={styles.formField}>
            <label className={styles.label} htmlFor={fid('formalizationDate')}>
              Data de formalização{req}
            </label>
            <input
              id={fid('formalizationDate')}
              type="date"
              className={styles.input}
              value={values.formalizationDate}
              max={today}
              required
              aria-invalid={errors.formalizationDate ? true : undefined}
              aria-describedby={describe('formalizationDate')}
              onChange={(e) => update('formalizationDate', e.target.value)}
            />
            {fieldError('formalizationDate')}
          </div>

          <div className={styles.formField}>
            <label className={styles.label} htmlFor={fid('termStart')}>
              Início da vigência{req}
            </label>
            <input
              id={fid('termStart')}
              type="date"
              className={styles.input}
              value={values.termStart}
              required
              aria-invalid={errors.termStart ? true : undefined}
              aria-describedby={describe('termStart')}
              onChange={(e) => update('termStart', e.target.value)}
            />
            {fieldError('termStart')}
          </div>

          <div className={styles.formField}>
            <label className={styles.label} htmlFor={fid('termEnd')}>
              Término da vigência{req}
            </label>
            <input
              id={fid('termEnd')}
              type="date"
              className={styles.input}
              value={values.termEnd}
              required
              aria-invalid={errors.termEnd ? true : undefined}
              aria-describedby={describe('termEnd', true)}
              onChange={(e) => update('termEnd', e.target.value)}
            />
            <p id={fid('termEnd-hint')} className={styles.hint}>
              Vigência vigente, sem prorrogações (registradas separadamente em incremento futuro).
            </p>
            {fieldError('termEnd')}
          </div>

          {financial ? (
            <div className={styles.formField}>
              <label className={styles.label} htmlFor={fid('globalValueCents')}>
                Valor global (R$){req}
              </label>
              <input
                id={fid('globalValueCents')}
                className={styles.input}
                inputMode="decimal"
                value={values.globalValue}
                required
                aria-invalid={errors.globalValueCents ? true : undefined}
                aria-describedby={describe('globalValueCents', true)}
                onChange={(e) => update('globalValue', e.target.value)}
              />
              <p id={fid('globalValueCents-hint')} className={styles.hint}>
                Exemplo: 150.000,00.
              </p>
              {fieldError('globalValueCents')}
            </div>
          ) : instrument === 'acordo-cooperacao' ? (
            <p className={ds.info} role="note">
              Acordo de Cooperação: sem transferência de recursos financeiros; valor global não se aplica.
            </p>
          ) : null}
        </div>

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
              Declaro que o instrumento está formalizado e que o Plano de Trabalho foi aprovado pela administração pública.
              O documento do Plano ainda não será incorporado ao SIGOSC.{req}
            </span>
          </label>
          {fieldError('workPlanApprovalDeclared')}
        </div>

        <div className={styles.actions}>
          <button type="submit" className={ds.primary} aria-disabled={submitting || undefined} disabled={submitting} aria-busy={submitting}>
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
