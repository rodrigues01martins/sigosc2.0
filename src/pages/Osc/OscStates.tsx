import { LayersIcon, LockIcon } from '../../components/ds/icons.tsx'
import ds from '../../components/ds/ds.module.css'
import type { Membership } from '../../services/organizations/types.ts'
import { NO_MEMBERSHIP_MESSAGE, UNSELECTABLE_LABEL } from '../Organizations/labels.ts'

/** DSC-DAT-06 — sem OSC escolhida (vários vínculos), conforme HF-G05. */
export function SelectOscPrompt() {
  return (
    <section className={ds.empty} aria-labelledby="estado-selecao">
      <span className={ds.emptyIcon}>
        <LayersIcon size={32} />
      </span>
      <div className={ds.stack}>
        <h2 id="estado-selecao" className={ds.cardTitle}>
          Selecione uma OSC para continuar
        </h2>
        <p className={ds.muted}>
          Você está vinculado a mais de uma organização. Escolha a OSC no menu lateral; o contexto e as permissões
          apresentados serão exclusivamente os da OSC escolhida.
        </p>
      </div>
    </section>
  )
}

/** Sem vínculo autorizado (U03). Orientação institucional, sem cadastro público. */
export function NoMembershipState() {
  return (
    <section className={ds.empty} aria-labelledby="estado-sem-vinculo">
      <span className={ds.emptyIcon}>
        <LayersIcon size={32} />
      </span>
      <div className={ds.stack}>
        <h2 id="estado-sem-vinculo" className={ds.cardTitle}>
          Nenhum vínculo organizacional autorizado
        </h2>
        <p className={ds.muted}>{NO_MEMBERSHIP_MESSAGE}</p>
      </div>
    </section>
  )
}

/** Vínculos existentes, porém nenhum selecionável (U04: inativo / OSC indisponível). */
export function NoSelectableState({ memberships }: { memberships: readonly Membership[] }) {
  return (
    <section className={ds.empty} aria-labelledby="estado-sem-acesso">
      <span className={ds.emptyIcon}>
        <LockIcon size={28} />
      </span>
      <div className={ds.stack}>
        <h2 id="estado-sem-acesso" className={ds.cardTitle}>
          Nenhuma OSC disponível para seleção
        </h2>
        <p className={ds.muted}>Seus vínculos existentes não permitem acesso no momento:</p>
        <ul className={ds.stack} aria-label="Vínculos sem acesso" style={{ margin: 0, paddingLeft: 20 }}>
          {memberships.map((m) => (
            <li key={m.oscId}>
              {m.organization?.name ?? `Identificador: ${m.oscId}`} — {m.unselectableReason ? UNSELECTABLE_LABEL[m.unselectableReason] : 'Indisponível.'}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** DSC-FBK-06 — acesso bloqueado por suspensão comercial (delegados e operacionais). */
export function SuspensionBlocked({ oscName }: { oscName: string }) {
  return (
    <section className={ds.card} role="alert" aria-labelledby="estado-bloqueio">
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <span
          aria-hidden="true"
          style={{ flex: '0 0 40px', width: 40, height: 40, borderRadius: 999, background: '#17363E', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <LockIcon />
        </span>
        <div className={ds.stack}>
          <h2 id="estado-bloqueio" className={ds.sectionTitle}>
            Acesso bloqueado: assinatura suspensa
          </h2>
          <p className={ds.muted}>
            A assinatura da {oscName} está comercialmente suspensa. Durante a suspensão, apenas o administrador único da
            OSC mantém consulta e exportação. Seus vínculos e permissões nesta OSC foram preservados e voltam a valer com
            a reativação; seus vínculos com outras OSCs não são afetados.
          </p>
          <span><span className={ds.commercialSuspended}>OSC · Suspensa</span></span>
        </div>
      </div>
    </section>
  )
}

/** DSC-FBK-07 — somente consulta para o administrador durante a suspensão. */
export function SuspensionReadOnly() {
  return (
    <p className={ds.readOnly} role="status">
      <span>
        <strong>Assinatura suspensa.</strong> Como administrador único, você mantém consulta e exportação. A criação e a
        alteração de registros operacionais ficam indisponíveis até a reativação comercial.
      </span>
    </p>
  )
}
