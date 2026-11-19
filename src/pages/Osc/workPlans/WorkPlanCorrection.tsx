import { useId, useRef, useState, type FormEvent } from 'react'
import ds from '../../../components/ds/ds.module.css'
import { denialMessage } from '../../../domain/workPlanVersions.ts'
import {
  CORRECTION_DECLARATION,
  FIELD_DEFINITIONS as FIELDS,
  JUSTIFICATION_LIMITS,
  correctionErrorMessage,
  validateCorrection,
  type CorrectionErrorCode,
  type CorrectionErrorKey,
  type CorrectionItem,
  type FieldValue,
  type PartnershipFacts,
  type WorkPlanField,
} from '../../../domain/workPlans.ts'
import { useWorkPlanDependencies } from '../../../hooks/workPlansContext.ts'
import type { WorkPlan } from '../../../services/workPlans/types.ts'
import styles from '../partnerships/Partnerships.module.css'
import { todayInBrasilia } from '../partnerships/format.ts'
import { displayValue, formFromValues, valueFromForm, type FormState } from './form.ts'

interface Props {
  plan: WorkPlan
  partnership: PartnershipFacts
  onCancel(): void
  /** Correção confirmada pelo servidor: a página recarrega o Plano e o histórico. */
  onCorrected(warnings: readonly string[]): void
  /** Conflito de revisão: a página recarrega; os dados digitados são mantidos aqui. */
  onStale(): void
  today?: string
}

type Errors = Partial<Record<CorrectionErrorKey, CorrectionErrorCode>>

/**
 * Correção de ERRO MATERIAL em Plano finalizado (DEC-PT-002). Não reabre o formulário:
 * o usuário marca apenas os campos a corrigir, vê o valor registrado, informa o correto,
 * justifica, declara a correspondência ao Plano aprovado e confirma após revisar
 * "valor anterior → valor corrigido". Nada é gravado antes da confirmação.
 */
export function WorkPlanCorrection({ plan, partnership, onCancel, onCorrected, onStale, today = todayInBrasilia() }: Props) {
  const { api } = useWorkPlanDependencies()
  const [selected, setSelected] = useState<ReadonlySet<WorkPlanField>>(new Set())
  const [form, setForm] = useState<FormState>(() => formFromValues(plan.values))
  const [justification, setJustification] = useState('')
  const [declared, setDeclared] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [review, setReview] = useState<{ items: readonly CorrectionItem[]; justification: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [staleRevision, setStaleRevision] = useState<number | null>(null)
  // Mesmo identificador nas novas tentativas desta correção (idempotência no servidor).
  const [requestId, setRequestId] = useState(() => globalThis.crypto.randomUUID())
  const inflight = useRef(false)
  const alertRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const reloading = staleRevision !== null && staleRevision === plan.revision

  function toggle(field: WorkPlanField, on: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(field)
      else next.delete(field)
      return next
    })
    setReview(null)
  }

  function buildChanges(): { changes: Partial<Record<WorkPlanField, FieldValue>>; local: Errors } {
    const changes: Partial<Record<WorkPlanField, FieldValue>> = {}
    const local: Errors = {}
    for (const field of selected) {
      const value = valueFromForm(field, form[field])
      if (value === 'invalid') local[field] = 'out-of-range'
      else changes[field] = value
    }
    return { changes, local }
  }

  function startReview(event: FormEvent) {
    event.preventDefault()
    setFailure(null)
    if (selected.size === 0) {
      setErrors({ changes: 'required' })
      setFailure('Selecione ao menos um campo a corrigir.')
      queueMicrotask(() => alertRef.current?.focus())
      return
    }
    const { changes, local } = buildChanges()
    const validation = validateCorrection({ changes, justification, declaration: declared }, plan.values, partnership, today)
    const all: Errors = { ...(validation.ok ? {} : validation.errors), ...local }
    if (Object.keys(all).length > 0 || !validation.ok) {
      setErrors(all)
      setFailure(validation.ok || !validation.pending ? 'Revise os itens indicados. Nada foi gravado.' : `A correção deixaria o Plano sem os requisitos da finalização: ${validation.pending.join(' ')}`)
      queueMicrotask(() => alertRef.current?.focus())
      return
    }
    setErrors({})
    setReview({ items: validation.items, justification: validation.justification })
  }

  async function confirm() {
    if (!review || inflight.current || reloading) return
    inflight.current = true
    setSaving(true)
    const changes = Object.fromEntries(review.items.map((item) => [item.field, item.after]))
    const result = await api.correct({ oscId: plan.oscId, partnershipId: plan.partnershipId, workPlanId: plan.id, requestId, expectedRevision: plan.revision, changes, justification: review.justification, declaration: true })
    inflight.current = false
    setSaving(false)
    if (result.ok) {
      onCorrected(result.warnings)
      return
    }
    setReview(null)
    if (result.error === 'stale') {
      setStaleRevision(plan.revision)
      setRequestId(globalThis.crypto.randomUUID())
      setFailure('O Plano foi alterado por outra pessoa desde a sua consulta. Os dados foram recarregados; revise a correção antes de confirmar.')
      onStale()
    } else if (result.error === 'invalid-correction' && result.fields) {
      setErrors(result.fields as Errors)
      setFailure('Revise os itens indicados. Nenhuma correção foi gravada.')
    } else if (result.error === 'forbidden' && result.reason) {
      setFailure(denialMessage(result.reason, 'Correção não autorizada.'))
    } else if (result.error === 'network') {
      setFailure('Não foi possível comunicar com o servidor. Nenhuma correção foi confirmada; os dados informados foram mantidos.')
    } else if (result.error === 'session-expired') {
      setFailure('Sua sessão expirou. Entre novamente para continuar.')
    } else {
      setFailure('Não foi possível gravar a correção. Nenhuma correção foi confirmada.')
    }
    queueMicrotask(() => alertRef.current?.focus())
  }

  const describe = (key: CorrectionErrorKey) => (errors[key] ? `${id}-${key}-error` : undefined)
  const errorText = (key: CorrectionErrorKey) =>
    errors[key] ? (
      <p id={`${id}-${key}-error`} className={styles.fieldError}>
        {correctionErrorMessage(errors[key])}
      </p>
    ) : null

  return (
    <section className={ds.card} aria-labelledby={`${id}-title`}>
      <div className={ds.stack}>
        <h2 id={`${id}-title`} className={ds.sectionTitle}>
          Corrigir erro material
        </h2>
        <dl className={styles.dl}>
          <div>
            <dt>Correção material</dt>
            <dd>Ajuste de informação registrada incorretamente no SIGOSC em relação ao Plano de Trabalho formalmente aprovado.</dd>
          </div>
          <div>
            <dt>Alteração formal (não disponível aqui)</dt>
            <dd>Modificação do próprio Plano aprovado, sujeita a procedimento administrativo e ao versionamento futuro.</dd>
          </div>
        </dl>
        <p className={styles.hint}>
          A correção não reabre o cadastro, não cria versão e mantém a data e o autor da finalização. O documento aprovado não está armazenado no SIGOSC:
          a correspondência é declarada por você, sem verificação automática.
        </p>
      </div>

      <div ref={alertRef} tabIndex={-1}>
        {failure ? (
          <p className={ds.error} role="alert">
            {failure}
          </p>
        ) : null}
      </div>

      {review ? (
        <div className={ds.warning} role="alertdialog" aria-labelledby={`${id}-review`} aria-describedby={`${id}-review-text`}>
          <div className={ds.stack}>
            <strong id={`${id}-review`}>Confirmar correção de erro material</strong>
            <span id={`${id}-review-text`}>Confira cada alteração. O valor anterior ficará preservado no histórico.</span>
            <ul aria-label="Alterações a confirmar" style={{ margin: 0, paddingLeft: 20 }}>
              {review.items.map((item) => {
                const def = FIELDS.find((f) => f.id === item.field)
                return (
                  <li key={item.field}>
                    <strong>{def?.label}</strong>: {displayValue(item.before, def?.kind ?? 'text')} → {displayValue(item.after, def?.kind ?? 'text')}
                  </li>
                )
              })}
            </ul>
            <span>Justificativa: {review.justification}</span>
            <div className={styles.actions}>
              <button type="button" className={ds.linkButton} onClick={() => setReview(null)} disabled={saving}>
                Voltar e ajustar
              </button>
              <button type="button" className={ds.primary} onClick={() => void confirm()} disabled={saving || reloading} aria-busy={saving} autoFocus>
                {saving ? 'Gravando…' : 'Confirmar correção'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <form className={styles.form} noValidate onSubmit={startReview}>
          <fieldset className={styles.group} aria-describedby={describe('changes')}>
            <legend className={styles.groupTitle}>Campos a corrigir</legend>
            {FIELDS.map((f) => {
              const on = selected.has(f.id)
              const inputId = `${id}-${f.id}`
              const error = errors[f.id]
              const long = f.kind === 'text' && (f.max ?? 0) > 1000
              const common = {
                id: inputId,
                value: form[f.id].text,
                disabled: form[f.id].na,
                'aria-invalid': error ? true : undefined,
                'aria-describedby': error ? `${id}-${f.id}-error` : undefined,
                onChange: (e: { target: { value: string } }) => setForm((v) => ({ ...v, [f.id]: { ...v[f.id], text: e.target.value } })),
              }
              return (
                <div key={f.id} className={styles.formField}>
                  <label className={styles.check}>
                    <input type="checkbox" checked={on} onChange={(e) => toggle(f.id, e.target.checked)} />
                    <span>
                      <strong>{f.label}</strong> — registrado: {displayValue(plan.values[f.id], f.kind)}
                    </span>
                  </label>
                  {on ? (
                    <div className={styles.formField} style={{ paddingLeft: 28 }}>
                      <label className={styles.label} htmlFor={inputId}>
                        Valor correto: {f.label}
                      </label>
                      {f.kind === 'date' ? (
                        <input {...common} type="date" className={styles.input} />
                      ) : f.kind === 'integer' ? (
                        <input {...common} inputMode="numeric" className={styles.input} />
                      ) : long ? (
                        <textarea {...common} className={styles.textarea} maxLength={f.max} />
                      ) : (
                        <input {...common} className={styles.input} maxLength={f.max} />
                      )}
                      {f.allowsNotApplicable ? (
                        <label className={styles.check}>
                          <input type="checkbox" checked={form[f.id].na} onChange={(e) => setForm((v) => ({ ...v, [f.id]: { ...v[f.id], na: e.target.checked } }))} />
                          <span>Não se aplica</span>
                        </label>
                      ) : null}
                      <p className={styles.hint}>Deixe vazio para registrar “não informado”{f.requiredForFinalization ? ' (não admitido: campo exigido pela finalização)' : ''}.</p>
                      {errorText(f.id)}
                    </div>
                  ) : null}
                </div>
              )
            })}
            {errorText('changes')}
          </fieldset>

          <div className={styles.formField}>
            <label className={styles.label} htmlFor={`${id}-reason`}>
              Justificativa da correção
              <span className={styles.required} aria-hidden="true">
                {' '}
                *
              </span>
            </label>
            <textarea
              id={`${id}-reason`}
              className={styles.textarea}
              value={justification}
              maxLength={JUSTIFICATION_LIMITS.max}
              required
              aria-invalid={errors.correctionReason ? true : undefined}
              aria-describedby={[`${id}-reason-hint`, describe('correctionReason')].filter(Boolean).join(' ')}
              onChange={(e) => setJustification(e.target.value)}
            />
            <p id={`${id}-reason-hint`} className={styles.hint}>
              Explique o erro de registro (ex.: data transcrita incorretamente). Mínimo de {JUSTIFICATION_LIMITS.min} caracteres.
            </p>
            {errorText('correctionReason')}
          </div>

          <div>
            <label className={styles.check}>
              <input type="checkbox" checked={declared} aria-invalid={errors.declaration ? true : undefined} aria-describedby={describe('declaration')} onChange={(e) => setDeclared(e.target.checked)} />
              <span>
                {CORRECTION_DECLARATION}
                <span className={styles.required} aria-hidden="true">
                  {' '}
                  *
                </span>
              </span>
            </label>
            {errorText('declaration')}
          </div>

          <div className={styles.actions}>
            <button type="submit" className={ds.primary} disabled={reloading} aria-busy={reloading}>
              {reloading ? 'Recarregando…' : 'Revisar correção'}
            </button>
            <button type="button" className={ds.linkButton} onClick={onCancel}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
