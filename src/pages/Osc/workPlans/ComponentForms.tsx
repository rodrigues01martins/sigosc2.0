import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import ds from '../../../components/ds/ds.module.css'
import { COMPONENT_ERROR_MESSAGE, LIMITS, validateGoal, validateIndicator, type ComponentErrorCode, type ComponentErrors, type GoalData, type IndicatorData } from '../../../domain/workPlanComponents.ts'
import styles from '../partnerships/Partnerships.module.css'
import {
  MEASUREMENT_TYPES,
  NATURES,
  PERIODICITIES,
  RULE_METHODS,
  goalFormFrom,
  goalFromForm,
  indicatorFormFrom,
  indicatorFromForm,
  type GoalForm,
  type IndicatorForm,
  type Optional,
} from './componentForm.ts'

export type SubmitResult = { ok: true } | { ok: false; fields?: ComponentErrors; message: string }

const REQ = (
  <span className={styles.required} aria-hidden="true">
    {' '}
    *
  </span>
)

/** Estrutura comum: título, alerta focável, formulário e ações (uma tela; sem confirmações redundantes). */
function Shell({ title, intro, failure, alertRef, saving, submitLabel, onSubmit, onCancel, children }: { title: string; intro: string; failure: string | null; alertRef: React.RefObject<HTMLDivElement | null>; saving: boolean; submitLabel: string; onSubmit(e: FormEvent): void; onCancel(): void; children: ReactNode }) {
  const id = useId()
  return (
    <section className={ds.card} aria-labelledby={`${id}-t`}>
      <div className={ds.stack}>
        <h3 id={`${id}-t`} className={ds.sectionTitle}>
          {title}
        </h3>
        <p className={ds.muted}>{intro}</p>
      </div>
      <div ref={alertRef} tabIndex={-1}>
        {failure ? (
          <p className={ds.error} role="alert">
            {failure}
          </p>
        ) : null}
      </div>
      <form className={styles.form} noValidate onSubmit={onSubmit} aria-busy={saving}>
        {children}
        <div className={styles.actions}>
          <button type="submit" className={ds.primary} disabled={saving} aria-busy={saving}>
            {saving ? 'Gravando…' : submitLabel}
          </button>
          <button type="button" className={ds.linkButton} onClick={onCancel} disabled={saving}>
            Cancelar
          </button>
        </div>
      </form>
    </section>
  )
}

interface FieldProps {
  id: string
  label: string
  error?: ComponentErrorCode
  hint?: string
  required?: boolean
  wide?: boolean
  children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode
}
function Field({ id, label, error, hint, required, wide, children }: FieldProps) {
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined
  return (
    <div className={`${styles.formField} ${wide ? styles.wide : ''}`}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {required ? REQ : null}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': described })}
      {hint ? (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className={styles.fieldError}>
          {COMPONENT_ERROR_MESSAGE[error]}
        </p>
      ) : null}
    </div>
  )
}

function OptionalField({ id, label, value, onChange, error, hint, long, numeric, allowNA = true, max }: { id: string; label: string; value: Optional; onChange(v: Optional): void; error?: ComponentErrorCode; hint?: string; long?: boolean; numeric?: boolean; allowNA?: boolean; max: number }) {
  return (
    <Field id={id} label={label} error={error} hint={hint} wide={long}>
      {(p) => (
        <>
          {long ? (
            <textarea {...p} className={styles.textarea} value={value.text} disabled={value.na} maxLength={max} onChange={(e) => onChange({ ...value, text: e.target.value })} />
          ) : (
            <input {...p} className={styles.input} value={value.text} disabled={value.na} maxLength={max} inputMode={numeric ? 'decimal' : undefined} onChange={(e) => onChange({ ...value, text: e.target.value })} />
          )}
          {allowNA ? (
            <label className={styles.check}>
              <input type="checkbox" checked={value.na} onChange={(e) => onChange({ ...value, na: e.target.checked })} />
              <span>Não se aplica</span>
            </label>
          ) : null}
        </>
      )}
    </Field>
  )
}

function Choice({ legend, name, value, options, onChange, error, required }: { legend: string; name: string; value: string; options: readonly { id: string; label: string }[]; onChange(v: string): void; error?: ComponentErrorCode; required?: boolean }) {
  const id = useId()
  return (
    <fieldset className={styles.fieldset} aria-describedby={error ? `${id}-e` : undefined}>
      <legend className={styles.label}>
        {legend}
        {required ? REQ : null}
      </legend>
      <div className={styles.choices}>
        {options.map((o) => (
          <label key={o.id} className={styles.choice}>
            <input type="radio" name={`${id}-${name}`} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} />
            {o.label}
          </label>
        ))}
      </div>
      {error ? (
        <p id={`${id}-e`} className={styles.fieldError}>
          {COMPONENT_ERROR_MESSAGE[error]}
        </p>
      ) : null}
    </fieldset>
  )
}

/** Aviso da troca de natureza (DEC-PT-010): o que deixará de valer ao salvar; a auditoria registra a mudança. */
function NatureImpact({ lost, nature }: { lost: readonly string[]; nature: string }) {
  if (lost.length === 0) return null
  return (
    <p className={ds.warning} role="status">
      Ao salvar como {nature}, deixarão de valer: {lost.join('; ')}. Os valores continuam no formulário até salvar, e a alteração fica registrada na auditoria.
    </p>
  )
}

const STATUS_OPTIONS = [
  { id: 'active', label: 'Ativa no Plano' },
  { id: 'discontinued', label: 'Descontinuada nesta versão' },
] as const

function useSubmit(validate: () => { ok: true; data: GoalData | IndicatorData } | { ok: false; errors: ComponentErrors }, onSubmit: (data: GoalData | IndicatorData) => Promise<SubmitResult>) {
  const [errors, setErrors] = useState<ComponentErrors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inflight = useRef(false)
  const alertRef = useRef<HTMLDivElement>(null)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (inflight.current) return
    setFailure(null)
    const v = validate()
    if (!v.ok) {
      setErrors(v.errors)
      setFailure('Revise os campos indicados. Nada foi gravado.')
      queueMicrotask(() => alertRef.current?.focus())
      return
    }
    setErrors({})
    inflight.current = true
    setSaving(true)
    const result = await onSubmit(v.data)
    inflight.current = false
    setSaving(false)
    if (!result.ok) {
      if (result.fields) setErrors(result.fields)
      setFailure(result.message)
      queueMicrotask(() => alertRef.current?.focus())
    }
  }
  return { errors, failure, saving, alertRef, submit }
}

// --------------------------------------------------------------------------------- Meta

interface GoalProps {
  initial: GoalData | null
  suggestedCode: string
  order: number
  versionLabel: string
  onSubmit(data: GoalData): Promise<SubmitResult>
  onCancel(): void
}

/** Meta PREVISTA no Plano (HF-G05: "Meta 1"); campos além do homologado são opcionais. */
export function GoalFormCard({ initial, suggestedCode, order, versionLabel, onSubmit, onCancel }: GoalProps) {
  const id = useId()
  const [f, setF] = useState<GoalForm>(() => goalFormFrom(initial, suggestedCode))
  const set = <K extends keyof GoalForm>(k: K, v: GoalForm[K]) => setF((x) => ({ ...x, [k]: v }))
  const { errors, failure, saving, alertRef, submit } = useSubmit(() => {
    const raw = goalFromForm(f, order)
    if ('invalidNumber' in raw) return { ok: false, errors: { [String(raw.invalidNumber)]: 'invalid' } }
    const v = validateGoal(raw)
    return v.ok ? { ok: true, data: v.data } : { ok: false, errors: v.errors }
  }, (d) => onSubmit(d as GoalData))
  const quantitative = f.nature === 'quantitative'
  // DEC-PT-010: valores informados que deixariam de valer ao trocar a natureza (nunca descartados em silêncio).
  const lost = f.nature === 'qualitative' ? [f.expectedQuantity.text.trim() ? 'Quantidade prevista' : null, f.unit.text.trim() ? 'Unidade de medida' : null].filter((x): x is string => x !== null) : []
  return (
    <Shell
      title={initial ? `Editar meta ${initial.code}` : 'Adicionar meta'}
      intro={`Meta prevista no Plano aprovado (${versionLabel}). Não registre aqui resultados alcançados.`}
      failure={failure}
      alertRef={alertRef}
      saving={saving}
      submitLabel={initial ? 'Salvar meta' : 'Adicionar meta'}
      onSubmit={(e) => void submit(e)}
      onCancel={onCancel}
    >
      <div className={styles.formGrid}>
        <Field id={`${id}-code`} label="Código da meta" required error={errors.code} hint="Identificação de apresentação; pode ser ajustada.">
          {(p) => <input {...p} className={styles.input} value={f.code} maxLength={LIMITS.code} onChange={(e) => set('code', e.target.value)} />}
        </Field>
        <Field id={`${id}-description`} label="Descrição da meta" required error={errors.description} wide>
          {(p) => <textarea {...p} className={styles.textarea} value={f.description} maxLength={LIMITS.longText} onChange={(e) => set('description', e.target.value)} />}
        </Field>
      </div>
      <Choice legend="Natureza da meta" name="nature" value={f.nature} options={NATURES} onChange={(v) => set('nature', v)} error={errors.nature} required />
      <NatureImpact lost={lost} nature="qualitativa" />
      <div className={styles.formGrid}>
        {quantitative ? (
          <>
            <OptionalField id={`${id}-qty`} label="Quantidade prevista" value={f.expectedQuantity} onChange={(v) => set('expectedQuantity', v)} error={errors.expectedQuantity} hint="Use vírgula para decimais. Zero é um valor informado; deixe vazio se não informado." numeric max={30} />
            <OptionalField id={`${id}-unit`} label="Unidade de medida" value={f.unit} onChange={(v) => set('unit', v)} error={errors.unit} hint="Ex.: participantes, oficinas." max={LIMITS.unit} />
          </>
        ) : null}
        <OptionalField id={`${id}-result`} label="Resultado previsto" value={f.expectedResult} onChange={(v) => set('expectedResult', v)} error={errors.expectedResult} long max={LIMITS.longText} />
        <OptionalField id={`${id}-criterion`} label="Critério de cumprimento" value={f.completionCriterion} onChange={(v) => set('completionCriterion', v)} error={errors.completionCriterion} long max={LIMITS.longText} />
        <OptionalField id={`${id}-period`} label="Período de referência" value={f.referencePeriod} onChange={(v) => set('referencePeriod', v)} error={errors.referencePeriod} hint="Como consta do Plano (ex.: 1º ano de execução)." max={LIMITS.shortText} />
      </div>
      {initial ? <Choice legend="Situação no Plano" name="status" value={f.status} options={STATUS_OPTIONS} onChange={(v) => set('status', v as GoalForm['status'])} error={errors.status} /> : null}
    </Shell>
  )
}

// ---------------------------------------------------------------------------- Indicador

interface IndicatorProps {
  initial: IndicatorData | null
  suggestedCode: string
  order: number
  versionLabel: string
  goals: readonly { id: string; code: string; description: string; active: boolean }[]
  presetGoal: string | null
  onSubmit(data: IndicatorData): Promise<SubmitResult>
  onCancel(): void
}

/** Indicador PREVISTO (HF-G05: indicador e fórmula; PAG-OSC08: periodicidade individual). */
export function IndicatorFormCard({ initial, suggestedCode, order, versionLabel, goals, presetGoal, onSubmit, onCancel }: IndicatorProps) {
  const id = useId()
  const [f, setF] = useState<IndicatorForm>(() => indicatorFormFrom(initial, suggestedCode, presetGoal))
  const set = <K extends keyof IndicatorForm>(k: K, v: IndicatorForm[K]) => setF((x) => ({ ...x, [k]: v }))
  const known = new Set(goals.map((g) => g.id))
  const { errors, failure, saving, alertRef, submit } = useSubmit(() => {
    const raw = indicatorFromForm(f, order)
    if ('invalidNumber' in raw) return { ok: false, errors: { [String(raw.invalidNumber)]: 'invalid' } }
    const v = validateIndicator(raw, known)
    return v.ok ? { ok: true, data: v.data } : { ok: false, errors: v.errors }
  }, (d) => onSubmit(d as IndicatorData))
  const quantitative = f.nature === 'quantitative'
  const selectable = goals.filter((g) => g.active || f.goalIds.includes(g.id))
  const lost =
    f.nature === 'qualitative'
      ? [f.measurementType ? 'Tipo de resultado numérico' : null, f.target.text.trim() ? 'Resultado previsto (valor-alvo)' : null, f.unit.text.trim() ? 'Unidade de medida' : null, f.ruleMethod !== 'described' ? 'Método, numerador, denominador e multiplicador' : null].filter((x): x is string => x !== null)
      : f.nature === 'quantitative' && f.categories.trim()
        ? ['Categorias de classificação']
        : []
  return (
    <Shell
      title={initial ? `Editar indicador ${initial.code}` : 'Adicionar indicador'}
      intro={`Indicador previsto no Plano aprovado (${versionLabel}). A fórmula é registrada como consta do Plano; nenhum cálculo é executado nesta etapa.`}
      failure={failure}
      alertRef={alertRef}
      saving={saving}
      submitLabel={initial ? 'Salvar indicador' : 'Adicionar indicador'}
      onSubmit={(e) => void submit(e)}
      onCancel={onCancel}
    >
      <div className={styles.formGrid}>
        <Field id={`${id}-code`} label="Código do indicador" required error={errors.code}>
          {(p) => <input {...p} className={styles.input} value={f.code} maxLength={LIMITS.code} onChange={(e) => set('code', e.target.value)} />}
        </Field>
        <Field id={`${id}-name`} label="Nome do indicador" required error={errors.name}>
          {(p) => <input {...p} className={styles.input} value={f.name} maxLength={LIMITS.shortText} onChange={(e) => set('name', e.target.value)} />}
        </Field>
      </div>
      <Choice legend="Natureza do indicador" name="nature" value={f.nature} options={NATURES} onChange={(v) => set('nature', v)} error={errors.nature} required />
      <NatureImpact lost={lost} nature={f.nature === 'qualitative' ? 'qualitativo' : 'quantitativo'} />
      <fieldset className={styles.fieldset} aria-describedby={errors.goalIds ? `${id}-goals-e` : `${id}-goals-h`}>
        <legend className={styles.label}>Metas vinculadas</legend>
        {selectable.length === 0 ? (
          <p id={`${id}-goals-h`} className={styles.hint}>
            Nenhuma meta ativa nesta versão. O indicador pode ser registrado sem vínculo.
          </p>
        ) : (
          <>
            <div className={styles.choices}>
              {selectable.map((g) => (
                <label key={g.id} className={styles.choice}>
                  <input
                    type="checkbox"
                    checked={f.goalIds.includes(g.id)}
                    onChange={(e) => set('goalIds', e.target.checked ? [...f.goalIds, g.id] : f.goalIds.filter((x) => x !== g.id))}
                  />
                  {g.code}
                  {g.active ? '' : ' (descontinuada)'}
                </label>
              ))}
            </div>
            <p id={`${id}-goals-h`} className={styles.hint}>
              Selecione as metas que o indicador mensura, conforme o Plano; pode haver mais de uma ou nenhuma.
            </p>
          </>
        )}
        {errors.goalIds ? (
          <p id={`${id}-goals-e`} className={styles.fieldError}>
            {COMPONENT_ERROR_MESSAGE[errors.goalIds]}
          </p>
        ) : null}
      </fieldset>
      <div className={styles.formGrid}>
        {quantitative ? (
          <>
            <Field id={`${id}-mtype`} label="Tipo de resultado numérico" required error={errors.measurementType}>
              {(p) => (
                <select {...p} className={styles.input} value={f.measurementType} onChange={(e) => set('measurementType', e.target.value)}>
                  <option value="">Selecione</option>
                  {MEASUREMENT_TYPES.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <OptionalField id={`${id}-target`} label="Resultado previsto (valor-alvo)" value={f.target} onChange={(v) => set('target', v)} error={errors.target} hint="Valor previsto no Plano, não o apurado. Use vírgula para decimais; zero é um valor informado." numeric max={30} />
            <OptionalField id={`${id}-unit`} label="Unidade de medida" value={f.unit} onChange={(v) => set('unit', v)} error={errors.unit} hint="Ex.: %, pessoas, por mil." max={LIMITS.unit} />
          </>
        ) : null}
        <OptionalField id={`${id}-param`} label="Parâmetro esperado" value={f.expectedParameter} onChange={(v) => set('expectedParameter', v)} error={errors.expectedParameter} hint={quantitative ? 'Complemento textual, se houver (ex.: "conforme a meta 2").' : 'Condição objetiva de atendimento, como consta do Plano.'} long max={LIMITS.longText} />
        <Field id={`${id}-per`} label="Periodicidade do indicador" error={f.periodicityKind === 'not-applicable' ? undefined : errors.periodicity} hint="Individual por indicador. Pode ficar pendente durante o cadastro; deve estar resolvida para finalizar.">
          {(p) => (
            <select {...p} className={styles.input} value={f.periodicityKind} onChange={(e) => set('periodicityKind', e.target.value)}>
              <option value="">Não informada</option>
              {PERIODICITIES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
              <option value="not-applicable">Não se aplica (justificar)</option>
            </select>
          )}
        </Field>
        {f.periodicityKind === 'not-applicable' ? (
          <Field id={`${id}-perj`} label="Justificativa da inaplicabilidade" required error={errors.periodicity} hint="Obrigatória; mínimo de 10 caracteres." wide>
            {(p) => <textarea {...p} className={styles.textarea} value={f.periodicityJustification} maxLength={LIMITS.longText} onChange={(e) => set('periodicityJustification', e.target.value)} />}
          </Field>
        ) : null}
        {f.periodicityKind === 'other' ? (
          <Field id={`${id}-perdesc`} label="Descrição da periodicidade" required error={errors.periodicity}>
            {(p) => <input {...p} className={styles.input} value={f.periodicityDescription} maxLength={LIMITS.shortText} onChange={(e) => set('periodicityDescription', e.target.value)} />}
          </Field>
        ) : null}
      </div>
      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>Fórmula ou regra de mensuração</legend>
        <div className={styles.formGrid}>
          {quantitative ? (
            <Field id={`${id}-method`} label="Método" error={errors['rule.method']}>
              {(p) => (
                <select {...p} className={styles.input} value={f.ruleMethod} onChange={(e) => set('ruleMethod', e.target.value)}>
                  {RULE_METHODS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
          <Field id={`${id}-rule`} label={quantitative ? 'Fórmula, como consta do Plano' : 'Regra ou critério qualitativo'} required error={errors['rule.description']} hint="Texto registrado; o SIGOSC não executa fórmulas." wide>
            {(p) => <textarea {...p} className={styles.textarea} value={f.ruleDescription} maxLength={LIMITS.ruleText} onChange={(e) => set('ruleDescription', e.target.value)} />}
          </Field>
          {quantitative && f.ruleMethod === 'ratio' ? (
            <>
              <Field id={`${id}-num`} label="Numerador" required error={errors['rule.numerator']}>
                {(p) => <input {...p} className={styles.input} value={f.numerator} maxLength={LIMITS.shortText} onChange={(e) => set('numerator', e.target.value)} />}
              </Field>
              <Field id={`${id}-den`} label="Denominador" required error={errors['rule.denominator']}>
                {(p) => <input {...p} className={styles.input} value={f.denominator} maxLength={LIMITS.shortText} onChange={(e) => set('denominator', e.target.value)} />}
              </Field>
            </>
          ) : null}
          {quantitative && f.ruleMethod !== 'described' ? (
            <Field id={`${id}-mult`} label="Multiplicador (opcional)" error={errors['rule.multiplier']} hint="Ex.: 100 para percentual.">
              {(p) => <input {...p} className={styles.input} inputMode="decimal" value={f.multiplier} maxLength={12} onChange={(e) => set('multiplier', e.target.value)} />}
            </Field>
          ) : null}
          {!quantitative && f.nature ? (
            <Field id={`${id}-cat`} label="Categorias de classificação (uma por linha)" error={errors.categories} hint="Somente as definidas no Plano; o SIGOSC não cria escalas." wide>
              {(p) => <textarea {...p} className={styles.textarea} value={f.categories} onChange={(e) => set('categories', e.target.value)} />}
            </Field>
          ) : null}
        </div>
      </fieldset>
      <div className={styles.formGrid}>
        <OptionalField id={`${id}-class`} label="Critério de classificação" value={f.classificationCriterion} onChange={(v) => set('classificationCriterion', v)} error={errors.classificationCriterion} long max={LIMITS.longText} />
        <OptionalField id={`${id}-source`} label="Fonte ou meio de verificação previsto" value={f.verificationSource} onChange={(v) => set('verificationSource', v)} error={errors.verificationSource} long max={LIMITS.longText} />
        <OptionalField id={`${id}-desc`} label="Descrição do indicador" value={f.description} onChange={(v) => set('description', v)} error={errors.description} long max={LIMITS.longText} />
      </div>
      {initial ? <Choice legend="Situação no Plano" name="status" value={f.status} options={STATUS_OPTIONS.map((o) => ({ ...o, label: o.label.replace('Ativa', 'Ativo').replace('Descontinuada', 'Descontinuado') }))} onChange={(v) => set('status', v as IndicatorForm['status'])} error={errors.status} /> : null}
    </Shell>
  )
}
