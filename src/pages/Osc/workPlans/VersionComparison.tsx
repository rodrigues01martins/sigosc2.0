import { useId } from 'react'
import ds from '../../../components/ds/ds.module.css'
import { DIFF_LABEL, FIELD_LABEL, diffVersions, isMaterialDiff, versionLabel } from '../../../domain/workPlanVersions.ts'
import { FIELD_DEFINITIONS } from '../../../domain/workPlans.ts'
import type { WorkPlan } from '../../../services/workPlans/types.ts'
import styles from '../partnerships/Partnerships.module.css'
import { displayValue } from './form.ts'

interface Props {
  versions: readonly WorkPlan[]
  beforeId: string
  afterId: string
  onChange(beforeId: string, afterId: string): void
  onClose(): void
}

const kindOf = (field: string) => FIELD_DEFINITIONS.find((f) => f.id === field)?.kind ?? 'text'

/**
 * Comparação ESTRUTURADA entre duas versões completas, calculada diretamente dos dados
 * armazenados (sem inferências). Só os componentes implementados: metas, indicadores e
 * planejamento financeiro ainda não existem e não são simulados.
 */
export function VersionComparison({ versions, beforeId, afterId, onChange, onClose }: Props) {
  const id = useId()
  const before = versions.find((v) => v.id === beforeId)
  const after = versions.find((v) => v.id === afterId)
  const diffs = before && after ? diffVersions(before.values, after.values) : []
  const material = diffs.filter((d) => isMaterialDiff(d.kind))
  const kept = diffs.filter((d) => !isMaterialDiff(d.kind))

  const select = (label: string, value: string, onPick: (v: string) => void) => (
    <div className={styles.formField}>
      <label className={styles.label} htmlFor={`${id}-${label}`}>
        {label}
      </label>
      <select id={`${id}-${label}`} className={styles.input} value={value} onChange={(e) => onPick(e.target.value)}>
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {versionLabel(v.sequence)}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <section className={ds.card} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={ds.sectionTitle}>
        Comparação entre versões
      </h2>
      <div className={styles.formGrid}>
        {select('Versão de referência', beforeId, (v) => onChange(v, afterId))}
        {select('Versão comparada', afterId, (v) => onChange(beforeId, v))}
      </div>
      {before && after ? (
        <>
          <p className={ds.muted} role="status">
            {material.length === 0
              ? 'Nenhuma diferença de conteúdo entre as versões selecionadas.'
              : `${material.length} ${material.length === 1 ? 'campo com diferença' : 'campos com diferença'}; ${kept.length} mantidos.`}
          </p>
          {material.length > 0 ? (
            <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Tabela de diferenças (role horizontalmente se necessário)">
              <table className={styles.table} style={{ minWidth: 0 }}>
                <caption className={ds.srOnly}>
                  Diferenças entre {versionLabel(before.sequence)} e {versionLabel(after.sequence)}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Campo</th>
                    <th scope="col">{versionLabel(before.sequence)}</th>
                    <th scope="col">{versionLabel(after.sequence)}</th>
                    <th scope="col">Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {material.map((d) => (
                    <tr key={d.field}>
                      <th scope="row">{FIELD_LABEL[d.field]}</th>
                      <td style={{ overflowWrap: 'anywhere' }}>{displayValue(d.before, kindOf(d.field))}</td>
                      <td style={{ overflowWrap: 'anywhere' }}>{displayValue(d.after, kindOf(d.field))}</td>
                      <td>{DIFF_LABEL[d.kind]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {kept.length > 0 ? (
            <p className={styles.hint}>
              Campos mantidos: {kept.map((d) => `${FIELD_LABEL[d.field]}${d.kind === 'formatting-only' ? ' (diferença só de formatação)' : ''}`).join('; ')}.
            </p>
          ) : null}
          <p className={styles.hint}>Metas, indicadores e planejamento financeiro ainda não são estruturados e não fazem parte da comparação.</p>
        </>
      ) : (
        <p className={ds.muted}>Selecione duas versões existentes.</p>
      )}
      <span className={styles.touch}>
        <button type="button" className={ds.linkButton} onClick={onClose}>
          Fechar comparação
        </button>
      </span>
    </section>
  )
}
