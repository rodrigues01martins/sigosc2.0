import { useCallback, useEffect, useRef, useState } from 'react'
import { InfoIcon, LayersIcon, LockIcon } from '../../../components/ds/icons.tsx'
import ds from '../../../components/ds/ds.module.css'
import { ContextBar } from '../../../components/osc/ContextBar.tsx'
import { DENIAL_MESSAGE, evaluate, type AuthorizationContext } from '../../../domain/authorization.ts'
import { CONSULT_PERMISSION, hasFinancialTransfer, instrumentOf, partnershipTitle } from '../../../domain/partnerships.ts'
import {
  FIELD_DEFINITIONS as FIELDS,
  GROUPS,
  SITUATION_LABEL,
  VIEW_PERMISSION,
  WORK_PLAN_MESSAGE,
  checkFinalization,
  decideWorkPlanOperation,
  type FieldValue,
  type WorkPlanDecision,
  type WorkPlanSituation,
} from '../../../domain/workPlans.ts'
import { usePartnershipDependencies } from '../../../hooks/partnershipsContext.ts'
import { useWorkPlanDependencies } from '../../../hooks/workPlansContext.ts'
import type { Partnership, PartnershipErrorKind } from '../../../services/partnerships/types.ts'
import type { WorkPlan } from '../../../services/workPlans/types.ts'
import styles from '../partnerships/Partnerships.module.css'
import { PARTNERSHIP_LOAD_ERROR, formatDate, formatTerm, formatTimestamp } from '../partnerships/format.ts'
import { PartnershipStatus } from '../partnerships/PartnershipStatus.tsx'
import type { FormState } from './form.ts'
import { WorkPlanEditor } from './WorkPlanEditor.tsx'

interface Props {
  context: AuthorizationContext
  oscName: string
  partnershipId: string
  partnershipLabel: string
  onResolved(partnership: Partnership): void
  onNotFound(): void
  onBack(): void
}

type State =
  | { status: 'loading' }
  | { status: 'error'; error: PartnershipErrorKind }
  | { status: 'not-found' }
  | { status: 'ready'; partnership: Partnership; plan: WorkPlan | null; planAllowed: boolean }

const NUMBER = new Intl.NumberFormat('pt-BR')

function display(value: FieldValue, kind: string): string {
  if (value.state === 'not-informed') return 'Não informado'
  if (value.state === 'not-applicable') return 'Não se aplica'
  if (kind === 'date') return formatDate(String(value.value))
  if (kind === 'integer') return NUMBER.format(Number(value.value))
  return String(value.value)
}

function denialText(decision: Extract<WorkPlanDecision, { allowed: false }>, missing: string): string {
  if (decision.reason === 'permission-not-granted') return missing
  return WORK_PLAN_MESSAGE[decision.reason] ?? (decision.reason in DENIAL_MESSAGE ? DENIAL_MESSAGE[decision.reason as keyof typeof DENIAL_MESSAGE] : '')
}

/**
 * PAG-OSC05 — Plano de Trabalho (DEV-02.2). Cadastro ESTRUTURADO do Plano aprovado da parceria
 * selecionada: situação do cadastro (não estruturado, em cadastramento, finalizado internamente),
 * dados autoritativos da parceria (não duplicados), edição por seções e finalização interna.
 * Abas "Versões" e "Alterações (Formalizadas)", metas, indicadores e planejamento financeiro do
 * HF-G05 NÃO foram implementados (sem botões inoperantes).
 */
export function WorkPlanPage(props: Props) {
  const consult = evaluate(props.context, { kind: 'consult', permission: CONSULT_PERMISSION })
  if (!consult.allowed) {
    return (
      <>
        <ContextBar oscName={props.oscName} partnership={props.partnershipLabel} />
        <section className={ds.empty} aria-labelledby="osc05-sem-acesso">
          <span className={ds.emptyIcon}>
            <LockIcon size={28} />
          </span>
          <div className={ds.stack}>
            <h2 id="osc05-sem-acesso" className={ds.cardTitle}>
              Consulta de parcerias não autorizada
            </h2>
            <p className={ds.muted}>
              {consult.reason === 'permission-not-granted' ? 'Para acessar o Plano, é necessária a permissão “Consultar parcerias da OSC”.' : DENIAL_MESSAGE[consult.reason]}
            </p>
          </div>
        </section>
      </>
    )
  }
  return <WorkPlanContent {...props} />
}

function WorkPlanContent({ context, oscName, partnershipId, partnershipLabel, onResolved, onNotFound, onBack }: Props) {
  const partnerships = usePartnershipDependencies()
  const workPlans = useWorkPlanDependencies()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [carry, setCarry] = useState<{ form: FormState; key: number; staleRevision: number } | null>(null)
  const [notice, setNotice] = useState<{ kind: 'success' | 'warning' | 'error'; text: string } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const requestIds = useRef({ start: globalThis.crypto.randomUUID(), finalize: globalThis.crypto.randomUUID() })
  const callbacks = useRef({ onResolved, onNotFound })
  useEffect(() => {
    callbacks.current = { onResolved, onNotFound }
  })
  const planAllowed = evaluate(context, { kind: 'consult', permission: VIEW_PERMISSION }).allowed

  useEffect(() => {
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
      if (!planAllowed) return setState({ status: 'ready', partnership: p.data, plan: null, planAllowed: false })
      const plan = await workPlans.service.get(context.oscId, partnershipId)
      if (!alive) return
      if (!plan.ok) return setState({ status: 'error', error: plan.error })
      setState({ status: 'ready', partnership: p.data, plan: plan.data, planAllowed: true })
    })()
    return () => {
      alive = false
    }
  }, [context.oscId, partnershipId, partnerships.service, workPlans.service, planAllowed, attempt])

  const refresh = useCallback(() => setAttempt((n) => n + 1), [])
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), [])

  if (state.status !== 'ready') {
    return (
      <>
        <ContextBar oscName={oscName} partnership={partnershipLabel} />
        {state.status === 'loading' ? (
          <p className={ds.muted} role="status">
            Consultando o Plano de Trabalho…
          </p>
        ) : state.status === 'not-found' ? (
          <section className={ds.card} aria-labelledby="osc05-nao-encontrada">
            <h2 id="osc05-nao-encontrada" className={ds.sectionTitle}>
              Parceria não encontrada nesta OSC
            </h2>
            <p className={ds.muted}>Selecione uma parceria da OSC na lista de parcerias.</p>
            <span className={styles.touch}>
              <button type="button" className={ds.secondary} onClick={onBack}>
                Voltar às parcerias
              </button>
            </span>
          </section>
        ) : (
          <div className={ds.stack}>
            <p className={ds.error} role="alert">
              {PARTNERSHIP_LOAD_ERROR[state.error]}
            </p>
            <span>
              <button type="button" className={ds.secondary} onClick={refresh}>
                Tentar novamente
              </button>
            </span>
          </div>
        )}
      </>
    )
  }

  const { partnership: p, plan } = state
  const situation: WorkPlanSituation = plan ? plan.registrationStatus : 'not-structured'
  const start = decideWorkPlanOperation(context, 'start', p.administrativeStatus, situation)
  const edit = decideWorkPlanOperation(context, 'update', p.administrativeStatus, situation)
  const finalize = decideWorkPlanOperation(context, 'finalize', p.administrativeStatus, situation)
  const facts = { instrument: p.instrument, termStart: p.termStart, termEnd: p.termEnd, formalizationDate: p.formalizationDate, administrativeStatus: p.administrativeStatus, workPlanApprovalDeclared: p.workPlanApprovalDeclared }
  const check = plan ? checkFinalization(plan.values, facts) : null
  const who = (uid: string | null) => (uid && uid === context.uid ? ' · por você' : '')

  async function startRegistration() {
    if (busy) return
    setBusy(true)
    setNotice(null)
    const result = await workPlans.api.start({ oscId: context.oscId, partnershipId, requestId: requestIds.current.start })
    setBusy(false)
    if (result.ok) {
      setNotice({ kind: 'success', text: 'Cadastro estruturado iniciado. Preencha as seções e salve.' })
      refresh()
    } else {
      setNotice({ kind: 'error', text: result.error === 'forbidden' && result.reason ? denialText({ allowed: false, reason: result.reason }, 'Você não possui autorização para registrar o Plano.') : result.error === 'network' ? 'Não foi possível comunicar com o servidor. Nada foi registrado; tente novamente.' : 'Não foi possível iniciar o cadastro.' })
    }
  }

  async function confirmFinalization() {
    if (busy || !plan) return
    setBusy(true)
    const result = await workPlans.api.finalize({ oscId: context.oscId, partnershipId, requestId: requestIds.current.finalize, expectedRevision: plan.revision })
    setBusy(false)
    setConfirming(false)
    if (result.ok) {
      setNotice({ kind: 'success', text: `Cadastro finalizado internamente e preservado.${result.warnings.length ? ` Pontos de conferência: ${result.warnings.join(' ')}` : ''}` })
    } else if (result.error === 'finalization-pending') {
      setNotice({ kind: 'error', text: `Finalização impedida: ${(result.pending ?? []).join(' ')}` })
    } else if (result.error === 'stale') {
      setNotice({ kind: 'warning', text: 'O cadastro foi alterado por outra pessoa. Os dados foram recarregados; confira antes de finalizar.' })
    } else {
      setNotice({ kind: 'error', text: result.error === 'forbidden' && result.reason ? denialText({ allowed: false, reason: result.reason }, 'Você não possui autorização para finalizar o cadastro.') : 'Não foi possível finalizar. O cadastro continua em andamento.' })
    }
    refresh()
  }

  return (
    <>
      <ContextBar oscName={oscName} partnership={partnershipLabel} />

      {p.administrativeStatus === 'arquivada' ? (
        <p className={styles.banner} role="note">
          <strong>Parceria arquivada.</strong>&nbsp;O Plano de Trabalho está disponível somente para consulta.
        </p>
      ) : null}
      {notice ? (
        <p className={notice.kind === 'success' ? ds.success : notice.kind === 'warning' ? ds.warning : ds.error} role={notice.kind === 'success' ? 'status' : 'alert'}>
          {notice.text}
        </p>
      ) : null}

      <section className={ds.card} aria-labelledby="osc05-referencia">
        <div className={styles.listHeader} style={{ padding: 0 }}>
          <h2 id="osc05-referencia" className={ds.sectionTitle}>
            {partnershipTitle(p)}
          </h2>
          <span className={`${ds.badge} ${styles.situation}`}>
            Cadastro no SIGOSC: {SITUATION_LABEL[situation]}
          </span>
        </div>
        <dl className={styles.dl}>
          <div>
            <dt>Instrumento MROSC</dt>
            <dd>{instrumentOf(p.instrument).label}</dd>
          </div>
          <div>
            <dt>Vigência da parceria</dt>
            <dd>{formatTerm(p.termStart, p.termEnd)}</dd>
          </div>
          <div>
            <dt>Situação da parceria (administrativa)</dt>
            <dd>
              <PartnershipStatus status={p.administrativeStatus} />
            </dd>
          </div>
          <div>
            <dt>Aprovação do Plano</dt>
            <dd>{p.workPlanApprovalDeclared ? 'Declarada pelo usuário no cadastro da parceria; não conferida pelo SIGOSC.' : 'Não declarada.'}</dd>
          </div>
          <div className={styles.wide}>
            <dt>Objeto</dt>
            <dd>{p.object}</dd>
          </div>
          <div className={styles.wide}>
            <dt>Documento do Plano aprovado</dt>
            <dd>Não armazenado no SIGOSC: o armazenamento documental ainda não está disponível. Nenhum arquivo foi incorporado.</dd>
          </div>
        </dl>
        <p className={styles.hint}>Instrumento, vigência e objeto vêm do cadastro da parceria (fonte autoritativa) e não são repetidos no Plano.</p>
      </section>

      {!state.planAllowed ? (
        <p className={`${ds.info} ${styles.iconNote}`} role="note">
          <InfoIcon />
          <span>Você não possui a permissão “Consultar Planos de Trabalho”. Solicite-a ao administrador da OSC ou a um delegado.</span>
        </p>
      ) : plan === null ? (
        <section className={ds.empty} aria-labelledby="osc05-nao-estruturado">
          <span className={ds.emptyIcon}>
            <LayersIcon size={32} />
          </span>
          <div className={ds.stack}>
            <h2 id="osc05-nao-estruturado" className={ds.cardTitle}>
              Plano de Trabalho aprovado ainda não registrado
            </h2>
            <p className={ds.muted}>
              A parceria já está formalizada e o Plano foi aprovado pelo órgão público fora do SIGOSC. Aqui apenas se registram as informações
              do Plano já aprovado.
            </p>
            {start.allowed ? (
              <span className={styles.touch}>
                <button type="button" className={ds.primary} onClick={() => void startRegistration()} disabled={busy} aria-busy={busy}>
                  {busy ? 'Iniciando…' : 'Iniciar cadastro estruturado'}
                </button>
              </span>
            ) : (
              <p className={ds.muted}>{denialText(start, 'Você pode consultar o Plano, mas não possui autorização para registrá-lo.')}</p>
            )}
          </div>
        </section>
      ) : (
        <>
          {plan.registrationStatus === 'in-registration' && edit.allowed ? (
            <WorkPlanEditor
              key={`${plan.revision}:${carry?.key ?? 0}`}
              plan={plan}
              initialForm={carry?.form}
              reloading={carry !== null && carry.staleRevision === plan.revision}
              onDirtyChange={onDirtyChange}
              onSaved={() => {
                setCarry(null)
                setNotice({ kind: 'success', text: 'Alterações salvas e confirmadas pelo servidor.' })
                refresh()
              }}
              onStale={(form) => {
                setCarry({ form, key: Date.now(), staleRevision: plan.revision })
                setNotice({ kind: 'warning', text: 'O cadastro foi alterado por outra pessoa. Os dados foram recarregados e o que você digitou foi mantido; revise e salve novamente.' })
                refresh()
              }}
            />
          ) : (
            <WorkPlanView plan={plan} who={who} />
          )}
          {plan.registrationStatus === 'in-registration' && !edit.allowed ? (
            <p className={`${ds.info} ${styles.iconNote}`} role="note">
              <InfoIcon />
              <span>{denialText(edit, 'Você pode consultar o cadastro, mas não possui autorização para alterá-lo.')}</span>
            </p>
          ) : null}

          <section className={ds.card} aria-labelledby="osc05-componentes">
            <h2 id="osc05-componentes" className={ds.sectionTitle}>
              Metas, indicadores e planejamento financeiro
            </h2>
            <dl className={styles.dl}>
              <div>
                <dt>Metas e indicadores</dt>
                <dd>Estruturação em incremento futuro (configuráveis por parceria). Nada foi registrado.</dd>
              </div>
              <div>
                <dt>Planejamento financeiro</dt>
                <dd>{hasFinancialTransfer(p.instrument) ? 'Estruturação em incremento futuro. Nenhum valor foi registrado.' : 'Não se aplica: Acordo de Cooperação, sem transferência de recursos financeiros.'}</dd>
              </div>
            </dl>
          </section>

          {plan.registrationStatus === 'in-registration' && check ? (
            <section className={ds.card} aria-labelledby="osc05-finalizacao">
              <h2 id="osc05-finalizacao" className={ds.sectionTitle}>
                Conferência para finalização interna
              </h2>
              {check.pending.length > 0 ? (
                <div className={ds.stack}>
                  <p className={ds.muted}>Pendências que impedem a finalização:</p>
                  <ul aria-label="Pendências" style={{ margin: 0, paddingLeft: 20 }}>
                    {check.pending.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className={ds.muted}>Os requisitos para a finalização estão atendidos.</p>
              )}
              {check.warnings.length > 0 ? (
                <ul aria-label="Pontos de conferência" className={styles.fieldWarning} style={{ margin: 0, paddingLeft: 20 }}>
                  {check.warnings.map((t) => (
                    <li key={t}>Atenção: {t}</li>
                  ))}
                </ul>
              ) : null}
              {finalize.allowed ? (
                confirming ? (
                  <div className={ds.warning} role="alertdialog" aria-labelledby="osc05-confirmar" aria-describedby="osc05-confirmar-texto">
                    <div className={ds.stack}>
                      <strong id="osc05-confirmar">Confirmar finalização interna</strong>
                      <span id="osc05-confirmar-texto">
                        O cadastro estruturado do Plano de Trabalho de {partnershipTitle(p)} será preservado e não poderá ser alterado no SIGOSC.
                        A finalização não representa aprovação jurídica nem oficial do Plano. Alterações formais futuras dependerão do
                        versionamento, ainda não disponível.
                      </span>
                      <div className={styles.actions}>
                        <button type="button" className={ds.linkButton} onClick={() => setConfirming(false)} disabled={busy}>
                          Cancelar
                        </button>
                        <button type="button" className={ds.primary} onClick={() => void confirmFinalization()} disabled={busy} aria-busy={busy} autoFocus>
                          {busy ? 'Finalizando…' : 'Finalizar cadastro'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={styles.touch}>
                    <button type="button" className={ds.secondary} disabled={check.pending.length > 0 || dirty} onClick={() => setConfirming(true)} aria-describedby="osc05-finalizar-nota">
                      Finalizar cadastro
                    </button>
                    <p id="osc05-finalizar-nota" className={styles.hint}>
                      {dirty ? 'Salve as alterações antes de finalizar.' : check.pending.length > 0 ? 'Resolva as pendências para finalizar.' : 'A finalização exige confirmação.'}
                    </p>
                  </div>
                )
              ) : (
                <p className={styles.hint}>{denialText(finalize, 'A finalização interna exige a permissão “Finalizar internamente o cadastro do Plano de Trabalho”.')}</p>
              )}
            </section>
          ) : null}

          {plan.registrationStatus === 'finalized' ? (
            <p className={`${ds.info} ${styles.iconNote}`} role="note">
              <InfoIcon />
              <span>
                Cadastro finalizado internamente em {formatTimestamp(plan.finalizedAt)}
                {who(plan.finalizedBy)}. O registro está preservado; não representa aprovação jurídica. Correções e alterações formais dependem
                do versionamento, ainda não disponível.
              </span>
            </p>
          ) : null}
        </>
      )}
    </>
  )
}

function WorkPlanView({ plan, who }: { plan: WorkPlan; who(uid: string | null): string }) {
  return (
    <section className={ds.card} aria-labelledby="osc05-consulta">
      <h2 id="osc05-consulta" className={ds.sectionTitle}>
        Plano de Trabalho estruturado
      </h2>
      {GROUPS.map((group) => (
        <div key={group.id} className={ds.stack}>
          <h3 className={ds.cardTitle}>{group.label}</h3>
          <dl className={styles.dl}>
            {FIELDS.filter((f) => f.group === group.id).map((f) => (
              <div key={f.id} className={f.kind === 'text' && (f.max ?? 0) > 1000 ? styles.wide : undefined}>
                <dt>{f.label}</dt>
                <dd>{display(plan.values[f.id], f.kind)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      <p className={styles.hint}>
        Cadastro iniciado em {formatTimestamp(plan.createdAt)}
        {who(plan.createdBy)} · última alteração em {formatTimestamp(plan.updatedAt)}
        {who(plan.updatedBy)}.
      </p>
    </section>
  )
}
