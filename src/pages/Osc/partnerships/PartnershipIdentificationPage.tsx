import { useEffect, useRef, useState } from 'react'
import { InfoIcon, LockIcon } from '../../../components/ds/icons.tsx'
import ds from '../../../components/ds/ds.module.css'
import { ContextBar } from '../../../components/osc/ContextBar.tsx'
import { DENIAL_MESSAGE, evaluate, type AuthorizationContext } from '../../../domain/authorization.ts'
import { CONSULT_PERMISSION, hasFinancialTransfer, instrumentOf, partnershipTitle } from '../../../domain/partnerships.ts'
import { usePartnershipDependencies } from '../../../hooks/partnershipsContext.ts'
import type { Partnership, PartnershipErrorKind } from '../../../services/partnerships/types.ts'
import { PARTNERSHIP_LOAD_ERROR, formatDate, formatMoney, formatTerm, formatTimestamp } from './format.ts'
import { PartnershipStatus } from './PartnershipStatus.tsx'
import styles from './Partnerships.module.css'

interface Props {
  context: AuthorizationContext
  oscName: string
  partnershipId: string
  partnershipLabel: string
  /** Confirmação da parceria (pertencente à OSC ativa) para o contexto de trabalho. */
  onResolved(partnership: Partnership): void
  /** A parceria não existe nesta OSC (ou o identificador é inválido): o contexto é limpo. */
  onNotFound(): void
  onBack(): void
}

type State =
  | { status: 'loading' }
  | { status: 'error'; error: PartnershipErrorKind }
  | { status: 'not-found' }
  | { status: 'ready'; partnership: Partnership }

/**
 * PAG-OSC04 — Identificação da Parceria, SOMENTE CONSULTA (DEV-02.1).
 * Mínimo necessário para consultar a identificação após a seleção (NV-1: PAG-OSC02 →
 * PAG-OSC04 direto). Abas "Dados Complementares" e "Situação e Histórico", prorrogação,
 * arquivamento e alterações do HF-G05 NÃO foram implementados (sem botões inoperantes).
 * O identificador da URL é SEMPRE consultado sob a OSC ativa: parceria de outra OSC
 * não é encontrada (caminho) e é negada pelas Security Rules.
 */
export function PartnershipIdentificationPage(props: Props) {
  const consult = evaluate(props.context, { kind: 'consult', permission: CONSULT_PERMISSION })
  if (!consult.allowed) {
    return (
      <>
        <ContextBar oscName={props.oscName} partnership={props.partnershipLabel} />
        <section className={ds.empty} aria-labelledby="osc04-sem-acesso">
          <span className={ds.emptyIcon}>
            <LockIcon size={28} />
          </span>
          <div className={ds.stack}>
            <h2 id="osc04-sem-acesso" className={ds.cardTitle}>
              Consulta de parcerias não autorizada
            </h2>
            <p className={ds.muted}>
              {consult.reason === 'permission-not-granted'
                ? 'Você não possui a permissão “Consultar parcerias da OSC”.'
                : DENIAL_MESSAGE[consult.reason]}
            </p>
          </div>
        </section>
      </>
    )
  }
  return <Identification {...props} />
}

function Identification({ context, oscName, partnershipId, partnershipLabel, onResolved, onNotFound, onBack }: Props) {
  const { service } = usePartnershipDependencies()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const callbacks = useRef({ onResolved, onNotFound })
  useEffect(() => {
    callbacks.current = { onResolved, onNotFound }
  })

  useEffect(() => {
    let alive = true
    void service.get(context.oscId, partnershipId).then((result) => {
      if (!alive) return
      if (!result.ok) {
        // Negação pelas regras é tratada como "não encontrada nesta OSC" (sem revelar existência).
        if (result.error === 'permission-denied') {
          setState({ status: 'not-found' })
          callbacks.current.onNotFound()
        } else setState({ status: 'error', error: result.error })
      } else if (result.data === null) {
        setState({ status: 'not-found' })
        callbacks.current.onNotFound()
      } else {
        setState({ status: 'ready', partnership: result.data })
        callbacks.current.onResolved(result.data)
      }
    })
    return () => {
      alive = false
    }
  }, [context.oscId, partnershipId, service, attempt])

  const back = (
    <span>
      <button type="button" className={ds.secondary} onClick={onBack}>
        Voltar às parcerias
      </button>
    </span>
  )

  if (state.status !== 'ready') {
    return (
      <>
        <ContextBar oscName={oscName} partnership={partnershipLabel} />
        {state.status === 'loading' ? (
          <p className={ds.muted} role="status">
            Consultando a parceria…
          </p>
        ) : state.status === 'not-found' ? (
          <section className={ds.card} aria-labelledby="osc04-nao-encontrada">
            <h2 id="osc04-nao-encontrada" className={ds.sectionTitle}>
              Parceria não encontrada nesta OSC
            </h2>
            <p className={ds.muted}>
              A parceria indicada não pertence à OSC selecionada ou não está disponível para consulta. Selecione uma parceria na lista.
            </p>
            {back}
          </section>
        ) : (
          <div className={ds.stack}>
            <p className={ds.error} role="alert">
              {PARTNERSHIP_LOAD_ERROR[state.error]}
            </p>
            <span>
              <button type="button" className={ds.secondary} onClick={() => { setState({ status: 'loading' }); setAttempt((n) => n + 1) }}>
                Tentar novamente
              </button>
            </span>
          </div>
        )}
      </>
    )
  }

  const p = state.partnership
  const instrument = instrumentOf(p.instrument)
  return (
    <>
      <ContextBar oscName={oscName} partnership={partnershipLabel} />

      <section className={ds.card} aria-labelledby="osc04-dados">
        <div className={ds.stack}>
          <h2 id="osc04-dados" className={ds.sectionTitle}>
            {partnershipTitle(p)}
          </h2>
          <p className={ds.muted}>Dados da parceria</p>
        </div>
        <dl className={styles.dl}>
          <div>
            <dt>Número da parceria</dt>
            <dd>{p.instrumentNumber}</dd>
          </div>
          <div>
            <dt>Instrumento MROSC</dt>
            <dd>{instrument.label}</dd>
          </div>
          <div>
            <dt>Órgão ou entidade pública parceira</dt>
            <dd>{p.publicPartner}</dd>
          </div>
          <div>
            <dt>Processo administrativo</dt>
            <dd>{p.administrativeProcess ?? 'Não informado'}</dd>
          </div>
          <div className={styles.wide}>
            <dt>Objeto</dt>
            <dd>{p.object}</dd>
          </div>
        </dl>
      </section>

      <section className={ds.card} aria-labelledby="osc04-situacao">
        <h2 id="osc04-situacao" className={ds.sectionTitle}>
          Situação e período
        </h2>
        <dl className={styles.dl}>
          <div>
            <dt>Situação da parceria (administrativa)</dt>
            <dd>
              <PartnershipStatus status={p.administrativeStatus} />
            </dd>
          </div>
          <div>
            <dt>Data de formalização</dt>
            <dd>{formatDate(p.formalizationDate)}</dd>
          </div>
          <div>
            <dt>Período de vigência</dt>
            <dd>{formatTerm(p.termStart, p.termEnd)}</dd>
          </div>
          <div>
            <dt>Prorrogações</dt>
            <dd>Nenhuma prorrogação registrada.</dd>
          </div>
        </dl>
        <p className={ds.info}>
          <InfoIcon />
          <span>
            A situação administrativa da parceria não se confunde com a situação comercial da OSC, apresentada na Identificação da
            OSC.
          </span>
        </p>
      </section>

      <section className={ds.card} aria-labelledby="osc04-instrumento">
        <h2 id="osc04-instrumento" className={ds.sectionTitle}>
          Informações do instrumento
        </h2>
        <dl className={styles.dl}>
          <div>
            <dt>Valor global</dt>
            <dd>
              {hasFinancialTransfer(p.instrument)
                ? p.globalValueCents !== null
                  ? formatMoney(p.globalValueCents)
                  : 'Não informado'
                : 'Não se aplica: Acordo de Cooperação, sem transferência de recursos financeiros.'}
            </dd>
          </div>
          <div>
            <dt>Plano de Trabalho aprovado</dt>
            <dd>
              {p.workPlanApprovalDeclared
                ? 'Aprovação declarada no cadastro. Documento ainda não incorporado ao SIGOSC; sem conferência documental.'
                : 'Não informado.'}
            </dd>
          </div>
          <div>
            <dt>Cadastro no SIGOSC</dt>
            <dd>
              {formatTimestamp(p.createdAt)}
              {p.createdBy && p.createdBy === context.uid ? ' · por você' : ''}
            </dd>
          </div>
          <div>
            <dt>Última alteração no SIGOSC</dt>
            <dd>{formatTimestamp(p.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <p className={ds.info}>
        <InfoIcon />
        <span>
          Consulta da identificação. Demais abas e ações da Identificação da Parceria (prorrogação, alterações formais e
          arquivamento) aguardam implementação.
        </span>
      </p>
    </>
  )
}
