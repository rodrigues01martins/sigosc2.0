import { InfoIcon, LayersIcon, PlusIcon, SearchIcon } from '../../components/ds/icons.tsx'
import ds from '../../components/ds/ds.module.css'
import { ContextBar } from '../../components/osc/ContextBar.tsx'

/**
 * PAG-OSC02 — Parcerias: ESTRUTURA VISUAL somente (layout HF-G05).
 * O módulo de parcerias ainda não foi implementado: não há coleção, consulta,
 * cadastro, seleção nem simulação. Os controles previstos aparecem desabilitados
 * e identificados como aguardando implementação.
 */
export function PartnershipsPage({ oscName }: { oscName: string }) {
  return (
    <>
      <ContextBar oscName={oscName} />

      <section className={ds.card} aria-label="Pesquisa de parcerias" style={{ padding: '20px 24px', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div className={ds.field} style={{ flex: '1 1 320px', maxWidth: 640 }}>
          <label className={ds.fieldLabel} htmlFor="osc02-busca">
            Localizar parcerias
          </label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: 12, color: 'var(--ds-neutral-600)' }}>
              <SearchIcon />
            </span>
            <input
              id="osc02-busca"
              type="search"
              disabled
              placeholder="Pesquisar por instrumento ou identificação"
              aria-describedby="osc02-pendente"
              style={{ width: '100%', minHeight: 40, padding: '0 12px 0 38px', border: '1px solid var(--ds-neutral-500)', borderRadius: 8, background: 'var(--ds-neutral-100)', color: 'var(--ds-neutral-600)', font: 'inherit' }}
            />
          </div>
        </div>
        <button type="button" className={ds.highlight} disabled aria-describedby="osc02-pendente">
          <PlusIcon />
          Cadastrar parceria
        </button>
      </section>

      <section className={ds.cardFlush} aria-labelledby="osc02-lista">
        <h2 id="osc02-lista" className={ds.sectionTitle} style={{ padding: '16px 20px' }}>
          Parcerias formalizadas
        </h2>
        <div style={{ padding: '0 20px 20px' }}>
          <div className={ds.empty}>
            <span className={ds.emptyIcon}>
              <LayersIcon size={32} />
            </span>
            <div className={ds.stack}>
              <h3 className={ds.cardTitle}>Gestão de Parcerias ainda não disponível</h3>
              <p id="osc02-pendente" className={ds.muted}>
                O módulo de Gestão de Parcerias aguarda implementação. Nesta versão nenhuma parceria é consultada,
                cadastrada, selecionada ou alterada. Aguardam implementação: localizar parcerias, cadastrar parceria e
                selecionar uma parceria.
              </p>
            </div>
          </div>
        </div>
      </section>

      <p className={ds.info}>
        <InfoIcon />
        <span>Somente parcerias da OSC selecionada. Ações dependem das permissões.</span>
      </p>
    </>
  )
}
