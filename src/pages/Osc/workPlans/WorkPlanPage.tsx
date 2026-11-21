import { useCallback, useEffect, useRef, useState } from 'react'
import { InfoIcon, LayersIcon, LockIcon } from '../../../components/ds/icons.tsx'
import ds from '../../../components/ds/ds.module.css'
import { ContextBar } from '../../../components/osc/ContextBar.tsx'
import { DENIAL_MESSAGE, evaluate, type AuthorizationContext } from '../../../domain/authorization.ts'
import { CONSULT_PERMISSION, instrumentOf, partnershipTitle } from '../../../domain/partnerships.ts'
import {
  FIELD_DEFINITIONS as FIELDS,
  GROUPS,
  SITUATION_LABEL,
  VIEW_PERMISSION,
  decideWorkPlanOperation,
  type WorkPlanSituation,
} from '../../../domain/workPlans.ts'
import { usePartnershipDependencies } from '../../../hooks/partnershipsContext.ts'
import { useWorkPlanDependencies } from '../../../hooks/workPlansContext.ts'
import type { Partnership, PartnershipErrorKind } from '../../../services/partnerships/types.ts'
import type { PlanComponents as PlanComponentsData, PlanFinancial as PlanFinancialData, WorkPlan } from '../../../services/workPlans/types.ts'
import {
  ACTIVATION_LABEL,
  activationStatusOf,
  checkVersionFinalization,
  currentVersionId,
  decideVersionCreation,
  denialMessage,
  effectsStatus,
  formalActTypeLabel,
  versionLabel,
  type FormalActErrorCode,
  type FormalActField,
  type VersionDenial,
} from '../../../domain/workPlanVersions.ts'
import styles from '../partnerships/Partnerships.module.css'
import { PARTNERSHIP_LOAD_ERROR, formatDate, formatTerm, formatTimestamp, todayInBrasilia } from '../partnerships/format.ts'
import { PartnershipStatus } from '../partnerships/PartnershipStatus.tsx'
import { displayValue, type FormState } from './form.ts'
import { CorrectionHistory } from './CorrectionHistory.tsx'
import { WorkPlanCorrection } from './WorkPlanCorrection.tsx'
import { FormalActForm } from './FormalActForm.tsx'
import { VersionComparison } from './VersionComparison.tsx'
import { VersionHistory } from './VersionHistory.tsx'
import { ComponentReviewFields } from './ComponentReviewFields.tsx'
import { FinancialPlanning } from './FinancialPlanning.tsx'
import { FinancialTranscriptionPanel } from './FinancialTranscriptionPanel.tsx'
import { financialApplicability, financialPending, itemsMissingPlannedValue } from '../../../domain/workPlanFinancial.ts'
import { PlanComponents } from './PlanComponents.tsx'
import { TranscriptionPanel } from './TranscriptionPanel.tsx'
import { emptyReview, reviewFromDraft, type ReviewDraft } from './componentForm.ts'
import { COMPONENTS_DECLARATION, checkComponentReview, componentsToken } from '../../../domain/workPlanComponents.ts'
import { WorkPlanEditor } from './WorkPlanEditor.tsx'
import { VIGENCY_BADGE, vigencyNotice } from './vigency.ts'

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
  | { status: 'ready'; partnership: Partnership; versions: readonly WorkPlan[]; planAllowed: boolean }

function denialText(decision: { allowed: false; reason: VersionDenial }, missing: string): string {
  if (decision.reason === 'permission-not-granted') return missing
  return denialMessage(decision.reason, '')
}

/**
 * PAG-OSC05 — Plano de Trabalho (DEV-02.2). Cadastro ESTRUTURADO do Plano aprovado da parceria
 * selecionada: situação do cadastro (não estruturado, em cadastramento, finalizado internamente),
 * dados autoritativos da parceria (não duplicados), edição por seções e finalização interna.
 * DEV-02.3: versões e alterações formais. DEV-02.4: metas e indicadores PREVISTOS por versão.
 * Planejamento financeiro do HF-G05 ainda NÃO implementado (sem botões inoperantes).
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
  const [correcting, setCorrecting] = useState(false)
  const [historyKey, setHistoryKey] = useState(0)
  // DEV-02.3: versão exibida (null = padrão), registro de alteração formal e comparação.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creatingVersion, setCreatingVersion] = useState(false)
  const [editingAct, setEditingAct] = useState(false)
  const [comparison, setComparison] = useState<{ before: string; after: string } | null>(null)
  // DEV-02.4-C01: componentes da versão exibida, conferência (DEC-PT-007) e declaração na confirmação.
  const [components, setComponents] = useState<{ planId: string; data: PlanComponentsData | null } | null>(null)
  const [review, setReview] = useState<ReviewDraft>(emptyReview)
  // DEV-02.5-C01: planejamento financeiro da versão exibida (DEC-PT-013) e incorporação financeira (DEC-PT-011).
  const [financial, setFinancial] = useState<{ planId: string; data: PlanFinancialData | null } | null>(null)
  const [declared, setDeclared] = useState(false)
  const requestIds = useRef({ start: globalThis.crypto.randomUUID(), finalize: globalThis.crypto.randomUUID(), version: globalThis.crypto.randomUUID() })
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
      if (!planAllowed) return setState({ status: 'ready', partnership: p.data, versions: [], planAllowed: false })
      const versions = await workPlans.service.listVersions(context.oscId, partnershipId)
      if (!alive) return
      if (!versions.ok) return setState({ status: 'error', error: versions.error })
      setState({ status: 'ready', partnership: p.data, versions: versions.data, planAllowed: true })
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

  const { partnership: p, versions } = state
  // Vigência cadastral (DEC-PT-003): derivada dos documentos de versão (fonte autoritativa; ver domínio).
  const currentId = currentVersionId(versions)
  // Padrão: a versão em cadastramento (DEC-PT-004: no máximo uma); senão, a vigente.
  const pending = versions.find((v) => v.sequence > 1 && v.registrationStatus === 'in-registration')
  const defaultId = pending?.id ?? currentId ?? versions[0]?.id ?? null
  const plan: WorkPlan | null = versions.find((v) => v.id === (selectedId ?? defaultId)) ?? versions[0] ?? null
  const currentPlan = versions.find((v) => v.id === currentId) ?? null
  // DEC-PT-006 (3.7): a incorporação aberta também bloqueia nova versão na interface (sem botão inoperante).
  const creation = currentId ? decideVersionCreation(context, p.administrativeStatus, versions.map((v) => ({ ...v, transcriptionOpen: v.transcription?.status === 'open', financialTranscriptionOpen: v.financialTranscription?.status === 'open' })), currentId) : null
  const today = todayInBrasilia()
  const planVigency = plan ? activationStatusOf(plan, currentId) : 'in-registration'
  const notice2 = plan ? vigencyNotice(plan, planVigency, versions, today) : null
  function selectVersion(id: string) {
    setSelectedId(id)
    setReview(emptyReview())
    setDeclared(false)
    setCorrecting(false)
    setConfirming(false)
    setEditingAct(false)
    setCarry(null)
  }
  const situation: WorkPlanSituation = plan ? plan.registrationStatus : 'not-structured'
  const start = decideWorkPlanOperation(context, 'start', p.administrativeStatus, situation)
  const edit = decideWorkPlanOperation(context, 'update', p.administrativeStatus, situation)
  const finalize = decideWorkPlanOperation(context, 'finalize', p.administrativeStatus, situation)
  const correction = decideWorkPlanOperation(context, 'correct', p.administrativeStatus, situation)
  const facts = { instrument: p.instrument, termStart: p.termStart, termEnd: p.termEnd, formalizationDate: p.formalizationDate, administrativeStatus: p.administrativeStatus, workPlanApprovalDeclared: p.workPlanApprovalDeclared }
  const baseCheck = plan ? checkVersionFinalization(plan.values, facts, plan.sequence > 1 ? plan.formalAct : null, todayInBrasilia()) : null
  const loaded = plan && components?.planId === plan.id ? components.data : null
  // DEC-PT-007: conferência dos componentes avaliada também aqui (o servidor reavalia na transação).
  const reviewPending = loaded ? checkComponentReview(reviewFromDraft(review), loaded.goals, loaded.indicators) : ['Consultando metas e indicadores…']
  const financialApplies = financialApplicability(p.instrument) === 'applicable'
  const loadedFinancial = plan && financial?.planId === plan.id ? financial.data : null
  // DEC-PT-013: itens ATIVOS sem valor previsto impedem a finalização (o servidor reavalia na transação).
  const missingValues = loadedFinancial ? itemsMissingPlannedValue(loadedFinancial.items) : []
  const financialCheck = !financialApplies ? [] : loadedFinancial ? financialPending(loadedFinancial.categories, loadedFinancial.items) : ['Consultando o planejamento financeiro…']
  const check = baseCheck ? { pending: [...baseCheck.pending, ...reviewPending, ...financialCheck], warnings: baseCheck.warnings } : null
  const activeFinancialItems = loadedFinancial?.items.filter((i) => i.data.status === 'active') ?? []
  const goToItem = (id: string) => {
    const el = document.getElementById(`fin-item-${id}`)
    el?.scrollIntoView?.({ block: 'center' })
    el?.focus()
  }
  const activeCounts = { goals: loaded?.goals.filter((g) => g.data.status === 'active').length ?? 0, indicators: loaded?.indicators.filter((i) => i.data.status === 'active').length ?? 0 }
  const transcriptionDecision = plan ? decideWorkPlanOperation(context, 'correct', p.administrativeStatus, plan.registrationStatus) : null
  const inTranscription = plan?.registrationStatus === 'finalized' && plan.transcription?.status === 'open' && transcriptionDecision?.allowed === true
  const inFinancialTranscription = plan?.registrationStatus === 'finalized' && plan.financialTranscription?.status === 'open' && transcriptionDecision?.allowed === true
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
    const result = await workPlans.api.finalize({
      oscId: context.oscId,
      partnershipId,
      workPlanId: plan.id,
      requestId: requestIds.current.finalize,
      expectedRevision: plan.revision,
      review: reviewFromDraft(review),
      componentsToken: componentsToken([...(loaded?.goals ?? []), ...(loaded?.indicators ?? [])]),
      declaration: declared,
    })
    if (result.ok) {
      requestIds.current.finalize = globalThis.crypto.randomUUID()
      setReview(emptyReview())
    }
    setDeclared(false)
    setBusy(false)
    setConfirming(false)
    if (result.ok) {
      const activated = result.activation
      const effects = activated ? effectsStatus(activated.effectiveDate, todayInBrasilia()) : null
      const head = activated
        ? `Cadastro finalizado e ${versionLabel(activated.sequence)} ativada como vigente no SIGOSC; a ${versionLabel(versions.find((v) => v.id === activated.supersededWorkPlanId)?.sequence ?? 1).toLowerCase()} passa a constar como substituída e permanece preservada.${
            effects === 'future' ? ` Início de efeitos administrativos previsto para ${formatDate(activated.effectiveDate as string)}.` : effects === 'not-informed' ? ' Data de produção de efeitos administrativos não informada.' : ''
          } Não representa aprovação jurídica.`
        : 'Cadastro finalizado internamente e preservado.'
      setNotice({ kind: 'success', text: `${head}${result.warnings.length ? ` Pontos de conferência: ${result.warnings.join(' ')}` : ''}` })
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
          <section className={ds.card} aria-labelledby="osc05-versao-exibida">
            <div className={styles.listHeader} style={{ padding: 0 }}>
              <h2 id="osc05-versao-exibida" className={ds.sectionTitle}>
                {versionLabel(plan.sequence)}
              </h2>
              <span className={`${ds.badge} ${styles.situation} ${VIGENCY_BADGE[planVigency] ?? ''}`}>{ACTIVATION_LABEL[planVigency]}</span>
            </div>
            {notice2 ? (
              <p className={`${notice2.kind === 'warning' ? ds.warning : ds.info} ${styles.iconNote}`} role="note">
                <InfoIcon />
                <span>{notice2.text}</span>
              </p>
            ) : null}
            {plan.formalAct ? (
              <dl className={styles.dl}>
                <div>
                  <dt>Ato formal</dt>
                  <dd>
                    {formalActTypeLabel(plan.formalAct.type, plan.formalAct.typeDescription)}
                    {plan.formalAct.reference ? ` — ${plan.formalAct.reference}` : ''}
                  </dd>
                </div>
                <div>
                  <dt>Data do ato</dt>
                  <dd>{formatDate(plan.formalAct.actDate)}</dd>
                </div>
                <div>
                  <dt>Produção de efeitos</dt>
                  <dd>{plan.formalAct.effectiveDate ? formatDate(plan.formalAct.effectiveDate) : 'Não informada'}</dd>
                </div>
                {plan.activation.activatedAt ? (
                  <div>
                    <dt>Vigente no SIGOSC desde</dt>
                    <dd>{formatTimestamp(plan.activation.activatedAt)} (finalização interna)</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Versão anterior</dt>
                  <dd>{plan.previousWorkPlanId === 'original' ? 'Versão original' : (plan.previousWorkPlanId ?? '—')}</dd>
                </div>
                <div className={styles.wide}>
                  <dt>Descrição da alteração</dt>
                  <dd>{plan.formalAct.description ?? 'Não informada'}</dd>
                </div>
              </dl>
            ) : (
              <p className={ds.muted}>Representação estruturada do Plano aprovado original (origem da cadeia de versões).</p>
            )}
            <p className={styles.hint}>
              {plan.sequence > 1
                ? 'Ato formal declarado pelo usuário; o SIGOSC não o valida juridicamente e o documento não está armazenado. A vigência no SIGOSC é cadastral e não representa aprovação jurídica do ato.'
                : 'A finalização interna não representa aprovação jurídica.'}
            </p>
            {plan.sequence > 1 && plan.registrationStatus === 'in-registration' && edit.allowed && !editingAct ? (
              <span className={styles.touch}>
                <button type="button" className={ds.secondary} onClick={() => setEditingAct(true)}>
                  Editar dados do ato formal
                </button>
              </span>
            ) : null}
          </section>

          {editingAct && plan.formalAct ? (
            <FormalActForm
              mode="edit"
              baseLabel={versionLabel(plan.sequence)}
              initial={plan.formalAct}
              onCancel={() => setEditingAct(false)}
              onSubmit={async (act) => {
                const result = await workPlans.api.updateFormalAct({ oscId: context.oscId, partnershipId, workPlanId: plan.id, requestId: globalThis.crypto.randomUUID(), expectedRevision: plan.revision, formalAct: act })
                if (result.ok) {
                  setEditingAct(false)
                  setNotice({ kind: 'success', text: 'Dados do ato formal salvos e confirmados pelo servidor.' })
                  refresh()
                  return { ok: true }
                }
                if (result.error === 'stale') refresh()
                return { ok: false, fields: result.fields as Partial<Record<FormalActField | 'formalAct', FormalActErrorCode>> | undefined, message: result.error === 'stale' ? 'A versão foi alterada por outra pessoa; os dados foram recarregados. Revise e salve novamente.' : result.error === 'network' ? 'Não foi possível comunicar com o servidor. Nada foi gravado; os dados foram mantidos.' : result.error === 'forbidden' && result.reason ? denialMessage(result.reason, 'Operação não autorizada.') : 'Revise os dados do ato formal. Nada foi gravado.' }
              }}
            />
          ) : null}

          {plan.registrationStatus === 'in-registration' && edit.allowed ? (
            <WorkPlanEditor
              key={`${plan.id}:${plan.revision}:${carry?.key ?? 0}`}
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

          <PlanComponents
            key={plan.id}
            context={context}
            partnershipId={partnershipId}
            plan={plan}
            canEdit={(plan.registrationStatus === 'in-registration' && edit.allowed) || inTranscription}
            editDenial={edit.allowed ? null : denialText(edit, 'Você pode consultar as metas e os indicadores, mas não possui autorização para alterá-los.')}
            onNotice={setNotice}
            onComponents={(data) => setComponents({ planId: plan.id, data })}
          />
          <TranscriptionPanel
            key={`t-${plan.id}`}
            context={context}
            partnershipId={partnershipId}
            plan={plan}
            eligibleVersion={plan.id === currentId && !versions.some((v) => v.registrationStatus === 'in-registration')}
            canOperate={transcriptionDecision?.allowed === true}
            components={loaded}
            onNotice={setNotice}
            onChanged={refresh}
          />

          <FinancialPlanning
            key={`f-${plan.id}`}
            context={context}
            partnershipId={partnershipId}
            plan={plan}
            instrument={p.instrument}
            canEdit={(plan.registrationStatus === 'in-registration' && edit.allowed) || inFinancialTranscription}
            editDenial={edit.allowed ? null : denialText(edit, 'Você pode consultar o planejamento financeiro, mas não possui autorização para alterá-lo.')}
            onNotice={setNotice}
            onFinancial={(data) => setFinancial({ planId: plan.id, data })}
          />
          <FinancialTranscriptionPanel
            key={`ft-${plan.id}`}
            context={context}
            partnershipId={partnershipId}
            plan={plan}
            eligibleVersion={plan.id === currentId && !versions.some((v) => v.registrationStatus === 'in-registration')}
            applicable={financialApplies}
            canOperate={transcriptionDecision?.allowed === true}
            financial={loadedFinancial}
            onNotice={setNotice}
            onChanged={refresh}
          />

          {plan.registrationStatus === 'in-registration' && check ? (
            <section className={ds.card} aria-labelledby="osc05-finalizacao">
              <h2 id="osc05-finalizacao" className={ds.sectionTitle}>
                Conferência para finalização interna
              </h2>
              {finalize.allowed ? (
                <>
                  <h3 className={ds.cardTitle} style={{ margin: 0 }}>
                    Conferência de metas e indicadores
                  </h3>
                  <ComponentReviewFields value={review} onChange={setReview} counts={activeCounts} disabled={busy} />
                </>
              ) : null}
              {financialApplies && loadedFinancial && activeFinancialItems.length > 0 ? (
                <div className={ds.stack}>
                  <h3 className={ds.cardTitle} style={{ margin: 0 }}>
                    Valores previstos do planejamento financeiro
                  </h3>
                  <p className={ds.muted} role="status" style={{ margin: 0 }}>
                    {activeFinancialItems.length} {activeFinancialItems.length === 1 ? 'item ativo' : 'itens ativos'} · {activeFinancialItems.length - missingValues.length} com valor previsto informado · {missingValues.length} pendente
                    {missingValues.length === 1 ? '' : 's'}. A conferência documental do financeiro é opcional.
                  </p>
                  {missingValues.length ? (
                    <div className={`${styles.actions} ${styles.touch}`}>
                      {missingValues.map((i) => (
                        <button key={i.id} type="button" className={ds.secondary} onClick={() => goToItem(i.id)}>
                          Ir para o item {i.data.code}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
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
                        {plan.sequence > 1
                          ? `A ${versionLabel(plan.sequence)} do Plano de Trabalho de ${partnershipTitle(p)} será preservada e passará a ser a vigente no SIGOSC; a ${currentPlan ? versionLabel(currentPlan.sequence).toLowerCase() : 'versão atual'} ficará registrada como substituída e continuará disponível para consulta.`
                          : `O cadastro estruturado do Plano de Trabalho de ${partnershipTitle(p)} será preservado e não poderá ser alterado no SIGOSC.`}{' '}
                        A finalização não representa aprovação jurídica nem oficial do Plano{plan.sequence > 1 ? ', e a vigência no SIGOSC é apenas cadastral' : ''}.
                        Alterações formais posteriores são registradas como nova versão.
                      </span>
                      <label className={styles.check}>
                        <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} autoFocus />
                        <span>{COMPONENTS_DECLARATION}</span>
                      </label>
                      <div className={styles.actions}>
                        <button type="button" className={ds.linkButton} onClick={() => setConfirming(false)} disabled={busy}>
                          Cancelar
                        </button>
                        <button type="button" className={ds.primary} onClick={() => void confirmFinalization()} disabled={busy || !declared} aria-busy={busy}>
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
                <p className={styles.hint}>{denialText(finalize, 'A finalização interna exige a permissão “Registrar, finalizar e corrigir o Plano de Trabalho”.')}</p>
              )}
            </section>
          ) : null}

          {plan.registrationStatus === 'finalized' ? (
            <p className={`${ds.info} ${styles.iconNote}`} role="note">
              <InfoIcon />
              <span>
                Cadastro finalizado internamente em {formatTimestamp(plan.finalizedAt)}
                {who(plan.finalizedBy)}. O registro está preservado e não representa aprovação jurídica. Erros materiais de registro podem ser
                corrigidos com justificativa e ficam no histórico; alterações formais são registradas como nova versão.
              </span>
            </p>
          ) : null}

          {plan.registrationStatus === 'finalized' && correction.allowed ? (
            correcting ? (
              <WorkPlanCorrection
                plan={plan}
                partnership={facts}
                onCancel={() => setCorrecting(false)}
                onCorrected={(warnings) => {
                  setCorrecting(false)
                  setNotice({ kind: 'success', text: `Correção de erro material registrada. Os valores anteriores estão preservados no histórico.${warnings.length ? ` Pontos de conferência: ${warnings.join(' ')}` : ''}` })
                  setHistoryKey((n) => n + 1)
                  refresh()
                }}
                onStale={refresh}
              />
            ) : (
              <span className={styles.touch}>
                <button type="button" className={ds.secondary} onClick={() => { setNotice(null); setCorrecting(true) }}>
                  Corrigir erro material
                </button>
              </span>
            )
          ) : null}

          {plan.registrationStatus === 'finalized' ? <CorrectionHistory oscId={context.oscId} partnershipId={partnershipId} workPlanId={plan.id} refreshKey={historyKey} /> : null}

          {creatingVersion && currentPlan ? (
            <FormalActForm
              mode="create"
              baseLabel={versionLabel(currentPlan.sequence).toLowerCase()}
              onCancel={() => setCreatingVersion(false)}
              onSubmit={async (act) => {
                const result = await workPlans.api.createVersion({ oscId: context.oscId, partnershipId, requestId: requestIds.current.version, baseWorkPlanId: currentPlan.id, baseRevision: currentPlan.revision, formalAct: act })
                if (result.ok) {
                  requestIds.current.version = globalThis.crypto.randomUUID()
                  setCreatingVersion(false)
                  selectVersion(result.id)
                  setNotice({ kind: 'success', text: `Nova versão criada a partir da ${versionLabel(currentPlan.sequence).toLowerCase()}, que permanece preservada. Ajuste os campos alterados e finalize.` })
                  refresh()
                  return { ok: true }
                }
                if (result.error === 'stale' || (result.error === 'forbidden' && (result.reason === 'pending-version-exists' || result.reason === 'base-not-current'))) refresh()
                return {
                  ok: false,
                  fields: result.fields as Partial<Record<FormalActField | 'formalAct', FormalActErrorCode>> | undefined,
                  message:
                    result.error === 'stale'
                      ? 'A versão vigente foi alterada desde a sua consulta; os dados foram recarregados. Confira e tente novamente.'
                      : result.error === 'network'
                        ? 'Não foi possível comunicar com o servidor. Nenhuma versão foi criada; os dados foram mantidos.'
                        : result.error === 'forbidden' && result.reason
                          ? denialMessage(result.reason, 'Operação não autorizada.')
                          : 'Revise os dados do ato formal. Nenhuma versão foi criada.',
                }
              }}
            />
          ) : null}

          <VersionHistory
            versions={versions}
            currentId={currentId}
            selectedId={plan.id}
            viewerUid={context.uid}
            onSelect={selectVersion}
            onCompare={(before, after) => setComparison({ before, after })}
          />
          {creation && !creatingVersion ? (
            creation.allowed ? (
              <span className={styles.touch}>
                <button type="button" className={ds.primary} onClick={() => { setNotice(null); setCreatingVersion(true) }}>
                  Registrar alteração formal
                </button>
              </span>
            ) : creation.reason !== 'permission-not-granted' ? (
              <p className={`${ds.info} ${styles.iconNote}`} role="note">
                <InfoIcon />
                <span>{denialMessage(creation.reason, '')}</span>
              </p>
            ) : null
          ) : null}
          {comparison ? (
            <VersionComparison oscId={context.oscId} partnershipId={partnershipId} versions={versions} beforeId={comparison.before} afterId={comparison.after} onChange={(before, after) => setComparison({ before, after })} onClose={() => setComparison(null)} />
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
                <dd>{displayValue(plan.values[f.id], f.kind)}</dd>
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
