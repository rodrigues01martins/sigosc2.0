import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import ds from '../../../components/ds/ds.module.css'
import {
  FIN_ERROR_MESSAGE,
  FIN_LIMITS,
  FUNDING_SOURCES,
  STANDARD_CATEGORIES,
  derivedTotalCents,
  parseBrlToCents,
  parseQuantity,
  validateFinancialCategory,
  validateFinancialItem,
  type FinErrorCode,
  type FinErrors,
  type FinancialCategoryData,
  type FinancialItemData,
  type FinStatus,
} from '../../../domain/workPlanFinancial.ts'
import styles from '../partnerships/Partnerships.module.css'
import { categoryFormFrom, categoryFromForm, centsText, formatCents, itemFormFrom, itemFromForm, type CategoryForm, type ItemForm, type Opt } from './financialForm.ts'

export type FinSubmitResult = { ok: true } | { ok: false; fields?: FinErrors; message: string }

const REQ = (
  <span className={styles.required} aria-hidden="true">
    {' '}
    *
  </span>
)

function useSubmit<T>(validate: () => { ok: true; data: T } | { ok: false; errors: FinErrors }, onSubmit: (data: T) => Promise<FinSubmitResult>) {
  const [errors, setErrors] = useState<FinErrors>({})
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

function Field({ id, label, error, hint, required, wide, children }: { id: string; label: string; error?: FinErrorCode; hint?: string; required?: boolean; wide?: boolean; children: (p: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode }) {
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
          {FIN_ERROR_MESSAGE[error]}
        </p>
      ) : null}
    </div>
  )
}

function OptField({ id, label, value, onChange, error, hint, long, inputMode, max, allowNA = true }: { id: string; label: string; value: Opt; onChange(v: Opt): void; error?: FinErrorCode; hint?: string; long?: boolean; inputMode?: 'decimal'; max: number; allowNA?: boolean }) {
  return (
    <Field id={id} label={label} error={error} hint={hint} wide={long}>
      {(p) => (
        <>
          {long ? (
            <textarea {...p} className={styles.textarea} value={value.text} disabled={value.na} maxLength={max} onChange={(e) => onChange({ ...value, text: e.target.value })} />
          ) : (
            <input {...p} className={styles.input} value={value.text} disabled={value.na} maxLength={max} inputMode={inputMode} onChange={(e) => onChange({ ...value, text: e.target.value })} />
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

function StatusChoice({ value, onChange, error, labels }: { value: string; onChange(v: 'active' | 'discontinued'): void; error?: FinErrorCode; labels: [string, string] }) {
  const id = useId()
  return (
    <fieldset className={styles.fieldset} aria-describedby={error ? `${id}-e` : undefined}>
      <legend className={styles.label}>Situação na versão</legend>
      <div className={styles.choices}>
        {(['active', 'discontinued'] as const).map((s, n) => (
          <label key={s} className={styles.choice}>
            <input type="radio" name={`${id}-status`} checked={value === s} onChange={() => onChange(s)} />
            {labels[n]}
          </label>
        ))}
      </div>
      {error ? (
        <p id={`${id}-e`} className={styles.fieldError}>
          {FIN_ERROR_MESSAGE[error]}
        </p>
      ) : null}
    </fieldset>
  )
}

// ------------------------------------------------------------------ categoria

export function CategoryFormCard({ initial, suggestedCode, order, versionLabel, onSubmit, onCancel }: { initial: FinancialCategoryData | null; suggestedCode: string; order: number; versionLabel: string; onSubmit(d: FinancialCategoryData): Promise<FinSubmitResult>; onCancel(): void }) {
  const id = useId()
  const [f, setF] = useState<CategoryForm>(() => categoryFormFrom(initial, suggestedCode))
  const set = <K extends keyof CategoryForm>(k: K, v: CategoryForm[K]) => setF((x) => ({ ...x, [k]: v }))
  const { errors, failure, saving, alertRef, submit } = useSubmit(() => validateFinancialCategory(categoryFromForm(f, order)), onSubmit)
  return (
    <Shell
      title={initial ? `Editar categoria ${initial.code}` : 'Adicionar categoria'}
      intro={`Categoria do planejamento financeiro do Plano aprovado (${versionLabel}). Use o nome adotado no documento; a categoria padronizada é a correspondência no SIGOSC.`}
      failure={failure}
      alertRef={alertRef}
      saving={saving}
      submitLabel={initial ? 'Salvar categoria' : 'Adicionar categoria'}
      onSubmit={(e) => void submit(e)}
      onCancel={onCancel}
    >
      <div className={styles.formGrid}>
        <Field id={`${id}-std`} label="Categoria padronizada correspondente" error={errors.standardCategory} hint="Modelo híbrido: categorias padronizadas e itens configurados no Plano.">
          {(p) => (
            <select
              {...p}
              className={styles.input}
              value={f.standardCategory}
              onChange={(e) => {
                const std = STANDARD_CATEGORIES.find((c) => c.id === e.target.value)
                setF((x) => ({ ...x, standardCategory: e.target.value, name: x.name.trim() || !std ? x.name : std.label }))
              }}
            >
              <option value="">Classificação própria do Plano</option>
              {STANDARD_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id={`${id}-name`} label="Nome da categoria (como no Plano)" required error={errors.name}>
          {(p) => <input {...p} className={styles.input} value={f.name} maxLength={FIN_LIMITS.name} onChange={(e) => set('name', e.target.value)} />}
        </Field>
        <Field id={`${id}-code`} label="Código da categoria" required error={errors.code}>
          {(p) => <input {...p} className={styles.input} value={f.code} maxLength={FIN_LIMITS.code} onChange={(e) => set('code', e.target.value)} />}
        </Field>
      </div>
      {initial ? <StatusChoice value={f.status} onChange={(v) => set('status', v)} error={errors.status} labels={['Ativa nesta versão', 'Descontinuada nesta versão']} /> : null}
    </Shell>
  )
}

// ------------------------------------------------------------------ item

interface ItemProps {
  initial: FinancialItemData | null
  suggestedCode: string
  order: number
  versionLabel: string
  categories: readonly { id: string; label: string; status: FinStatus }[]
  presetCategory: string | null
  onSubmit(d: FinancialItemData): Promise<FinSubmitResult>
  onCancel(): void
}

/** Item PREVISTO (HF-G05: "Item F1" e "Valor previsto"); quantidade e valor unitário são opcionais. */
export function ItemFormCard({ initial, suggestedCode, order, versionLabel, categories, presetCategory, onSubmit, onCancel }: ItemProps) {
  const id = useId()
  const [f, setF] = useState<ItemForm>(() => itemFormFrom(initial, suggestedCode, presetCategory))
  const set = <K extends keyof ItemForm>(k: K, v: ItemForm[K]) => setF((x) => ({ ...x, [k]: v }))
  const statusMap = new Map(categories.map((c) => [c.id, c.status]))
  const { errors, failure, saving, alertRef, submit } = useSubmit(() => {
    const raw = itemFromForm(f, order)
    if ('invalid' in raw) return { ok: false, errors: { [String(raw.invalid)]: 'invalid' } }
    return validateFinancialItem(raw, statusMap)
  }, onSubmit)
  // Valor derivado (quantidade × valor unitário) — somente oferecido; nunca aplicado sem ação do usuário.
  const q = f.quantity.na ? null : parseQuantity(f.quantity.text)
  const u = f.unitValue.na ? null : parseBrlToCents(f.unitValue.text)
  const derived = typeof q === 'string' && typeof u === 'number' ? derivedTotalCents(q, u) : null
  const typed = f.plannedValue.na ? null : parseBrlToCents(f.plannedValue.text)
  const selectable = categories.filter((c) => c.status === 'active' || c.id === f.categoryId)
  return (
    <Shell
      title={initial ? `Editar item ${initial.code}` : 'Adicionar item previsto'}
      intro={`Item do planejamento financeiro aprovado (${versionLabel}). Registre o valor previsto como consta do Plano; não registre despesas realizadas.`}
      failure={failure}
      alertRef={alertRef}
      saving={saving}
      submitLabel={initial ? 'Salvar item' : 'Adicionar item'}
      onSubmit={(e) => void submit(e)}
      onCancel={onCancel}
    >
      <div className={styles.formGrid}>
        <Field id={`${id}-code`} label="Código do item" required error={errors.code} hint='Ex.: "F1", como no Plano.'>
          {(p) => <input {...p} className={styles.input} value={f.code} maxLength={FIN_LIMITS.code} onChange={(e) => set('code', e.target.value)} />}
        </Field>
        <Field id={`${id}-cat`} label="Categoria" required error={errors.categoryId}>
          {(p) => (
            <select {...p} className={styles.input} value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">Selecione</option>
              {selectable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.status === 'active' ? '' : ' (descontinuada)'}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id={`${id}-desc`} label="Descrição do item" required error={errors.description} wide>
          {(p) => <textarea {...p} className={styles.textarea} value={f.description} maxLength={FIN_LIMITS.description} onChange={(e) => set('description', e.target.value)} />}
        </Field>
        <OptField id={`${id}-planned`} label="Valor previsto (R$)" value={f.plannedValue} onChange={(v) => set('plannedValue', v)} error={errors.plannedValue} hint='Padrão brasileiro: "1.200,00". "0,00" é zero informado; vazio = não informado.' inputMode="decimal" max={24} />
        <OptField id={`${id}-qty`} label="Quantidade prevista" value={f.quantity} onChange={(v) => set('quantity', v)} error={errors.quantity} hint="Opcional; até 4 casas decimais." inputMode="decimal" max={20} />
        <OptField id={`${id}-unitv`} label="Valor unitário previsto (R$)" value={f.unitValue} onChange={(v) => set('unitValue', v)} error={errors.unitValue} hint="Opcional; quando o Plano detalhar o item." inputMode="decimal" max={24} />
        <OptField id={`${id}-unit`} label="Unidade de medida" value={f.unit} onChange={(v) => set('unit', v)} error={errors.unit} max={FIN_LIMITS.unit} />
      </div>
      {derived !== null && derived !== typed ? (
        <div className={`${ds.info} ${styles.actions}`} role="status">
          <span>Quantidade × valor unitário = {formatCents(derived)}{typed !== null && typed !== 'invalid' ? '; difere do valor previsto digitado (o valor do Plano prevalece).' : '.'}</span>
          <span className={styles.touch}>
            <button type="button" className={ds.secondary} onClick={() => set('plannedValue', { text: centsText(derived), na: false })}>
              Usar {formatCents(derived)} como valor previsto
            </button>
          </span>
        </div>
      ) : null}
      {typeof q === 'string' && typeof u === 'number' && derived === null ? (
        <p className={ds.warning} role="status">
          Quantidade × valor unitário não resulta em centavos exatos; informe o valor previsto como consta do Plano.
        </p>
      ) : null}
      <div className={styles.formGrid}>
        <Field id={`${id}-src`} label="Fonte prevista do recurso" error={errors.fundingSource} hint="Opcional. Não é receita recebida.">
          {(p) => (
            <select {...p} className={styles.input} value={f.fundingSource} onChange={(e) => set('fundingSource', e.target.value)}>
              <option value="">Não informada</option>
              {FUNDING_SOURCES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <OptField id={`${id}-period`} label="Período ou referência temporal" value={f.period} onChange={(v) => set('period', v)} error={errors.period} max={FIN_LIMITS.shortText} />
        <OptField id={`${id}-details`} label="Detalhamento" value={f.details} onChange={(v) => set('details', v)} error={errors.details} long max={FIN_LIMITS.description} />
        <OptField id={`${id}-memory`} label="Memória de cálculo" value={f.calculationMemory} onChange={(v) => set('calculationMemory', v)} error={errors.calculationMemory} hint="Texto informativo; o SIGOSC não executa cálculos digitados." long max={FIN_LIMITS.description} />
      </div>
      {initial ? <StatusChoice value={f.status} onChange={(v) => set('status', v)} error={errors.status} labels={['Ativo nesta versão', 'Descontinuado nesta versão']} /> : null}
    </Shell>
  )
}
