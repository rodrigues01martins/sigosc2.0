import ds from '../../../components/ds/ds.module.css'
import { ACTIVATION_LABEL, activationStatusOf, formalActTypeLabel, versionLabel } from '../../../domain/workPlanVersions.ts'
import { SITUATION_LABEL } from '../../../domain/workPlans.ts'
import type { WorkPlan } from '../../../services/workPlans/types.ts'
import styles from '../partnerships/Partnerships.module.css'
import { formatDate, formatTimestamp, todayInBrasilia } from '../partnerships/format.ts'
import { VIGENCY_BADGE, futureEffectsLabel } from './vigency.ts'

interface Props {
  versions: readonly WorkPlan[]
  currentId: string | null
  selectedId: string
  viewerUid: string | null
  onSelect(id: string): void
  onCompare(previousId: string, id: string): void
}

/**
 * Histórico CRONOLÓGICO das versões (DEC-034): somente consulta e comparação. Não há edição
 * direta de versões históricas, exclusão ou restauração.
 */
export function VersionHistory({ versions, currentId, selectedId, viewerUid, onSelect, onCompare }: Props) {
  const today = todayInBrasilia()
  return (
    <section className={ds.card} aria-labelledby="osc05-versoes">
      <h2 id="osc05-versoes" className={ds.sectionTitle}>
        Versões do Plano de Trabalho
      </h2>
      <ol className={styles.cards} aria-label="Versões em ordem cronológica" style={{ border: 0 }}>
        {versions.map((v) => {
          const selected = v.id === selectedId
          const previous = v.previousWorkPlanId
          const status = activationStatusOf(v, currentId)
          const future = futureEffectsLabel(v, today)
          return (
            <li key={v.id} className={`${styles.card} ${selected ? styles.selected : ''}`}>
              <div className={styles.cardRow} style={{ justifyContent: 'space-between' }}>
                <strong>
                  {versionLabel(v.sequence)} <span className={`${styles.detail} ${styles.selectedDetail}`} style={{ display: 'inline' }}>· sequência {v.sequence}</span>
                </strong>
                <span className={styles.cardRow} style={{ gap: 'var(--ds-space-2)' }}>
                  <span className={`${ds.badge} ${styles.situation} ${VIGENCY_BADGE[status] ?? ''}`}>{ACTIVATION_LABEL[status]}</span>
                  {future ? <span className={`${ds.badge} ${styles.situation} ${styles.vigencyFuture}`}>{future}</span> : null}
                </span>
              </div>
              <span className={`${styles.detail} ${styles.selectedDetail}`}>
                Cadastro: {SITUATION_LABEL[v.registrationStatus]}
                {v.formalAct
                  ? ` · ${formalActTypeLabel(v.formalAct.type, v.formalAct.typeDescription)}${v.formalAct.reference ? ` ${v.formalAct.reference}` : ''} de ${formatDate(v.formalAct.actDate)}`
                  : ' · Plano aprovado original'}
                {` · registrada em ${formatTimestamp(v.createdAt)}${v.createdBy && v.createdBy === viewerUid ? ' por você' : ''}`}
                {v.activation.activatedAt ? ` · vigente no SIGOSC desde ${formatTimestamp(v.activation.activatedAt)}` : ''}
                {v.activation.supersededAt ? ` · substituída em ${formatTimestamp(v.activation.supersededAt)}` : ''}
              </span>
              <div className={`${styles.actions} ${styles.touch}`}>
                <button type="button" className={ds.secondary} aria-current={selected ? 'true' : undefined} aria-label={`${selected ? 'Exibindo' : 'Consultar'}: ${versionLabel(v.sequence)}`} onClick={() => onSelect(v.id)}>
                  {selected ? 'Exibindo' : 'Consultar'}
                </button>
                {previous ? (
                  <button type="button" className={ds.secondary} aria-label={`Comparar com a anterior: ${versionLabel(v.sequence)}`} onClick={() => onCompare(previous, v.id)}>
                    Comparar com a anterior
                  </button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
