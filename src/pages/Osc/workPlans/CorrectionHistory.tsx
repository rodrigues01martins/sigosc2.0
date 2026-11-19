import { useEffect, useState } from 'react'
import ds from '../../../components/ds/ds.module.css'
import { DENIAL_MESSAGE } from '../../../domain/authorization.ts'
import { FIELD_DEFINITIONS } from '../../../domain/workPlans.ts'
import { useWorkPlanDependencies } from '../../../hooks/workPlansContext.ts'
import type { CorrectionEntry } from '../../../services/workPlans/workPlansApi.ts'
import { AUTHORITY_LABEL } from '../oscLabels.ts'
import styles from '../partnerships/Partnerships.module.css'
import { displayValue } from './form.ts'

type State = { status: 'loading' } | { status: 'error'; text: string } | { status: 'ready'; entries: readonly CorrectionEntry[] }

const DATE = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

/**
 * Histórico de correções materiais (DEC-PT-002), em ordem cronológica e somente leitura.
 * Servido pelo SERVIDOR (a auditoria é ilegível pelo navegador) a quem tem `work-plan.view`
 * na OSC. Mostra apenas correções materiais — não os eventos técnicos de cadastro.
 */
export function CorrectionHistory({ oscId, partnershipId, workPlanId, refreshKey }: { oscId: string; partnershipId: string; workPlanId: string; refreshKey: number }) {
  const { api } = useWorkPlanDependencies()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    void api.history({ oscId, partnershipId, workPlanId }).then((result) => {
      if (!alive) return
      if (result.ok) setState({ status: 'ready', entries: result.entries })
      else
        setState({
          status: 'error',
          text:
            result.error === 'forbidden' && result.reason && result.reason in DENIAL_MESSAGE
              ? DENIAL_MESSAGE[result.reason as keyof typeof DENIAL_MESSAGE]
              : result.error === 'network'
                ? 'Não foi possível consultar o histórico de correções. Verifique a conexão e tente novamente.'
                : 'O histórico de correções está indisponível no momento.',
        })
    })
    return () => {
      alive = false
    }
  }, [api, oscId, partnershipId, workPlanId, refreshKey, attempt])

  return (
    <section className={ds.card} aria-labelledby="osc05-historico" aria-busy={state.status === 'loading'}>
      <h2 id="osc05-historico" className={ds.sectionTitle}>
        Histórico de correções materiais
      </h2>
      {state.status === 'loading' ? (
        <p className={ds.muted} role="status">
          Consultando o histórico…
        </p>
      ) : state.status === 'error' ? (
        <div className={ds.stack}>
          <p className={ds.error} role="alert">
            {state.text}
          </p>
          <span className={styles.touch}>
            <button type="button" className={ds.secondary} onClick={() => { setState({ status: 'loading' }); setAttempt((n) => n + 1) }}>
              Tentar novamente
            </button>
          </span>
        </div>
      ) : state.entries.length === 0 ? (
        <p className={ds.muted}>Nenhuma correção material registrada.</p>
      ) : (
        <ol className={ds.stack} aria-label="Correções materiais em ordem cronológica" style={{ margin: 0, paddingLeft: 20 }}>
          {state.entries.map((entry) => (
            <li key={entry.toRevision}>
              <article className={ds.stack} aria-label={`Correção registrada em ${entry.at ? DATE.format(new Date(entry.at)) : 'data não disponível'}`}>
                <p className={ds.muted} style={{ margin: 0 }}>
                  {entry.at ? DATE.format(new Date(entry.at)) : 'Data não disponível'} · por {entry.actor === 'you' ? 'você' : `${AUTHORITY_LABEL[entry.actorAuthority]} da OSC`}
                </p>
                <dl className={styles.dl}>
                  {entry.corrections.map((c) => {
                    const def = FIELD_DEFINITIONS.find((f) => f.id === c.field)
                    return (
                      <div key={c.field} className={styles.wide}>
                        <dt>{def?.label ?? c.field}</dt>
                        <dd>
                          Anterior: {displayValue(c.before, def?.kind ?? 'text')} · Corrigido: {displayValue(c.after, def?.kind ?? 'text')}
                        </dd>
                      </div>
                    )
                  })}
                  <div className={styles.wide}>
                    <dt>Justificativa</dt>
                    <dd>{entry.justification}</dd>
                  </div>
                </dl>
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
