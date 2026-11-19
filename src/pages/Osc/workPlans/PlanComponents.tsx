import { useEffect, useRef, useState } from 'react'
import ds from '../../../components/ds/ds.module.css'
import { InfoIcon } from '../../../components/ds/icons.tsx'
import type { AuthorizationContext } from '../../../domain/authorization.ts'
import type { ComponentErrors, GoalData, IndicatorData } from '../../../domain/workPlanComponents.ts'
import { denialMessage, versionLabel } from '../../../domain/workPlanVersions.ts'
import { useWorkPlanDependencies } from '../../../hooks/workPlansContext.ts'
import type { ComponentRecord, PlanComponents as Components, WorkPlan } from '../../../services/workPlans/types.ts'
import styles from '../partnerships/Partnerships.module.css'
import { PARTNERSHIP_LOAD_ERROR } from '../partnerships/format.ts'
import { GoalFormCard, IndicatorFormCard, type SubmitResult } from './ComponentForms.tsx'
import { measurementLabel, natureLabel, nextCode, periodicityLabel, ruleSummary, show } from './componentForm.ts'

type State = { status: 'loading' } | { status: 'error'; text: string } | { status: 'ready'; data: Components }
type Editing = { kind: 'goal'; record: ComponentRecord<GoalData> | null } | { kind: 'indicator'; record: ComponentRecord<IndicatorData> | null; presetGoal: string | null } | null

interface Props {
  context: AuthorizationContext
  partnershipId: string
  plan: WorkPlan
  /** Edição comum permitida (versão em cadastramento + `work-plan.edit`; decidido pela página). */
  canEdit: boolean
  /** Mensagem quando a edição não é possível por autorização/ciclo de vida (null = nada a dizer). */
  editDenial: string | null
  onNotice(notice: { kind: 'success' | 'error'; text: string }): void
  /** Componentes carregados (conferência da finalização e da incorporação, DEC-PT-006/007). */
  onComponents?(data: Components | null): void
}

/**
 * Metas e indicadores PREVISTOS da versão exibida (DEV-02.4; HF-G05 PAG-OSC05 "Metas e
 * Indicadores"). Somente planejamento: não há resultados apurados, percentuais de cumprimento
 * nem avaliações. Cada componente pertence a esta versão; versões anteriores ficam preservadas.
 */
export function PlanComponents({ context, partnershipId, plan, canEdit, editDenial, onNotice, onComponents }: Props) {
  const { service, api } = useWorkPlanDependencies()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState<Editing>(null)
  const requestId = useRef(globalThis.crypto.randomUUID())
  const reported = useRef(onComponents)
  useEffect(() => {
    reported.current = onComponents
  })
  const label = versionLabel(plan.sequence)

  useEffect(() => {
    let alive = true
    void service.listComponents(context.oscId, partnershipId, plan.id).then((r) => {
      if (!alive) return
      setState(r.ok ? { status: 'ready', data: r.data } : { status: 'error', text: PARTNERSHIP_LOAD_ERROR[r.error] })
      reported.current?.(r.ok ? r.data : null)
    })
    return () => {
      alive = false
    }
  }, [service, context.oscId, partnershipId, plan.id, plan.revision, plan.transcription?.status, attempt])

  const reload = () => setAttempt((n) => n + 1)
  const data = state.status === 'ready' ? state.data : null
  const goals = data?.goals ?? []
  const indicators = data?.indicators ?? []
  const activeGoals = goals.filter((g) => g.data.status === 'active')
  const activeIndicators = indicators.filter((i) => i.data.status === 'active')
  const discontinued = [...goals.filter((g) => g.data.status === 'discontinued'), ...indicators.filter((i) => i.data.status === 'discontinued')]
  const unlinked = activeIndicators.filter((i) => !i.data.goalIds.some((g) => activeGoals.some((x) => x.id === g)))
  const goalCode = (id: string) => goals.find((g) => g.id === id)?.data.code ?? '—'

  async function save(kind: 'goal' | 'indicator', record: ComponentRecord<GoalData | IndicatorData> | null, payload: GoalData | IndicatorData): Promise<SubmitResult> {
    const base = { oscId: context.oscId, partnershipId, workPlanId: plan.id, requestId: requestId.current, kind, data: payload }
    const result = record ? await api.updateComponent({ ...base, componentId: record.id, expectedRevision: record.revision }) : await api.createComponent(base)
    if (result.ok) {
      requestId.current = globalThis.crypto.randomUUID()
      setEditing(null)
      onNotice({ kind: 'success', text: `${kind === 'goal' ? 'Meta' : 'Indicador'} ${payload.code} ${record ? 'atualizad' : 'registrad'}${kind === 'goal' ? 'a' : 'o'} e confirmad${kind === 'goal' ? 'a' : 'o'} pelo servidor.` })
      reload()
      return { ok: true }
    }
    if (result.error === 'stale') reload()
    if (result.error !== 'network' && result.error !== 'invalid-component') requestId.current = globalThis.crypto.randomUUID()
    return {
      ok: false,
      fields: result.error === 'invalid-component' ? (result.fields as ComponentErrors) : undefined,
      message:
        result.error === 'stale'
          ? 'O componente foi alterado por outra pessoa; os dados foram recarregados. Revise e salve novamente.'
          : result.error === 'network'
            ? 'Não foi possível comunicar com o servidor. Nada foi gravado; os dados foram mantidos.'
            : result.error === 'forbidden' && result.reason
              ? denialMessage(result.reason, 'Operação não autorizada.')
              : result.error === 'invalid-component'
                ? 'Revise os campos indicados. Nada foi gravado.'
                : 'Não foi possível gravar. Nada foi alterado.',
    }
  }

  const editButton = (text: string, aria: string, onClick: () => void) =>
    canEdit && editing === null ? (
      <span className={styles.touch}>
        <button type="button" className={ds.secondary} aria-label={aria} onClick={onClick}>
          {text}
        </button>
      </span>
    ) : null

  const indicatorItem = (i: ComponentRecord<IndicatorData>) => (
    <li key={i.id} className={styles.card} style={{ paddingLeft: 0, paddingRight: 0 }}>
      <div className={styles.cardRow} style={{ justifyContent: 'space-between' }}>
        <strong>
          {i.data.code} · {i.data.name}
        </strong>
        <span className={`${ds.badge} ${styles.situation}`}>{natureLabel(i.data.nature)}</span>
      </div>
      <dl className={styles.dl}>
        {i.data.nature === 'quantitative' ? (
          <div>
            <dt>Resultado previsto</dt>
            <dd>
              {show(i.data.target, i.data.unit)} <span className={styles.detail} style={{ display: 'inline' }}>({measurementLabel(i.data.measurementType)})</span>
            </dd>
          </div>
        ) : null}
        {i.data.expectedParameter.state !== 'not-informed' || i.data.nature === 'qualitative' ? (
          <div>
            <dt>Parâmetro esperado</dt>
            <dd>{show(i.data.expectedParameter)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Periodicidade</dt>
          <dd>{periodicityLabel(i.data.periodicity)}</dd>
        </div>
        <div>
          <dt>Metas vinculadas</dt>
          <dd>{i.data.goalIds.length ? i.data.goalIds.map(goalCode).join(', ') : 'Nenhuma'}</dd>
        </div>
        <div className={styles.wide}>
          <dt>{i.data.nature === 'quantitative' ? 'Fórmula' : 'Regra ou critério'}</dt>
          <dd style={{ overflowWrap: 'anywhere' }}>{ruleSummary(i.data)}</dd>
        </div>
        {i.data.categories.length ? (
          <div className={styles.wide}>
            <dt>Categorias de classificação</dt>
            <dd>{i.data.categories.join('; ')}</dd>
          </div>
        ) : null}
        {i.data.classificationCriterion.state !== 'not-informed' ? (
          <div className={styles.wide}>
            <dt>Critério de classificação</dt>
            <dd>{show(i.data.classificationCriterion)}</dd>
          </div>
        ) : null}
        {i.data.verificationSource.state !== 'not-informed' ? (
          <div className={styles.wide}>
            <dt>Fonte ou meio de verificação</dt>
            <dd>{show(i.data.verificationSource)}</dd>
          </div>
        ) : null}
      </dl>
      {editButton('Editar', `Editar indicador ${i.data.code}`, () => setEditing({ kind: 'indicator', record: i, presetGoal: null }))}
    </li>
  )

  const form =
    editing === null ? null : editing.kind === 'goal' ? (
      <GoalFormCard
        key={editing.record?.id ?? 'new-goal'}
        initial={editing.record?.data ?? null}
        suggestedCode={nextCode('Meta ', goals.map((g) => g.data.code))}
        order={editing.record?.data.order ?? goals.length}
        versionLabel={label}
        onCancel={() => setEditing(null)}
        onSubmit={(d) => save('goal', editing.record, d)}
      />
    ) : (
      <IndicatorFormCard
        key={editing.record?.id ?? 'new-indicator'}
        initial={editing.record?.data ?? null}
        suggestedCode={nextCode('IND-', indicators.map((i) => i.data.code))}
        order={editing.record?.data.order ?? indicators.length}
        versionLabel={label}
        goals={goals.map((g) => ({ id: g.id, code: g.data.code, description: g.data.description, active: g.data.status === 'active' }))}
        presetGoal={editing.presetGoal}
        onCancel={() => setEditing(null)}
        onSubmit={(d) => save('indicator', editing.record, d)}
      />
    )

  return (
    <section className={ds.card} aria-labelledby="osc05-componentes" aria-busy={state.status === 'loading'}>
      <div className={styles.listHeader} style={{ padding: 0 }}>
        <h2 id="osc05-componentes" className={ds.sectionTitle}>
          Metas e indicadores previstos
        </h2>
        {data ? (
          <span className={`${ds.badge} ${styles.situation}`}>
            {activeGoals.length} {activeGoals.length === 1 ? 'meta' : 'metas'} · {activeIndicators.length} {activeIndicators.length === 1 ? 'indicador' : 'indicadores'}
          </span>
        ) : null}
      </div>
      <p className={styles.hint}>Componentes do Plano aprovado nesta versão. Resultados realizados, apurações e avaliações não são registrados aqui.</p>
      {state.status === 'loading' ? (
        <p className={ds.muted} role="status">
          Consultando metas e indicadores…
        </p>
      ) : state.status === 'error' ? (
        <div className={ds.stack}>
          <p className={ds.error} role="alert">
            {state.text}
          </p>
          <span className={styles.touch}>
            <button type="button" className={ds.secondary} onClick={() => { setState({ status: 'loading' }); reload() }}>
              Tentar novamente
            </button>
          </span>
        </div>
      ) : (
        <>
          {state.data.discarded > 0 ? (
            <p className={ds.warning} role="note">
              {state.data.discarded} registro(s) fora do formato esperado não são exibidos. Procure o suporte.
            </p>
          ) : null}
          {goals.length + indicators.length === 0 ? (
            <p className={`${ds.info} ${styles.iconNote}`} role="note">
              <InfoIcon />
              <span>
                {plan.registrationStatus === 'finalized' && !canEdit
                  ? denialMessage('complementary-transcription-pending', '')
                  : canEdit
                    ? 'Nenhuma meta ou indicador registrado nesta versão. Registre-os como constam do Plano aprovado.'
                    : 'Nenhuma meta ou indicador registrado nesta versão.'}
              </span>
            </p>
          ) : null}
          {activeGoals.length ? (
            <ol className={ds.stack} aria-label="Metas previstas" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {activeGoals.map((g) => {
                const linked = activeIndicators.filter((i) => i.data.goalIds.includes(g.id))
                return (
                  <li key={g.id}>
                    <article className={styles.card} style={{ border: '1px solid var(--ds-border-subtle)', borderRadius: 'var(--ds-radius-md, 8px)' }} aria-labelledby={`meta-${g.id}`}>
                      <div className={styles.cardRow} style={{ justifyContent: 'space-between' }}>
                        <h3 id={`meta-${g.id}`} className={ds.cardTitle} style={{ margin: 0 }}>
                          {g.data.code}
                        </h3>
                        <span className={`${ds.badge} ${styles.situation}`}>Meta {natureLabel(g.data.nature).toLowerCase()}</span>
                      </div>
                      <p style={{ margin: 0, overflowWrap: 'anywhere' }}>{g.data.description}</p>
                      <dl className={styles.dl}>
                        {g.data.nature === 'quantitative' ? (
                          <div>
                            <dt>Quantidade prevista</dt>
                            <dd>{show(g.data.expectedQuantity, g.data.unit)}</dd>
                          </div>
                        ) : null}
                        <div>
                          <dt>Resultado previsto</dt>
                          <dd>{show(g.data.expectedResult)}</dd>
                        </div>
                        <div>
                          <dt>Critério de cumprimento</dt>
                          <dd>{show(g.data.completionCriterion)}</dd>
                        </div>
                        <div>
                          <dt>Período de referência</dt>
                          <dd>{show(g.data.referencePeriod)}</dd>
                        </div>
                      </dl>
                      <div className={`${styles.actions} ${styles.touch}`}>
                        {editButton('Editar meta', `Editar meta ${g.data.code}`, () => setEditing({ kind: 'goal', record: g }))}
                        {editButton('Adicionar indicador', `Adicionar indicador à meta ${g.data.code}`, () => setEditing({ kind: 'indicator', record: null, presetGoal: g.id }))}
                      </div>
                      <h4 className={styles.label} style={{ margin: 0 }}>
                        Indicadores da meta {g.data.code}
                      </h4>
                      {linked.length ? (
                        <ul aria-label={`Indicadores da meta ${g.data.code}`} style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                          {linked.map(indicatorItem)}
                        </ul>
                      ) : (
                        <p className={ds.muted} style={{ margin: 0 }}>
                          Nenhum indicador vinculado.
                        </p>
                      )}
                    </article>
                  </li>
                )
              })}
            </ol>
          ) : null}
          {unlinked.length ? (
            <div className={ds.stack}>
              <h3 className={ds.cardTitle} style={{ margin: 0 }}>
                Indicadores sem meta vinculada
              </h3>
              <ul aria-label="Indicadores sem meta vinculada" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {unlinked.map(indicatorItem)}
              </ul>
            </div>
          ) : null}
          {discontinued.length ? (
            <details>
              <summary className={styles.touch} style={{ cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                Descontinuados nesta versão ({discontinued.length})
              </summary>
              <ul aria-label="Componentes descontinuados nesta versão" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {discontinued.map((c) => (
                  <li key={c.id} className={styles.card} style={{ paddingLeft: 0, paddingRight: 0 }}>
                    <span>
                      {c.kind === 'goal' ? 'Meta' : 'Indicador'} {c.data.code} — {'description' in c.data && typeof c.data.description === 'string' ? c.data.description : (c.data as IndicatorData).name}
                    </span>
                    {canEdit && editing === null ? (
                      <span className={styles.touch}>
                        <button
                          type="button"
                          className={ds.secondary}
                          aria-label={`Editar ${c.kind === 'goal' ? 'meta' : 'indicador'} ${c.data.code}`}
                          onClick={() => setEditing(c.kind === 'goal' ? { kind: 'goal', record: c as ComponentRecord<GoalData> } : { kind: 'indicator', record: c as ComponentRecord<IndicatorData>, presetGoal: null })}
                        >
                          Editar
                        </button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {canEdit && editing === null ? (
            <div className={`${styles.actions} ${styles.touch}`}>
              <button type="button" className={ds.primary} onClick={() => setEditing({ kind: 'goal', record: null })}>
                Adicionar meta
              </button>
              <button type="button" className={ds.secondary} onClick={() => setEditing({ kind: 'indicator', record: null, presetGoal: null })}>
                Adicionar indicador
              </button>
            </div>
          ) : null}
          {!canEdit && editDenial && plan.registrationStatus === 'in-registration' ? <p className={ds.muted}>{editDenial}</p> : null}
          {form}
        </>
      )}
    </section>
  )
}
