import { useId, useRef, useState, type FormEvent } from 'react'
import ds from '../../../components/ds/ds.module.css'
import { DENIAL_MESSAGE } from '../../../domain/authorization.ts'
import {
  EDITABLE_FIELDS,
  LIMITS,
  PARTNERSHIP_MESSAGE,
  draftErrorMessage,
  validatePartnershipChanges,
  type DraftErrorCode,
  type EditableField,
  type PartnershipChanges,
} from '../../../domain/partnerships.ts'
import { usePartnershipDependencies } from '../../../hooks/partnershipsContext.ts'
import type { Partnership } from '../../../services/partnerships/types.ts'
import styles from './Partnerships.module.css'

interface Props {
  partnership: Partnership
  onCancel(): void
  /** Alteração confirmada pelo servidor: a página recarrega a parceria da fonte confiável. */
  onSaved(changed: boolean): void
  /** A parceria mudou desde a leitura: a página recarrega; os valores digitados são mantidos. */
  onStale(): void
}

const LABEL: Record<EditableField, string> = {
  instrumentNumber: 'Número ou identificação do instrumento',
  publicPartner: 'Órgão ou entidade pública parceira',
  object: 'Objeto (descrição resumida)',
  administrativeProcess: 'Processo administrativo (opcional)',
}

const MAX: Record<EditableField, number> = {
  instrumentNumber: LIMITS.instrumentNumber.max,
  publicPartner: LIMITS.publicPartner.max,
  object: LIMITS.object.max,
  administrativeProcess: LIMITS.administrativeProcess.max,
}

/**
 * Correção cadastral (DEC-PAR-001 — `partnerships.edit`), limitada a número, órgão, objeto
 * e processo. Instrumento, datas, valor global, situação e declaração do Plano ficam
 * PROTEGIDOS: sua alteração pode configurar alteração formal do instrumento ou transição
 * de situação, que exigem fluxos próprios. Controle de concorrência por revisão.
 */
export function PartnershipEditForm({ partnership, onCancel, onSaved, onStale }: Props) {
  const { api } = usePartnershipDependencies()
  const [values, setValues] = useState<Record<EditableField, string>>(() => ({
    instrumentNumber: partnership.instrumentNumber,
    publicPartner: partnership.publicPartner,
    object: partnership.object,
    administrativeProcess: partnership.administrativeProcess ?? '',
  }))
  const [errors, setErrors] = useState<Partial<Record<EditableField | 'changes', DraftErrorCode>>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Após um conflito, aguarda a revisão recarregada antes de permitir novo envio.
  const [staleRevision, setStaleRevision] = useState<number | null>(null)
  const reloading = staleRevision !== null && staleRevision === partnership.revision
  const [requestId] = useState(() => globalThis.crypto.randomUUID())
  const inflight = useRef(false)
  const alertRef = useRef<HTMLDivElement>(null)
  const id = useId()

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (inflight.current || reloading) return
    setFailure(null)
    // Somente campos efetivamente alterados são enviados.
    const changes: PartnershipChanges = {}
    for (const field of EDITABLE_FIELDS) {
      const original = field === 'administrativeProcess' ? (partnership.administrativeProcess ?? '') : partnership[field]
      if (values[field] !== original) changes[field] = field === 'administrativeProcess' && values[field].trim() === '' ? null : values[field]
    }
    if (Object.keys(changes).length === 0) {
      setFailure('Nenhuma alteração a salvar.')
      return
    }
    const validation = validatePartnershipChanges(changes)
    if (!validation.ok) {
      setErrors(validation.errors)
      queueMicrotask(() => alertRef.current?.focus())
      return
    }
    setErrors({})
    inflight.current = true
    setSaving(true)
    const result = await api.update({
      oscId: partnership.oscId,
      partnershipId: partnership.id,
      requestId,
      expectedRevision: partnership.revision,
      changes: validation.changes,
    })
    inflight.current = false
    setSaving(false)
    if (result.ok) {
      onSaved(result.changed)
      return
    }
    if (result.error === 'stale') {
      setStaleRevision(partnership.revision)
      setFailure('A parceria foi alterada por outra pessoa desde a sua consulta. Os dados foram recarregados; revise e salve novamente.')
      onStale()
    } else if (result.error === 'forbidden' && result.reason) {
      setFailure(PARTNERSHIP_MESSAGE[result.reason] ?? (result.reason in DENIAL_MESSAGE ? DENIAL_MESSAGE[result.reason as keyof typeof DENIAL_MESSAGE] : 'Alteração não autorizada.'))
    } else if (result.error === 'invalid-draft' && result.fields) {
      setErrors(result.fields as typeof errors)
      setFailure('Revise os campos indicados. Nenhuma alteração foi confirmada.')
    } else if (result.error === 'network') {
      setFailure('Não foi possível comunicar com o servidor. Nenhuma alteração foi confirmada; os dados digitados foram mantidos.')
    } else if (result.error === 'session-expired') {
      setFailure('Sua sessão expirou. Entre novamente para continuar.')
    } else {
      setFailure('Não foi possível salvar a alteração. Nenhuma alteração foi confirmada.')
    }
    queueMicrotask(() => alertRef.current?.focus())
  }

  return (
    <section className={ds.card} aria-labelledby={`${id}-title`}>
      <div className={ds.stack}>
        <h2 id={`${id}-title`} className={ds.sectionTitle}>
          Corrigir dados cadastrais
        </h2>
        <p className={ds.muted}>
          Correção de informações registradas no SIGOSC. Instrumento, datas, valor global, situação administrativa e declaração do Plano
          não são alterados aqui: mudanças no instrumento exigem registro formal próprio (aditivo, prorrogação ou apostilamento).
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
        <div className={styles.formGrid}>
          {EDITABLE_FIELDS.map((field) => (
            <div key={field} className={`${styles.formField} ${field === 'object' ? styles.wide : ''}`}>
              <label className={styles.label} htmlFor={`${id}-${field}`}>
                {LABEL[field]}
              </label>
              {field === 'object' ? (
                <textarea
                  id={`${id}-${field}`}
                  className={styles.textarea}
                  value={values[field]}
                  maxLength={MAX[field]}
                  aria-invalid={errors[field] ? true : undefined}
                  aria-describedby={errors[field] ? `${id}-${field}-error` : undefined}
                  onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                />
              ) : (
                <input
                  id={`${id}-${field}`}
                  className={styles.input}
                  value={values[field]}
                  maxLength={MAX[field]}
                  aria-invalid={errors[field] ? true : undefined}
                  aria-describedby={errors[field] ? `${id}-${field}-error` : undefined}
                  onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                />
              )}
              {errors[field] ? (
                <p id={`${id}-${field}-error`} className={styles.fieldError}>
                  {draftErrorMessage(field, errors[field])}
                </p>
              ) : null}
            </div>
          ))}
        </div>
        <div className={styles.actions}>
          <button type="submit" className={ds.primary} disabled={saving || reloading} aria-busy={saving || reloading}>
            {saving ? 'Salvando…' : reloading ? 'Recarregando…' : 'Salvar correção'}
          </button>
          <button type="button" className={ds.linkButton} onClick={onCancel} disabled={saving}>
            Cancelar
          </button>
        </div>
      </form>
    </section>
  )
}
