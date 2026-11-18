import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import ds from '../../../components/ds/ds.module.css'
import { DENIAL_MESSAGE } from '../../../domain/authorization.ts'
import {
  FIELD_DEFINITIONS as FIELDS,
  GROUPS,
  MAX_BENEFICIARIES,
  WORK_PLAN_MESSAGE,
  fieldErrorMessage,
  validateChanges,
  type FieldErrorCode,
  type FieldValue,
  type WorkPlanField,
} from '../../../domain/workPlans.ts'
import { useWorkPlanDependencies } from '../../../hooks/workPlansContext.ts'
import type { WorkPlan } from '../../../services/workPlans/types.ts'
import styles from '../partnerships/Partnerships.module.css'
import { todayInBrasilia } from '../partnerships/format.ts'
import { formFromValues, valueFromForm, type FormState } from './form.ts'

const same = (a: FieldValue, b: FieldValue) => JSON.stringify(a) === JSON.stringify(b)

interface Props {
  plan: WorkPlan
  initialForm?: FormState
  /** Recarga em andamento após conflito: novo envio aguardará a revisão atualizada. */
  reloading?: boolean
  onDirtyChange(dirty: boolean): void
  onSaved(): void
  onStale(form: FormState): void
  today?: string
}

/**
 * Cadastro estruturado EM ANDAMENTO (DEV-02.2): uma página, em seções; salvar envia somente os
 * campos alterados, com a revisão lida (concorrência) e identificador de pedido (reenvio seguro).
 * Os dados digitados são mantidos em falha de rede ou alteração concorrente.
 */
export function WorkPlanEditor({ plan, initialForm, reloading = false, onDirtyChange, onSaved, onStale, today = todayInBrasilia() }: Props) {
  const { api } = useWorkPlanDependencies()
  const [form, setForm] = useState<FormState>(() => initialForm ?? formFromValues(plan.values))
  const [errors, setErrors] = useState<Partial<Record<WorkPlanField | 'changes', FieldErrorCode | 'required'>>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [requestId, setRequestId] = useState(() => globalThis.crypto.randomUUID())
  const inflight = useRef(false)
  const alertRef = useRef<HTMLDivElement>(null)
  const id = useId()

  const changes = useMemo(() => {
    const result: Record<string, FieldValue | 'invalid'> = {}
    for (const f of FIELDS) {
      const value = valueFromForm(f.id, form[f.id])
      if (value === 'invalid' || !same(value, plan.values[f.id])) result[f.id] = value
    }
    return result
  }, [form, plan.values])
  const dirty = Object.keys(changes).length > 0
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  function set(field: WorkPlanField, patch: Partial<{ text: string; na: boolean }>) {
    setForm((f) => ({ ...f, [field]: { ...f[field], ...patch } }))
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (inflight.current || reloading) return
    setFailure(null)
    if (!dirty) {
      setFailure('Nenhuma alteração a salvar.')
      return
    }
    const local: Partial<Record<WorkPlanField, FieldErrorCode>> = {}
    for (const [field, value] of Object.entries(changes)) if (value === 'invalid') local[field as WorkPlanField] = 'out-of-range'
    const validation = validateChanges(Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== 'invalid')), plan.values, today)
    const all = { ...(validation.ok ? {} : validation.errors), ...local }
    if (Object.keys(all).length > 0) {
      setErrors(all)
      setFailure('Revise os campos indicados. Nenhuma alteração foi salva.')
      queueMicrotask(() => alertRef.current?.focus())
      return
    }
    setErrors({})
    inflight.current = true
    setSaving(true)
    const result = await api.update({ oscId: plan.oscId, partnershipId: plan.partnershipId, requestId, expectedRevision: plan.revision, changes: changes as Partial<Record<WorkPlanField, FieldValue>> })
    inflight.current = false
    setSaving(false)
    if (result.ok) {
      setRequestId(globalThis.crypto.randomUUID())
      onSaved()
      return
    }
    if (result.error === 'stale') {
      setRequestId(globalThis.crypto.randomUUID())
      onStale(form)
      return
    }
    if (result.error === 'invalid-values' && result.fields) setErrors(result.fields as typeof errors)
    setFailure(
      result.error === 'network'
        ? 'Não foi possível comunicar com o servidor. Nenhuma alteração foi confirmada; os dados digitados foram mantidos.'
        : result.error === 'forbidden' && result.reason
          ? (WORK_PLAN_MESSAGE[result.reason] ?? (result.reason in DENIAL_MESSAGE ? DENIAL_MESSAGE[result.reason as keyof typeof DENIAL_MESSAGE] : 'Alteração não autorizada.'))
          : result.error === 'session-expired'
            ? 'Sua sessão expirou. Entre novamente para continuar.'
            : result.error === 'invalid-values'
              ? 'Revise os campos indicados. Nenhuma alteração foi confirmada.'
              : 'Não foi possível salvar. Nenhuma alteração foi confirmada.',
    )
    queueMicrotask(() => alertRef.current?.focus())
  }

  return (
    <section className={ds.card} aria-labelledby={`${id}-title`}>
      <div className={ds.stack}>
        <h2 id={`${id}-title`} className={ds.sectionTitle}>
          Cadastro estruturado do Plano aprovado
        </h2>
        <p className={ds.muted}>
          Registre as informações constantes do Plano de Trabalho já aprovado. Campos vazios ficam como “não informado”; marque “não se
          aplica” apenas quando o campo não se aplicar. Campos com <span aria-hidden="true">*</span>
          <span className={ds.srOnly}>asterisco</span> são exigidos para a finalização.
        </p>
      </div>
      <div ref={alertRef} tabIndex={-1}>
        {failure ? (
          <p className={ds.error} role="alert">
            {failure}
          </p>
        ) : null}
      </div>
      <form className={styles.form} noValidate onSubmit={(e) => void save(e)} aria-busy={saving}>
        {GROUPS.map((group) => (
          <fieldset key={group.id} className={styles.group}>
            <legend className={styles.groupTitle}>{group.label}</legend>
            <div className={styles.formGrid}>
              {FIELDS.filter((f) => f.group === group.id).map((f) => {
                const inputId = `${id}-${f.id}`
                const error = errors[f.id]
                const described = [f.hint ? `${inputId}-hint` : null, error ? `${inputId}-error` : null].filter(Boolean).join(' ') || undefined
                const long = f.kind === 'text' && (f.max ?? 0) > 1000
                const common = {
                  id: inputId,
                  value: form[f.id].text,
                  disabled: form[f.id].na,
                  'aria-invalid': error ? true : undefined,
                  'aria-describedby': described,
                }
                return (
                  <div key={f.id} className={`${styles.formField} ${long ? styles.wide : ''}`}>
                    <label className={styles.label} htmlFor={inputId}>
                      {f.label}
                      {f.requiredForFinalization ? (
                        <span className={styles.required} aria-hidden="true">
                          {' '}
                          *
                        </span>
                      ) : null}
                    </label>
                    {f.kind === 'date' ? (
                      <input {...common} type="date" className={styles.input} max={f.id === 'approvalDate' ? today : undefined} onChange={(e) => set(f.id, { text: e.target.value })} />
                    ) : f.kind === 'integer' ? (
                      <input {...common} inputMode="numeric" className={styles.input} max={MAX_BENEFICIARIES} onChange={(e) => set(f.id, { text: e.target.value })} />
                    ) : long ? (
                      <textarea {...common} className={styles.textarea} maxLength={f.max} onChange={(e) => set(f.id, { text: e.target.value })} />
                    ) : (
                      <input {...common} className={styles.input} maxLength={f.max} onChange={(e) => set(f.id, { text: e.target.value })} />
                    )}
                    {f.hint ? (
                      <p id={`${inputId}-hint`} className={styles.hint}>
                        {f.hint}
                      </p>
                    ) : null}
                    {f.allowsNotApplicable ? (
                      <label className={styles.check}>
                        <input type="checkbox" checked={form[f.id].na} onChange={(e) => set(f.id, { na: e.target.checked })} />
                        <span>Não se aplica</span>
                      </label>
                    ) : null}
                    {error ? (
                      <p id={`${inputId}-error`} className={styles.fieldError}>
                        {fieldErrorMessage(error)}
                      </p>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </fieldset>
        ))}
        <div className={styles.actions}>
          <button type="submit" className={ds.primary} disabled={saving || reloading} aria-busy={saving || reloading}>
            {saving ? 'Salvando…' : reloading ? 'Recarregando…' : 'Salvar alterações'}
          </button>
          <span className={styles.hint} role="status">
            {dirty ? 'Há alterações não salvas.' : 'Todas as alterações estão salvas.'}
          </span>
        </div>
      </form>
    </section>
  )
}
