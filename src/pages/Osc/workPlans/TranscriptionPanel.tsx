import { useRef, useState } from 'react'
import ds from '../../../components/ds/ds.module.css'
import { InfoIcon } from '../../../components/ds/icons.tsx'
import type { AuthorizationContext } from '../../../domain/authorization.ts'
import { COMPONENTS_DECLARATION, TRANSCRIPTION_DECLARATION, checkComponentReview, componentsToken } from '../../../domain/workPlanComponents.ts'
import { denialMessage } from '../../../domain/workPlanVersions.ts'
import { useWorkPlanDependencies } from '../../../hooks/workPlansContext.ts'
import type { PlanComponents, WorkPlan } from '../../../services/workPlans/types.ts'
import styles from '../partnerships/Partnerships.module.css'
import { formatTimestamp } from '../partnerships/format.ts'
import { ComponentReviewFields } from './ComponentReviewFields.tsx'
import { emptyReview, reviewFromDraft, type ReviewDraft } from './componentForm.ts'

interface Props {
  context: AuthorizationContext
  partnershipId: string
  plan: WorkPlan
  /** A versão exibida é a vigente e não há versão em cadastramento (cadeia íntegra). */
  eligibleVersion: boolean
  /** `work-plan.edit`, parceria não arquivada e OSC sem suspensão comercial (decidido pela página). */
  canOperate: boolean
  components: PlanComponents | null
  onNotice(n: { kind: 'success' | 'error' | 'warning'; text: string }): void
  onChanged(): void
}

/**
 * Incorporação complementar EXCEPCIONAL (DEC-PT-006): transcrição de metas e indicadores
 * preexistentes no Plano aprovado, em versão vigente já finalizada e sem componentes. Não é
 * alteração formal, não cria versão e não toca a finalização original. Abertura e encerramento são
 * ações próprias, autorizadas pelo servidor; o progresso fica salvo e pode ser retomado.
 */
export function TranscriptionPanel({ context, partnershipId, plan, eligibleVersion, canOperate, components, onNotice, onChanged }: Props) {
  const { api } = useWorkPlanDependencies()
  const [opening, setOpening] = useState(false)
  const [declared, setDeclared] = useState(false)
  const [review, setReview] = useState<ReviewDraft>(emptyReview)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<readonly string[]>([])
  const requestId = useRef(globalThis.crypto.randomUUID())
  const t = plan.transcription
  if (plan.registrationStatus !== 'finalized') return null
  const total = components ? components.goals.length + components.indicators.length : null
  const who = (uid: string | null) => (uid && uid === context.uid ? 'você' : 'usuário autorizado da OSC')

  if (t?.status === 'closed') {
    return (
      <p className={`${ds.info} ${styles.iconNote}`} role="note">
        <InfoIcon />
        <span>
          Incorporação complementar de metas e indicadores encerrada em {formatTimestamp(t.closedAt)} por {who(t.closedBy)}. Componentes transcritos do Plano aprovado, sem alteração formal; a
          finalização original permanece.
        </span>
      </p>
    )
  }

  async function run(kind: 'open' | 'close') {
    if (busy) return
    setBusy(true)
    setFailure([])
    const base = { oscId: context.oscId, partnershipId, workPlanId: plan.id, requestId: requestId.current, declaration: declared }
    const result =
      kind === 'open'
        ? await api.openTranscription(base)
        : await api.closeTranscription({ ...base, expectedTranscriptionRevision: t?.revision ?? 1, review: reviewFromDraft(review), componentsToken: componentsToken([...(components?.goals ?? []), ...(components?.indicators ?? [])]) })
    setBusy(false)
    if (result.ok) {
      requestId.current = globalThis.crypto.randomUUID()
      setDeclared(false)
      setOpening(false)
      onNotice({
        kind: 'success',
        text: kind === 'open' ? 'Incorporação complementar iniciada. Registre as metas e os indicadores do Plano aprovado; o progresso é salvo a cada gravação.' : 'Incorporação complementar encerrada. Metas e indicadores preservados; nenhuma versão formal foi criada.',
      })
      onChanged()
      return
    }
    if (result.error !== 'network') requestId.current = globalThis.crypto.randomUUID()
    if (result.error === 'forbidden' && result.reason === 'components-changed') onChanged()
    setFailure(
      result.error === 'finalization-pending' && result.pending
        ? result.pending
        : [result.error === 'forbidden' && result.reason ? denialMessage(result.reason, 'Operação não autorizada.') : result.error === 'network' ? 'Não foi possível comunicar com o servidor. Nada foi gravado.' : result.error === 'stale' ? 'A incorporação foi alterada por outra pessoa; os dados foram recarregados.' : 'Não foi possível concluir a operação. Nada foi alterado.'],
    )
    if (result.error === 'stale') onChanged()
  }

  const failureBox = failure.length ? (
    <div className={ds.error} role="alert">
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {failure.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </div>
  ) : null
  const declaration = (text: string) => (
    <label className={styles.check}>
      <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
      <span>{text}</span>
    </label>
  )

  if (t?.status === 'open') {
    const pending = components ? checkComponentReview(reviewFromDraft(review), components.goals, components.indicators) : ['Consultando metas e indicadores…']
    const counts = { goals: components?.goals.filter((g) => g.data.status === 'active').length ?? 0, indicators: components?.indicators.filter((i) => i.data.status === 'active').length ?? 0 }
    return (
      <section className={ds.card} aria-labelledby="osc05-incorporacao">
        <h2 id="osc05-incorporacao" className={ds.sectionTitle}>
          Incorporação complementar em andamento
        </h2>
        <p className={ds.muted}>
          Iniciada em {formatTimestamp(t.openedAt)} por {who(t.openedBy)}. Cada meta ou indicador gravado fica salvo; a incorporação pode ser retomada por usuário autorizado. O Plano permanece finalizado e
          nenhuma versão formal é criada.
        </p>
        {canOperate ? (
          <>
            <h3 className={ds.cardTitle} style={{ margin: 0 }}>
              Encerrar a incorporação
            </h3>
            <ComponentReviewFields value={review} onChange={setReview} counts={counts} disabled={busy} />
            {pending.length ? (
              <ul aria-label="Pendências do encerramento" style={{ margin: 0, paddingLeft: 20 }}>
                {pending.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}
            {declaration(COMPONENTS_DECLARATION)}
            {failureBox}
            <span className={styles.touch}>
              <button type="button" className={ds.primary} disabled={busy || pending.length > 0 || !declared} aria-busy={busy} onClick={() => void run('close')}>
                {busy ? 'Encerrando…' : 'Encerrar incorporação'}
              </button>
            </span>
          </>
        ) : null}
      </section>
    )
  }

  if (!eligibleVersion || !canOperate || total !== 0) return null
  return (
    <section className={ds.card} aria-labelledby="osc05-incorporar">
      <h2 id="osc05-incorporar" className={ds.sectionTitle}>
        Metas e indicadores do Plano aprovado
      </h2>
      <p className={ds.muted}>
        Esta versão foi finalizada sem metas e indicadores estruturados. Se eles constam do Plano aprovado, podem ser transcritos por incorporação complementar: a operação não altera juridicamente o
        Plano e não cria versão formal.
      </p>
      {opening ? (
        <>
          {declaration(TRANSCRIPTION_DECLARATION)}
          {failureBox}
          <div className={`${styles.actions} ${styles.touch}`}>
            <button type="button" className={ds.primary} disabled={busy || !declared} aria-busy={busy} onClick={() => void run('open')}>
              {busy ? 'Iniciando…' : 'Iniciar incorporação'}
            </button>
            <button type="button" className={ds.linkButton} disabled={busy} onClick={() => { setOpening(false); setDeclared(false); setFailure([]) }}>
              Cancelar
            </button>
          </div>
        </>
      ) : (
        <span className={styles.touch}>
          <button type="button" className={`${ds.secondary} ${styles.wrapButton}`} onClick={() => setOpening(true)}>
            Incorporar metas e indicadores do Plano aprovado
          </button>
        </span>
      )}
    </section>
  )
}
