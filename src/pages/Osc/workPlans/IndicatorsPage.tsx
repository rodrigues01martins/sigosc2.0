import { useEffect, useRef, useState } from 'react'
import ds from '../../../components/ds/ds.module.css'
import { InfoIcon, LockIcon } from '../../../components/ds/icons.tsx'
import { ContextBar } from '../../../components/osc/ContextBar.tsx'
import { DENIAL_MESSAGE, evaluate, type AuthorizationContext } from '../../../domain/authorization.ts'
import { CONSULT_PERMISSION } from '../../../domain/partnerships.ts'
import { currentVersionId, versionLabel } from '../../../domain/workPlanVersions.ts'
import { VIEW_PERMISSION } from '../../../domain/workPlans.ts'
import { usePartnershipDependencies } from '../../../hooks/partnershipsContext.ts'
import { useWorkPlanDependencies } from '../../../hooks/workPlansContext.ts'
import type { Partnership, PartnershipErrorKind } from '../../../services/partnerships/types.ts'
import type { PlanComponents, WorkPlan } from '../../../services/workPlans/types.ts'
import styles from '../partnerships/Partnerships.module.css'
import { PARTNERSHIP_LOAD_ERROR } from '../partnerships/format.ts'
import { measurementLabel, natureLabel, periodicityLabel, show } from './componentForm.ts'

interface Props {
  context: AuthorizationContext
  oscName: string
  partnershipId: string
  partnershipLabel: string
  onResolved(partnership: Partnership): void
  onNotFound(): void
  onBack(): void
  onOpenPlan(): void
}

type State =
  | { status: 'loading' }
  | { status: 'error'; error: PartnershipErrorKind }
  | { status: 'not-found' }
  | { status: 'ready'; partnership: Partnership; current: WorkPlan | null; components: PlanComponents | null; planAllowed: boolean }

/**
 * PAG-OSC08 — Monitoramento e Avaliação (DEV-02.4): somente a CONSULTA dos indicadores PREVISTOS
 * na versão vigente do Plano (HF-G05: Código · Indicador · Meta; periodicidade por indicador).
 * Apuração, avaliação qualitativa, ajuste manual e evidências pertencem a módulos futuros:
 * nenhum resultado é exibido e nenhum botão inoperante é oferecido.
 */
export function IndicatorsPage({ context, oscName, partnershipId, partnershipLabel, onResolved, onNotFound, onBack, onOpenPlan }: Props) {
  const partnerships = usePartnershipDependencies()
  const workPlans = useWorkPlanDependencies()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const consult = evaluate(context, { kind: 'consult', permission: CONSULT_PERMISSION })
  const planAllowed = evaluate(context, { kind: 'consult', permission: VIEW_PERMISSION }).allowed
  const callbacks = useRef({ onResolved, onNotFound })
  useEffect(() => {
    callbacks.current = { onResolved, onNotFound }
  })

  useEffect(() => {
    if (!consult.allowed) return
    let alive = true
    void (async () => {
      const p = await partnerships.service.get(context.oscId, partnershipId)
      if (!alive) return
      if (!p.ok && p.error !== 'permission-denied') return setState({ status: 'error', error: p.error })
      if (!p.ok || p.data === null) {
        setState({ status: 'not-found' })
        callbacks.current.onNotFound()
        return
      }
      callbacks.current.onResolved(p.data)
      if (!planAllowed) return setState({ status: 'ready', partnership: p.data, current: null, components: null, planAllowed: false })
      const versions = await workPlans.service.listVersions(context.oscId, partnershipId)
      if (!alive) return
      if (!versions.ok) return setState({ status: 'error', error: versions.error })
      const currentId = currentVersionId(versions.data)
      const current = versions.data.find((v) => v.id === currentId) ?? null
      if (!current) return setState({ status: 'ready', partnership: p.data, current: null, components: null, planAllowed: true })
      const components = await workPlans.service.listComponents(context.oscId, partnershipId, current.id)
      if (!alive) return
      if (!components.ok) return setState({ status: 'error', error: components.error })
      setState({ status: 'ready', partnership: p.data, current, components: components.data, planAllowed: true })
    })()
    return () => {
      alive = false
    }
  }, [consult.allowed, context.oscId, partnershipId, partnerships.service, workPlans.service, planAllowed, attempt])

  if (!consult.allowed) {
    return (
      <>
        <ContextBar oscName={oscName} partnership={partnershipLabel} />
        <section className={ds.empty} aria-labelledby="osc08-sem-acesso">
          <span className={ds.emptyIcon}>
            <LockIcon size={28} />
          </span>
          <div className={ds.stack}>
            <h2 id="osc08-sem-acesso" className={ds.cardTitle}>
              Consulta de parcerias não autorizada
            </h2>
            <p className={ds.muted}>{consult.reason === 'permission-not-granted' ? 'É necessária a permissão “Consultar parcerias da OSC”.' : DENIAL_MESSAGE[consult.reason]}</p>
          </div>
        </section>
      </>
    )
  }

  const body = (() => {
    if (state.status === 'loading')
      return (
        <p className={ds.muted} role="status">
          Consultando os indicadores…
        </p>
      )
    if (state.status === 'not-found')
      return (
        <section className={ds.card} aria-labelledby="osc08-nao-encontrada">
          <h2 id="osc08-nao-encontrada" className={ds.sectionTitle}>
            Parceria não encontrada nesta OSC
          </h2>
          <span className={styles.touch}>
            <button type="button" className={ds.secondary} onClick={onBack}>
              Voltar às parcerias
            </button>
          </span>
        </section>
      )
    if (state.status === 'error')
      return (
        <div className={ds.stack}>
          <p className={ds.error} role="alert">
            {PARTNERSHIP_LOAD_ERROR[state.error]}
          </p>
          <span className={styles.touch}>
            <button type="button" className={ds.secondary} onClick={() => { setState({ status: 'loading' }); setAttempt((n) => n + 1) }}>
              Tentar novamente
            </button>
          </span>
        </div>
      )
    if (!state.planAllowed)
      return (
        <p className={`${ds.info} ${styles.iconNote}`} role="note">
          <InfoIcon />
          <span>Você não possui a permissão “Consultar Planos de Trabalho”. Solicite-a ao administrador da OSC ou a um delegado.</span>
        </p>
      )
    const { current, components } = state
    const goalCode = (id: string) => components?.goals.find((g) => g.id === id)?.data.code ?? '—'
    const indicators = components?.indicators.filter((i) => i.data.status === 'active') ?? []
    return (
      <section className={ds.card} aria-labelledby="osc08-indicadores">
        <div className={styles.listHeader} style={{ padding: 0 }}>
          <h2 id="osc08-indicadores" className={ds.sectionTitle}>
            Indicadores do Plano vigente
          </h2>
          {current ? <span className={`${ds.badge} ${styles.situation}`}>{versionLabel(current.sequence)} · Vigente no SIGOSC</span> : null}
        </div>
        {!current ? (
          <p className={ds.muted}>Não há indicadores: o Plano de Trabalho aprovado ainda não foi registrado e finalizado para esta parceria.</p>
        ) : indicators.length === 0 ? (
          <p className={ds.muted}>Nenhum indicador registrado na versão vigente do Plano de Trabalho.</p>
        ) : (
          <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Tabela de indicadores previstos">
            <table className={styles.table} style={{ minWidth: 0 }}>
              <caption className={ds.srOnly}>Indicadores previstos na {versionLabel(current.sequence).toLowerCase()} do Plano de Trabalho</caption>
              <thead>
                <tr>
                  <th scope="col">Código</th>
                  <th scope="col">Indicador</th>
                  <th scope="col">Meta</th>
                  <th scope="col">Periodicidade</th>
                  <th scope="col">Resultado previsto</th>
                </tr>
              </thead>
              <tbody>
                {indicators.map((i) => (
                  <tr key={i.id}>
                    <th scope="row">{i.data.code}</th>
                    <td style={{ overflowWrap: 'anywhere' }}>
                      {i.data.name}
                      <span className={styles.detail}>{natureLabel(i.data.nature)}{i.data.measurementType ? ` · ${measurementLabel(i.data.measurementType)}` : ''}</span>
                    </td>
                    <td>{i.data.goalIds.length ? i.data.goalIds.map(goalCode).join(', ') : 'Sem meta vinculada'}</td>
                    <td>{periodicityLabel(i.data.periodicity)}</td>
                    <td style={{ overflowWrap: 'anywhere' }}>{i.data.nature === 'quantitative' ? show(i.data.target, i.data.unit) : show(i.data.expectedParameter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.hint}>
          Valores previstos no Plano aprovado. Apurações, avaliações, ajustes e evidências ainda não estão disponíveis no SIGOSC; nenhum resultado realizado é exibido.
        </p>
        <span className={styles.touch}>
          <button type="button" className={ds.secondary} onClick={onOpenPlan}>
            Abrir o Plano de Trabalho
          </button>
        </span>
      </section>
    )
  })()

  return (
    <>
      <ContextBar oscName={oscName} partnership={partnershipLabel} />
      {body}
    </>
  )
}
