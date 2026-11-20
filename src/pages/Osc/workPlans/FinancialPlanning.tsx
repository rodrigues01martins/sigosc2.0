import { useEffect, useRef, useState } from 'react'
import ds from '../../../components/ds/ds.module.css'
import { InfoIcon } from '../../../components/ds/icons.tsx'
import type { AuthorizationContext } from '../../../domain/authorization.ts'
import type { InstrumentId } from '../../../domain/partnerships.ts'
import { FUNDING_SOURCES, STANDARD_CATEGORIES, finLabel, financialApplicability, itemWarnings, plannedTotals, type FinErrors, type FinancialCategoryData, type FinancialItemData } from '../../../domain/workPlanFinancial.ts'
import { denialMessage, versionLabel } from '../../../domain/workPlanVersions.ts'
import { useMediaQuery } from '../../../hooks/useMediaQuery.ts'
import { useWorkPlanDependencies } from '../../../hooks/workPlansContext.ts'
import type { FinancialRecord, PlanFinancial, WorkPlan } from '../../../services/workPlans/types.ts'
import styles from '../partnerships/Partnerships.module.css'
import { PARTNERSHIP_LOAD_ERROR } from '../partnerships/format.ts'
import { CategoryFormCard, ItemFormCard, type FinSubmitResult } from './FinancialForms.tsx'
import { formatCents, nextFinancialCode, showMoney, showQty, showText } from './financialForm.ts'

type State = { status: 'loading' } | { status: 'error'; text: string } | { status: 'ready'; data: PlanFinancial }
type Editing = { kind: 'category'; record: FinancialRecord<FinancialCategoryData> | null } | { kind: 'item'; record: FinancialRecord<FinancialItemData> | null; presetCategory: string | null } | null

interface Props {
  context: AuthorizationContext
  partnershipId: string
  plan: WorkPlan
  instrument: InstrumentId
  /** Versão em cadastramento + `work-plan.edit` (decidido pela página). */
  canEdit: boolean
  editDenial: string | null
  onNotice(n: { kind: 'success' | 'error'; text: string }): void
}

/**
 * Planejamento financeiro PREVISTO da versão exibida (DEV-02.5; HF-G05: "Item F1", "Valor previsto";
 * PAG-OSC09: modelo híbrido). Somente valores previstos: sem receitas, despesas, saldos ou
 * comparativos com o realizado (Gestão Financeira, PAG-OSC09, é módulo futuro).
 */
export function FinancialPlanning({ context, partnershipId, plan, instrument, canEdit, editDenial, onNotice }: Props) {
  const { service, api } = useWorkPlanDependencies()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState<Editing>(null)
  const requestId = useRef(globalThis.crypto.randomUUID())
  // Telas estreitas: itens em cartões (tabela de 4–5 colunas não cabe em 320 px sem espremer a descrição).
  const compact = useMediaQuery('(max-width: 719px)')
  const applicable = financialApplicability(instrument) === 'applicable'
  const label = versionLabel(plan.sequence)

  useEffect(() => {
    if (!applicable) return
    let alive = true
    void service.listFinancial(context.oscId, partnershipId, plan.id).then((r) => {
      if (alive) setState(r.ok ? { status: 'ready', data: r.data } : { status: 'error', text: PARTNERSHIP_LOAD_ERROR[r.error] })
    })
    return () => {
      alive = false
    }
  }, [service, context.oscId, partnershipId, plan.id, plan.revision, applicable, attempt])

  if (!applicable) {
    return (
      <section className={ds.card} aria-labelledby="osc05-financeiro">
        <h2 id="osc05-financeiro" className={ds.sectionTitle}>
          Planejamento financeiro previsto
        </h2>
        <p className={ds.muted}>Não se aplica: Acordo de Cooperação, sem transferência de recursos financeiros. Nenhum valor é registrado (não há repasse igual a zero).</p>
      </section>
    )
  }

  const reload = () => setAttempt((n) => n + 1)
  const data = state.status === 'ready' ? state.data : null
  const categories = data?.categories ?? []
  const items = data?.items ?? []
  const totals = data ? plannedTotals(categories, items) : null
  const activeCategories = categories.filter((c) => c.data.status === 'active')
  const discontinued = [...categories.filter((c) => c.data.status === 'discontinued'), ...items.filter((i) => i.data.status === 'discontinued')]
  const catLabel = (id: string) => {
    const c = categories.find((x) => x.id === id)
    return c ? `${c.data.code} · ${c.data.name}` : '—'
  }

  async function save(kind: 'category' | 'item', record: FinancialRecord<FinancialCategoryData | FinancialItemData> | null, payload: FinancialCategoryData | FinancialItemData): Promise<FinSubmitResult> {
    const k = kind === 'category' ? ('financial-category' as const) : ('financial-item' as const)
    const base = { oscId: context.oscId, partnershipId, workPlanId: plan.id, requestId: requestId.current, kind: k, data: payload }
    const result = record ? await api.updateFinancial({ ...base, id: record.id, expectedRevision: record.revision }) : await api.createFinancial(base)
    if (result.ok) {
      requestId.current = globalThis.crypto.randomUUID()
      setEditing(null)
      onNotice({ kind: 'success', text: `${kind === 'category' ? 'Categoria' : 'Item'} ${payload.code} ${record ? 'atualizad' : 'registrad'}${kind === 'category' ? 'a' : 'o'} e confirmad${kind === 'category' ? 'a' : 'o'} pelo servidor.` })
      reload()
      return { ok: true }
    }
    if (result.error === 'stale') reload()
    if (result.error !== 'network' && result.error !== 'invalid-financial') requestId.current = globalThis.crypto.randomUUID()
    return {
      ok: false,
      fields: result.error === 'invalid-financial' ? (result.fields as FinErrors) : undefined,
      message:
        result.error === 'stale'
          ? 'O registro foi alterado por outra pessoa; os dados foram recarregados. Revise e salve novamente.'
          : result.error === 'network'
            ? 'Não foi possível comunicar com o servidor. Nada foi gravado; os dados foram mantidos.'
            : result.error === 'forbidden' && result.reason
              ? denialMessage(result.reason, 'Operação não autorizada.')
              : result.error === 'invalid-financial'
                ? 'Revise os campos indicados. Nada foi gravado.'
                : 'Não foi possível gravar. Nada foi alterado.',
    }
  }

  const button = (text: string, aria: string, onClick: () => void, primary = false) =>
    canEdit && editing === null ? (
      <span className={styles.touch}>
        <button type="button" className={primary ? ds.primary : ds.secondary} aria-label={aria} onClick={onClick}>
          {text}
        </button>
      </span>
    ) : null

  const form =
    editing === null ? null : editing.kind === 'category' ? (
      <CategoryFormCard
        key={editing.record?.id ?? 'new-cat'}
        initial={editing.record?.data ?? null}
        suggestedCode={nextFinancialCode('C', categories.map((c) => c.data.code))}
        order={editing.record?.data.order ?? categories.length}
        versionLabel={label}
        onCancel={() => setEditing(null)}
        onSubmit={(d) => save('category', editing.record, d)}
      />
    ) : (
      <ItemFormCard
        key={editing.record?.id ?? 'new-item'}
        initial={editing.record?.data ?? null}
        suggestedCode={nextFinancialCode('F', items.map((i) => i.data.code))}
        order={editing.record?.data.order ?? items.length}
        versionLabel={label}
        categories={categories.map((c) => ({ id: c.id, label: `${c.data.code} · ${c.data.name}`, status: c.data.status }))}
        presetCategory={editing.presetCategory}
        onCancel={() => setEditing(null)}
        onSubmit={(d) => save('item', editing.record, d)}
      />
    )

  const totalText = (t: { informedCents: number; pendingItems: number }) => `${formatCents(t.informedCents)}${t.pendingItems ? ` (parcial: ${t.pendingItems} ${t.pendingItems === 1 ? 'item sem valor informado' : 'itens sem valor informado'})` : ''}`

  return (
    <section className={ds.card} aria-labelledby="osc05-financeiro" aria-busy={state.status === 'loading'}>
      <div className={styles.listHeader} style={{ padding: 0 }}>
        <h2 id="osc05-financeiro" className={ds.sectionTitle}>
          Planejamento financeiro previsto
        </h2>
        {totals ? <span className={`${ds.badge} ${styles.situation}`}>Total previsto: {totalText(totals.total)}</span> : null}
      </div>
      <p className={styles.hint}>Valores previstos no Plano aprovado (modelo híbrido: categorias padronizadas e itens do Plano). Receitas, despesas e saldos pertencem à Gestão Financeira.</p>
      {state.status === 'loading' ? (
        <p className={ds.muted} role="status">
          Consultando o planejamento financeiro…
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
          {categories.length + items.length === 0 ? (
            <p className={`${ds.info} ${styles.iconNote}`} role="note">
              <InfoIcon />
              <span>
                {plan.registrationStatus === 'finalized'
                  ? denialMessage('financial-transcription-pending', '')
                  : canEdit
                    ? 'Nenhuma categoria ou item registrado nesta versão. Registre o planejamento financeiro como consta do Plano aprovado.'
                    : 'Nenhuma categoria ou item registrado nesta versão.'}
              </span>
            </p>
          ) : null}
          {activeCategories.map((c) => {
            const catItems = items.filter((i) => i.data.categoryId === c.id && i.data.status === 'active')
            const sub = totals?.byCategory.find((b) => b.categoryId === c.id)
            const warnings = catItems.flatMap((i) => itemWarnings(i.data).map((w) => `${i.data.code}: ${w}`))
            return (
              <article key={c.id} className={ds.stack} aria-labelledby={`fin-${c.id}`} style={{ borderTop: '1px solid var(--ds-border-subtle)', paddingTop: 12 }}>
                <div className={styles.cardRow} style={{ justifyContent: 'space-between' }}>
                  <h3 id={`fin-${c.id}`} className={ds.cardTitle} style={{ margin: 0 }}>
                    {c.data.code} · {c.data.name}
                  </h3>
                  <span className={`${ds.badge} ${styles.situation}`}>{c.data.standardCategory ? finLabel(STANDARD_CATEGORIES, c.data.standardCategory) : 'Classificação própria do Plano'}</span>
                </div>
                {catItems.length && compact ? (
                  <ul aria-label={`Itens previstos da categoria ${c.data.name}`} style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                    {catItems.map((i) => (
                      <li key={i.id} className={styles.card} style={{ paddingLeft: 0, paddingRight: 0 }}>
                        <div className={styles.cardRow} style={{ justifyContent: 'space-between' }}>
                          <strong>{i.data.code}</strong>
                          <strong style={{ overflowWrap: 'anywhere' }}>{showMoney(i.data.plannedValue)}</strong>
                        </div>
                        <span style={{ overflowWrap: 'anywhere' }}>{i.data.description}</span>
                        <span className={styles.detail}>
                          {i.data.quantity.state === 'not-informed' && i.data.unitValue.state === 'not-informed'
                            ? 'Valor global'
                            : `${showQty(i.data.quantity)}${i.data.unit.state === 'informed' ? ` ${i.data.unit.value}` : ''} × ${showMoney(i.data.unitValue)}`}
                          {i.data.fundingSource ? ` · Fonte prevista: ${finLabel(FUNDING_SOURCES, i.data.fundingSource)}` : ''}
                        </span>
                        {i.data.calculationMemory.state === 'informed' ? <span className={styles.detail}>Memória de cálculo: {showText(i.data.calculationMemory)}</span> : null}
                        {button('Editar', `Editar item ${i.data.code}`, () => setEditing({ kind: 'item', record: i, presetCategory: null }))}
                      </li>
                    ))}
                    <li className={styles.card} style={{ paddingLeft: 0, paddingRight: 0, fontWeight: 600 }}>
                      Subtotal previsto da categoria: {sub ? totalText(sub) : '—'}
                    </li>
                  </ul>
                ) : catItems.length ? (
                  <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={`Itens previstos da categoria ${c.data.code}`}>
                    <table className={styles.table} style={{ minWidth: 0 }}>
                      <caption className={ds.srOnly}>Itens previstos da categoria {c.data.name}</caption>
                      <thead>
                        <tr>
                          <th scope="col">Item</th>
                          <th scope="col">Descrição</th>
                          <th scope="col">Quantidade × valor unitário</th>
                          <th scope="col">Valor previsto</th>
                          {canEdit ? <th scope="col">Ação</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {catItems.map((i) => (
                          <tr key={i.id}>
                            <th scope="row">{i.data.code}</th>
                            <td style={{ overflowWrap: 'anywhere' }}>
                              {i.data.description}
                              {i.data.fundingSource ? <span className={styles.detail}>Fonte prevista: {finLabel(FUNDING_SOURCES, i.data.fundingSource)}</span> : null}
                              {i.data.calculationMemory.state === 'informed' ? <span className={styles.detail}>Memória de cálculo: {showText(i.data.calculationMemory)}</span> : null}
                            </td>
                            <td>
                              {i.data.quantity.state === 'not-informed' && i.data.unitValue.state === 'not-informed'
                                ? 'Valor global'
                                : `${showQty(i.data.quantity)}${i.data.unit.state === 'informed' ? ` ${i.data.unit.value}` : ''} × ${showMoney(i.data.unitValue)}`}
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>{showMoney(i.data.plannedValue)}</td>
                            {canEdit ? <td>{button('Editar', `Editar item ${i.data.code}`, () => setEditing({ kind: 'item', record: i, presetCategory: null }))}</td> : null}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th scope="row" colSpan={3}>
                            Subtotal previsto da categoria
                          </th>
                          <td style={{ whiteSpace: 'nowrap' }}>{sub ? totalText(sub) : '—'}</td>
                          {canEdit ? <td /> : null}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <p className={ds.muted} style={{ margin: 0 }}>
                    Nenhum item previsto nesta categoria.
                  </p>
                )}
                {warnings.length ? (
                  <ul aria-label={`Pontos de atenção da categoria ${c.data.code}`} className={styles.fieldWarning} style={{ margin: 0, paddingLeft: 20 }}>
                    {warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : null}
                <div className={`${styles.actions} ${styles.touch}`}>
                  {button('Adicionar item', `Adicionar item à categoria ${c.data.code}`, () => setEditing({ kind: 'item', record: null, presetCategory: c.id }))}
                  {button('Editar categoria', `Editar categoria ${c.data.code}`, () => setEditing({ kind: 'category', record: c }))}
                </div>
              </article>
            )
          })}
          {totals && totals.total.itemCount > 0 ? (
            <p style={{ margin: 0, fontWeight: 600 }}>
              Total previsto do Plano ({label.toLowerCase()}): {totalText(totals.total)}
            </p>
          ) : null}
          {discontinued.length ? (
            <details>
              <summary className={styles.touch} style={{ cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                Descontinuados nesta versão ({discontinued.length})
              </summary>
              <ul aria-label="Registros financeiros descontinuados nesta versão" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {discontinued.map((d) => (
                  <li key={d.id} className={styles.card} style={{ paddingLeft: 0, paddingRight: 0 }}>
                    <span>
                      {d.kind === 'financial-category' ? `Categoria ${d.data.code} — ${(d.data as FinancialCategoryData).name}` : `Item ${d.data.code} — ${(d.data as FinancialItemData).description} (${catLabel((d.data as FinancialItemData).categoryId)})`}
                    </span>
                    {button('Editar', `Editar ${d.kind === 'financial-category' ? 'categoria' : 'item'} ${d.data.code}`, () =>
                      setEditing(d.kind === 'financial-category' ? { kind: 'category', record: d as FinancialRecord<FinancialCategoryData> } : { kind: 'item', record: d as FinancialRecord<FinancialItemData>, presetCategory: null }),
                    )}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {canEdit && editing === null ? (
            <div className={`${styles.actions} ${styles.touch}`}>
              <button type="button" className={ds.primary} onClick={() => setEditing({ kind: 'category', record: null })}>
                Adicionar categoria
              </button>
              {activeCategories.length ? (
                <button type="button" className={ds.secondary} onClick={() => setEditing({ kind: 'item', record: null, presetCategory: null })}>
                  Adicionar item previsto
                </button>
              ) : null}
            </div>
          ) : null}
          {!canEdit && editDenial && plan.registrationStatus === 'in-registration' ? <p className={ds.muted}>{editDenial}</p> : null}
          {form}
        </>
      )}
    </section>
  )
}
