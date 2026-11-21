import { useRef, useState } from 'react'
import ds from '../../../components/ds/ds.module.css'
import { InfoIcon } from '../../../components/ds/icons.tsx'
import type { AuthorizationContext } from '../../../domain/authorization.ts'
import { FINANCIAL_CLOSE_DECLARATION, FINANCIAL_TRANSCRIPTION_DECLARATION, financialPending, financialToken, formatCents, plannedTotals } from '../../../domain/workPlanFinancial.ts'
import { denialMessage } from '../../../domain/workPlanVersions.ts'
import { useWorkPlanDependencies } from '../../../hooks/workPlansContext.ts'
import type { PlanFinancial, WorkPlan } from '../../../services/workPlans/types.ts'
import styles from '../partnerships/Partnerships.module.css'
import { formatTimestamp } from '../partnerships/format.ts'

interface Props {
  context: AuthorizationContext
  partnershipId: string
  plan: WorkPlan
  /** Versão vigente e nenhuma versão em cadastramento (cadeia íntegra). */
  eligibleVersion: boolean
  /** Instrumento com transferência de recursos. */
  applicable: boolean
  /** `work-plan.edit`, parceria não arquivada e OSC sem suspensão comercial. */
  canOperate: boolean
  financial: PlanFinancial | null
  onNotice(n: { kind: 'success' | 'error' | 'warning'; text: string }): void
  onChanged(): void
}

/**
 * Incorporação FINANCEIRA complementar excepcional (DEC-PT-011): transcrição de categorias e itens do
 * planejamento aprovado em versão vigente já finalizada e sem planejamento estruturado. Procedimento
 * próprio, independente da incorporação de metas e indicadores (DEC-PT-006); não é alteração formal,
 * não cria versão e não toca a finalização original. Abertura e encerramento são ações explícitas.
 */
export function FinancialTranscriptionPanel({ context, partnershipId, plan, eligibleVersion, applicable, canOperate, financial, onNotice, onChanged }: Props) {
  const { api } = useWorkPlanDependencies()
  const [opening, setOpening] = useState(false)
  const [declared, setDeclared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<readonly string[]>([])
  const requestId = useRef(globalThis.crypto.randomUUID())
  const t = plan.financialTranscription
  if (plan.registrationStatus !== 'finalized' || !applicable) return null
  const who = (uid: string | null) => (uid && uid === context.uid ? 'você' : 'usuário autorizado da OSC')

  if (t?.status === 'closed') {
    return (
      <p className={`${ds.info} ${styles.iconNote}`} role="note">
        <InfoIcon />
        <span>
          Incorporação financeira concluída em {formatTimestamp(t.closedAt)} por {who(t.closedBy)}. Planejamento transcrito do Plano aprovado, sem alteração formal; a finalização original
          permanece e os registros ficam somente para consulta.
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
        ? await api.openFinancialTranscription(base)
        : await api.closeFinancialTranscription({ ...base, expectedTranscriptionRevision: t?.revision ?? 1, financialToken: financialToken(financial?.categories ?? [], financial?.items ?? []) })
    setBusy(false)
    if (result.ok) {
      requestId.current = globalThis.crypto.randomUUID()
      setDeclared(false)
      setOpening(false)
      onNotice({
        kind: 'success',
        text: kind === 'open' ? 'Incorporação financeira iniciada. Registre as categorias e os itens do Plano aprovado; o progresso é salvo a cada gravação.' : 'Incorporação financeira concluída. Planejamento preservado; nenhuma versão formal foi criada.',
      })
      onChanged()
      return
    }
    if (result.error !== 'network') requestId.current = globalThis.crypto.randomUUID()
    if ((result.error === 'forbidden' && result.reason === 'financial-changed') || result.error === 'stale') onChanged()
    setFailure(
      result.error === 'finalization-pending' && result.pending
        ? result.pending
        : [result.error === 'forbidden' && result.reason ? denialMessage(result.reason, 'Operação não autorizada.') : result.error === 'network' ? 'Não foi possível comunicar com o servidor. Nada foi gravado.' : result.error === 'stale' ? 'A incorporação foi alterada por outra pessoa; os dados foram recarregados.' : 'Não foi possível concluir a operação. Nada foi alterado.'],
    )
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
    const pending = financial ? financialPending(financial.categories, financial.items) : ['Consultando o planejamento financeiro…']
    const totals = financial ? plannedTotals(financial.categories, financial.items).total : null
    return (
      <section className={ds.card} aria-labelledby="osc05-incorporacao-financeira">
        <h2 id="osc05-incorporacao-financeira" className={ds.sectionTitle}>
          Incorporação financeira em andamento
        </h2>
        <p className={ds.muted}>
          Iniciada em {formatTimestamp(t.openedAt)} por {who(t.openedBy)}. Cada categoria ou item gravado fica salvo; a incorporação pode ser retomada por usuário autorizado. O Plano permanece finalizado e
          nenhuma versão formal é criada.
        </p>
        {financial && totals ? (
          <p className={ds.muted} role="status">
            Progresso: {financial.categories.length} {financial.categories.length === 1 ? 'categoria' : 'categorias'} · {totals.itemCount} {totals.itemCount === 1 ? 'item ativo' : 'itens ativos'} · total previsto{' '}
            {formatCents(totals.informedCents)}
            {totals.pendingItems ? ` (${totals.pendingItems} sem valor)` : ''}.
          </p>
        ) : null}
        {canOperate ? (
          <>
            <h3 className={ds.cardTitle} style={{ margin: 0 }}>
              Encerrar a incorporação financeira
            </h3>
            {pending.length ? (
              <ul aria-label="Pendências do encerramento financeiro" style={{ margin: 0, paddingLeft: 20 }}>
                {pending.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              <p className={ds.muted}>Todos os itens ativos têm valor previsto informado.</p>
            )}
            {declaration(FINANCIAL_CLOSE_DECLARATION)}
            {failureBox}
            <span className={styles.touch}>
              <button type="button" className={ds.primary} disabled={busy || pending.length > 0 || !declared} aria-busy={busy} onClick={() => void run('close')}>
                {busy ? 'Encerrando…' : 'Encerrar incorporação financeira'}
              </button>
            </span>
          </>
        ) : null}
      </section>
    )
  }

  const empty = financial !== null && financial.categories.length + financial.items.length === 0
  if (!eligibleVersion || !canOperate || !empty) return null
  return (
    <section className={ds.card} aria-labelledby="osc05-incorporar-financeiro">
      <h2 id="osc05-incorporar-financeiro" className={ds.sectionTitle}>
        Planejamento financeiro do Plano aprovado
      </h2>
      <p className={ds.muted}>
        Esta versão foi finalizada sem planejamento financeiro estruturado. Se ele consta do Plano aprovado, pode ser transcrito por incorporação financeira excepcional: a operação não altera
        juridicamente o Plano e não cria versão formal.
      </p>
      {opening ? (
        <>
          {declaration(FINANCIAL_TRANSCRIPTION_DECLARATION)}
          {failureBox}
          <div className={`${styles.actions} ${styles.touch}`}>
            <button type="button" className={ds.primary} disabled={busy || !declared} aria-busy={busy} onClick={() => void run('open')}>
              {busy ? 'Iniciando…' : 'Iniciar incorporação financeira'}
            </button>
            <button type="button" className={ds.linkButton} disabled={busy} onClick={() => { setOpening(false); setDeclared(false); setFailure([]) }}>
              Cancelar
            </button>
          </div>
        </>
      ) : (
        <span className={styles.touch}>
          <button type="button" className={`${ds.secondary} ${styles.wrapButton}`} onClick={() => setOpening(true)}>
            Incorporar planejamento financeiro do Plano aprovado
          </button>
        </span>
      )}
    </section>
  )
}
