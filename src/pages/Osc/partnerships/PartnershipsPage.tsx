import { useDeferredValue, useId, useMemo, useState } from 'react'
import { InfoIcon, LayersIcon, LockIcon, PlusIcon, SearchIcon } from '../../../components/ds/icons.tsx'
import ds from '../../../components/ds/ds.module.css'
import { ContextBar } from '../../../components/osc/ContextBar.tsx'
import { DENIAL_MESSAGE, evaluate, type AuthorizationContext } from '../../../domain/authorization.ts'
import {
  CONSULT_PERMISSION,
  REGISTRATION_MESSAGE,
  decidePartnershipRegistration,
  normalizeForSearch,
  partnershipTitle,
} from '../../../domain/partnerships.ts'
import { useMediaQuery } from '../../../hooks/useMediaQuery.ts'
import type { Partnership } from '../../../services/partnerships/types.ts'
import { PARTNERSHIP_LOAD_ERROR, formatTerm } from './format.ts'
import { PartnershipForm } from './PartnershipForm.tsx'
import { PartnershipStatus } from './PartnershipStatus.tsx'
import styles from './Partnerships.module.css'
import { usePartnershipList } from './usePartnershipList.ts'

const COMPACT_QUERY = '(max-width: 719px)'

interface Props {
  context: AuthorizationContext
  oscName: string
  partnershipLabel: string
  selectedId: string | null
  /** Seleção com UM clique: estabelece o contexto e abre a Identificação da Parceria. */
  onSelect(partnership: Partnership): void
  onCreated(partnershipId: string): void
}

function searchableText(p: Partnership): string {
  return normalizeForSearch(`${partnershipTitle(p)} ${p.instrumentNumber} ${p.object} ${p.publicPartner} ${p.administrativeProcess ?? ''}`)
}

/**
 * PAG-OSC02 — Parcerias (DEV-02.1). Consulta, pesquisa e seleção das parcerias
 * formalizadas da OSC ativa (layout HF-G05). A consulta exige `partnerships.view`
 * (Security Rules); o cadastro aparece somente se autorizado — hoje, bloqueado
 * por especificação pendente, sem botão inoperante.
 */
export function PartnershipsPage(props: Props) {
  const { context, oscName, partnershipLabel } = props
  const consult = evaluate(context, { kind: 'consult', permission: CONSULT_PERMISSION })

  if (!consult.allowed) {
    const message =
      consult.reason === 'permission-not-granted'
        ? 'Você não possui a permissão “Consultar parcerias da OSC”. Solicite-a ao administrador da OSC ou a um delegado.'
        : DENIAL_MESSAGE[consult.reason]
    return (
      <>
        <ContextBar oscName={oscName} partnership={partnershipLabel} />
        <section className={ds.empty} aria-labelledby="osc02-sem-acesso">
          <span className={ds.emptyIcon}>
            <LockIcon size={28} />
          </span>
          <div className={ds.stack}>
            <h2 id="osc02-sem-acesso" className={ds.cardTitle}>
              Consulta de parcerias não autorizada
            </h2>
            <p className={ds.muted}>{message}</p>
          </div>
        </section>
      </>
    )
  }
  return <AuthorizedPartnerships {...props} />
}

function AuthorizedPartnerships({ context, oscName, partnershipLabel, selectedId, onSelect, onCreated }: Props) {
  const { state, retry, loadMore } = usePartnershipList(context.oscId)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [formOpen, setFormOpen] = useState(false)
  const compact = useMediaQuery(COMPACT_QUERY)
  const searchId = useId()
  const registration = decidePartnershipRegistration(context)

  const items = useMemo(() => (state.status === 'ready' ? state.items : []), [state])
  const indexed = useMemo(() => items.map((p) => ({ p, text: searchableText(p) })), [items])
  const terms = normalizeForSearch(deferredQuery).split(' ').filter(Boolean)
  const visible = terms.length === 0 ? items : indexed.filter(({ text }) => terms.every((t) => text.includes(t))).map(({ p }) => p)

  const registrationArea = registration.allowed ? (
    <button type="button" className={ds.highlight} aria-expanded={formOpen} onClick={() => setFormOpen((open) => !open)}>
      <PlusIcon />
      Cadastrar parceria
    </button>
  ) : (
    <p className={registration.reason === 'commercial-suspension' ? ds.warning : ds.info} role="note">
      <InfoIcon />
      <span>{REGISTRATION_MESSAGE[registration.reason] ?? DENIAL_MESSAGE[registration.reason as keyof typeof DENIAL_MESSAGE]}</span>
    </p>
  )

  return (
    <>
      <ContextBar oscName={oscName} partnership={partnershipLabel} />

      <section className={ds.cardFlush} aria-label="Pesquisa de parcerias">
        <div className={styles.toolbar}>
          <div className={styles.search}>
            <label className={ds.fieldLabel} htmlFor={searchId}>
              Localizar parcerias
            </label>
            <div className={styles.searchBox}>
              <span className={styles.searchIcon}>
                <SearchIcon />
              </span>
              <input
                id={searchId}
                type="search"
                className={styles.searchInput}
                value={query}
                placeholder="Pesquisar por instrumento, identificação ou objeto"
                autoComplete="off"
                disabled={state.status !== 'ready'}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
          <div className={styles.registration}>{registrationArea}</div>
        </div>
      </section>

      {registration.allowed && formOpen ? (
        <PartnershipForm oscId={context.oscId} onCancel={() => setFormOpen(false)} onCreated={onCreated} />
      ) : null}

      <section className={ds.cardFlush} aria-labelledby="osc02-lista" aria-busy={state.status === 'loading'}>
        <div className={styles.listHeader}>
          <h2 id="osc02-lista" className={ds.sectionTitle}>
            Parcerias formalizadas
          </h2>
          {state.status === 'ready' && items.length > 0 ? (
            <p className={styles.count} role="status">
              {terms.length > 0
                ? `${visible.length} de ${items.length} ${items.length === 1 ? 'parceria' : 'parcerias'}${state.next !== null ? ' carregadas' : ''}`
                : `${items.length} ${items.length === 1 ? 'parceria' : 'parcerias'}${state.next !== null ? ' carregadas' : ''}`}
            </p>
          ) : null}
        </div>

        {state.status === 'loading' ? (
          <div className={styles.inner}>
            <p className={ds.muted} role="status">
              Consultando parcerias…
            </p>
          </div>
        ) : state.status === 'error' ? (
          <div className={styles.inner}>
            <div className={ds.stack}>
              <p className={ds.error} role="alert">
                {PARTNERSHIP_LOAD_ERROR[state.error]}
              </p>
              <span>
                <button type="button" className={ds.secondary} onClick={retry}>
                  Tentar novamente
                </button>
              </span>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className={styles.inner}>
            <div className={ds.empty}>
              <span className={ds.emptyIcon}>
                <LayersIcon size={32} />
              </span>
              <div className={ds.stack}>
                <h3 className={ds.cardTitle}>Nenhuma parceria foi cadastrada para esta OSC.</h3>
                <p className={ds.muted}>As parcerias formalizadas cadastradas aparecerão aqui para consulta e seleção.</p>
              </div>
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className={styles.inner}>
            <p className={ds.info} role="status">
              <InfoIcon />
              <span>Nenhuma parceria corresponde à pesquisa. Revise os termos utilizados.</span>
            </p>
          </div>
        ) : compact ? (
          <ul className={styles.cards} aria-label="Parcerias formalizadas">
            {visible.map((p) => (
              <li key={p.id} className={`${styles.card} ${p.id === selectedId ? styles.selected : ''}`}>
                <span className={styles.name}>{partnershipTitle(p)}</span>
                <span className={styles.detail}>{p.object}</span>
                <span className={styles.detail}>{p.publicPartner}</span>
                <div className={styles.cardRow}>
                  <span>
                    <span className={ds.srOnly}>Vigência: </span>
                    {formatTerm(p.termStart, p.termEnd)}
                  </span>
                  <PartnershipStatus status={p.administrativeStatus} />
                </div>
                <SelectButton partnership={p} selected={p.id === selectedId} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <caption className={ds.srOnly}>Parcerias formalizadas de {oscName}</caption>
              <thead>
                <tr>
                  <th scope="col">Parceria / instrumento</th>
                  <th scope="col">Vigência</th>
                  <th scope="col">Situação</th>
                  <th scope="col" className={styles.access}>
                    Acesso
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id} className={p.id === selectedId ? styles.selected : undefined}>
                    <th scope="row">
                      <span className={styles.name}>{partnershipTitle(p)}</span>
                      <span className={styles.detail}>
                        {p.object} · {p.publicPartner}
                      </span>
                    </th>
                    <td className={styles.term}>{formatTerm(p.termStart, p.termEnd)}</td>
                    <td>
                      <PartnershipStatus status={p.administrativeStatus} />
                    </td>
                    <td>
                      <SelectButton partnership={p} selected={p.id === selectedId} onSelect={onSelect} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {state.status === 'ready' && state.next !== null ? (
          <div className={styles.more}>
            {terms.length > 0 ? <p className={styles.count}>A pesquisa considera somente as parcerias já carregadas.</p> : null}
            {state.moreError ? (
              <p className={ds.error} role="alert">
                {PARTNERSHIP_LOAD_ERROR[state.moreError]}
              </p>
            ) : null}
            <button type="button" className={ds.secondary} onClick={() => void loadMore()} disabled={state.loadingMore} aria-busy={state.loadingMore}>
              {state.loadingMore ? 'Carregando…' : 'Carregar mais parcerias'}
            </button>
          </div>
        ) : null}
      </section>

      <p className={ds.info}>
        <InfoIcon />
        <span>Somente parcerias da OSC selecionada. Ações dependem das permissões.</span>
      </p>
    </>
  )
}

function SelectButton({ partnership, selected, onSelect }: { partnership: Partnership; selected: boolean; onSelect(p: Partnership): void }) {
  return (
    <button
      type="button"
      className={styles.selectButton}
      aria-current={selected ? 'true' : undefined}
      aria-label={`${selected ? 'Selecionada' : 'Selecionar'}: ${partnershipTitle(partnership)}`}
      onClick={() => onSelect(partnership)}
    >
      {selected ? 'Selecionada' : 'Selecionar'}
    </button>
  )
}
