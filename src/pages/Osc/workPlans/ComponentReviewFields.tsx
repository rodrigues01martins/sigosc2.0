import { useId } from 'react'
import { LIMITS } from '../../../domain/workPlanComponents.ts'
import styles from '../partnerships/Partnerships.module.css'
import { REVIEW_STATUSES, type ReviewDraft } from './componentForm.ts'

interface Props {
  value: ReviewDraft
  onChange(value: ReviewDraft): void
  counts: { goals: number; indicators: number }
  disabled?: boolean
}

/**
 * Conferência de metas e indicadores (DEC-PT-007): para cada categoria, a situação DECLARADA em
 * relação ao Plano aprovado. Inexistência ou inaplicabilidade exigem justificativa; sem escolha, a
 * categoria fica pendente. Não há mínimo universal de componentes.
 */
export function ComponentReviewFields({ value, onChange, counts, disabled }: Props) {
  const id = useId()
  const category = (key: 'goals' | 'indicators', legend: string, count: number) => {
    const c = value[key]
    const needsJustification = c.status === 'none-in-document' || c.status === 'not-applicable'
    return (
      <fieldset className={styles.fieldset} disabled={disabled}>
        <legend className={styles.label}>
          {legend} <span className={styles.detail} style={{ display: 'inline' }}>({count} {count === 1 ? 'ativo registrado' : 'ativos registrados'})</span>
        </legend>
        <div className={styles.choices}>
          {REVIEW_STATUSES.map((s) => (
            <label key={s.id} className={styles.choice}>
              <input type="radio" name={`${id}-${key}`} value={s.id} checked={c.status === s.id} onChange={() => onChange({ ...value, [key]: { ...c, status: s.id } })} />
              {s.label}
            </label>
          ))}
        </div>
        {needsJustification ? (
          <div className={styles.formField}>
            <label className={styles.label} htmlFor={`${id}-${key}-j`}>
              Justificativa{' '}
              <span className={styles.required} aria-hidden="true">
                *
              </span>
            </label>
            <textarea id={`${id}-${key}-j`} className={styles.textarea} value={c.justification} maxLength={LIMITS.longText} onChange={(e) => onChange({ ...value, [key]: { ...c, justification: e.target.value } })} />
          </div>
        ) : null}
      </fieldset>
    )
  }
  return (
    <div className={styles.form}>
      {category('goals', 'Metas do Plano aprovado', counts.goals)}
      {category('indicators', 'Indicadores do Plano aprovado', counts.indicators)}
    </div>
  )
}
