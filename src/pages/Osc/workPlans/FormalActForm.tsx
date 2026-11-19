import { useId, useRef, useState, type FormEvent } from 'react'
import ds from '../../../components/ds/ds.module.css'
import {
  FORMAL_ACT_LIMITS,
  FORMAL_ACT_TYPES,
  formalActErrorMessage,
  validateFormalAct,
  type FormalAct,
  type FormalActErrorCode,
  type FormalActField,
} from '../../../domain/workPlanVersions.ts'
import styles from '../partnerships/Partnerships.module.css'
import { todayInBrasilia } from '../partnerships/format.ts'

type Errors = Partial<Record<FormalActField | 'formalAct', FormalActErrorCode>>

interface Props {
  mode: 'create' | 'edit'
  baseLabel: string
  initial?: FormalAct | null
  /** Envia o ato validado; devolve erros do servidor ou mensagem de falha (dados mantidos). */
  onSubmit(act: FormalAct): Promise<{ ok: true } | { ok: false; fields?: Errors; message: string }>
  onCancel(): void
  today?: string
}

/**
 * Registro do ato formal de uma ALTERAÇÃO FORMAL do Plano (DEC-034). Uma tela: tipo (HF-G05:
 * aditivo ou apostilamento; "outro ato" identificado), data do ato (obrigatórios), referência,
 * data de efeitos (só se documentada) e descrição. Informação DECLARADA; não validada pelo SIGOSC.
 */
export function FormalActForm({ mode, baseLabel, initial, onSubmit, onCancel, today = todayInBrasilia() }: Props) {
  const [values, setValues] = useState({
    type: initial?.type ?? '',
    typeDescription: initial?.typeDescription ?? '',
    reference: initial?.reference ?? '',
    actDate: initial?.actDate ?? '',
    effectiveDate: initial?.effectiveDate ?? '',
    description: initial?.description ?? '',
  })
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inflight = useRef(false)
  const alertRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const set = (key: keyof typeof values, value: string) => setValues((v) => ({ ...v, [key]: value }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (inflight.current) return
    setFailure(null)
    const validation = validateFormalAct({ ...values, typeDescription: values.type === 'outro-ato' ? values.typeDescription : null }, today)
    if (!validation.ok) {
      setErrors(validation.errors)
      setFailure('Revise os dados do ato formal. Nada foi gravado.')
      queueMicrotask(() => alertRef.current?.focus())
      return
    }
    setErrors({})
    inflight.current = true
    setSaving(true)
    const result = await onSubmit(validation.act)
    inflight.current = false
    setSaving(false)
    if (!result.ok) {
      if (result.fields) setErrors(result.fields)
      setFailure(result.message)
      queueMicrotask(() => alertRef.current?.focus())
    }
  }

  const describe = (key: FormalActField) => (errors[key] ? `${id}-${key}-error` : undefined)
  const errorText = (key: FormalActField) =>
    errors[key] ? (
      <p id={`${id}-${key}-error`} className={styles.fieldError}>
        {formalActErrorMessage(key, errors[key])}
      </p>
    ) : null
  const req = (
    <span className={styles.required} aria-hidden="true">
      {' '}
      *
    </span>
  )

  return (
    <section className={ds.card} aria-labelledby={`${id}-title`}>
      <div className={ds.stack}>
        <h2 id={`${id}-title`} className={ds.sectionTitle}>
          {mode === 'create' ? 'Registrar alteração formal do Plano' : 'Editar dados do ato formal'}
        </h2>
        <p className={ds.muted}>
          {mode === 'create'
            ? `Registre somente alteração já formalizada. Será criada uma nova versão integral a partir da ${baseLabel}, que permanece preservada; depois, ajuste apenas os campos alterados.`
            : 'Os dados do ato podem ser ajustados enquanto a versão estiver em cadastramento.'}{' '}
          As informações são declaradas por você; o SIGOSC não valida o ato e o documento não é armazenado.
        </p>
      </div>
      <div ref={alertRef} tabIndex={-1}>
        {failure ? (
          <p className={ds.error} role="alert">
            {failure}
          </p>
        ) : null}
      </div>
      <form className={styles.form} noValidate onSubmit={(e) => void submit(e)} aria-busy={saving}>
        <fieldset className={styles.fieldset} aria-describedby={describe('type')}>
          <legend className={styles.label}>Tipo do ato formal{req}</legend>
          <div className={styles.choices}>
            {FORMAL_ACT_TYPES.map((t) => (
              <label key={t.id} className={styles.choice}>
                <input type="radio" name={`${id}-type`} value={t.id} checked={values.type === t.id} onChange={() => set('type', t.id)} />
                {t.label}
              </label>
            ))}
          </div>
          {errorText('type')}
        </fieldset>
        <div className={styles.formGrid}>
          {values.type === 'outro-ato' ? (
            <div className={styles.formField}>
              <label className={styles.label} htmlFor={`${id}-typeDescription`}>
                Identificação do ato{req}
              </label>
              <input id={`${id}-typeDescription`} className={styles.input} value={values.typeDescription} maxLength={FORMAL_ACT_LIMITS.typeDescription} aria-invalid={errors.typeDescription ? true : undefined} aria-describedby={describe('typeDescription')} onChange={(e) => set('typeDescription', e.target.value)} />
              {errorText('typeDescription')}
            </div>
          ) : null}
          <div className={styles.formField}>
            <label className={styles.label} htmlFor={`${id}-reference`}>
              Número ou referência administrativa
            </label>
            <input id={`${id}-reference`} className={styles.input} value={values.reference} maxLength={FORMAL_ACT_LIMITS.reference} aria-invalid={errors.reference ? true : undefined} aria-describedby={describe('reference')} onChange={(e) => set('reference', e.target.value)} />
            {errorText('reference')}
          </div>
          <div className={styles.formField}>
            <label className={styles.label} htmlFor={`${id}-actDate`}>
              Data do ato ou de sua aprovação{req}
            </label>
            <input id={`${id}-actDate`} type="date" className={styles.input} value={values.actDate} max={today} aria-invalid={errors.actDate ? true : undefined} aria-describedby={describe('actDate')} onChange={(e) => set('actDate', e.target.value)} />
            {errorText('actDate')}
          </div>
          <div className={styles.formField}>
            <label className={styles.label} htmlFor={`${id}-effectiveDate`}>
              Data de produção de efeitos (se constar do documento)
            </label>
            <input id={`${id}-effectiveDate`} type="date" className={styles.input} value={values.effectiveDate} aria-invalid={errors.effectiveDate ? true : undefined} aria-describedby={describe('effectiveDate')} onChange={(e) => set('effectiveDate', e.target.value)} />
            {errorText('effectiveDate')}
          </div>
          <div className={`${styles.formField} ${styles.wide}`}>
            <label className={styles.label} htmlFor={`${id}-description`}>
              Descrição da alteração
            </label>
            <textarea id={`${id}-description`} className={styles.textarea} value={values.description} maxLength={FORMAL_ACT_LIMITS.description} aria-invalid={errors.description ? true : undefined} aria-describedby={describe('description')} onChange={(e) => set('description', e.target.value)} />
            {errorText('description')}
          </div>
        </div>
        <div className={styles.actions}>
          <button type="submit" className={ds.primary} disabled={saving} aria-busy={saving}>
            {saving ? 'Gravando…' : mode === 'create' ? 'Criar nova versão' : 'Salvar dados do ato'}
          </button>
          <button type="button" className={ds.linkButton} onClick={onCancel} disabled={saving}>
            Cancelar
          </button>
        </div>
      </form>
    </section>
  )
}
