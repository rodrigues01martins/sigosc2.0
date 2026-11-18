import type { ReactNode } from 'react'
import { RecordIcon, LayersIcon, UsersIcon } from '../../components/ds/icons.tsx'
import type { OscRoute } from '../../hooks/useOscRoute.ts'
import type { Membership } from '../../services/organizations/types.ts'
import styles from '../../layouts/OscShell.module.css'
import { PAGE_META } from './oscLabels.ts'

interface SelectorProps {
  memberships: readonly Membership[]
  activeOscId: string | null
  pendingOscId: string | null
  onSelect(oscId: string): void
}

/**
 * Bloco "OSC selecionada" (HF-G05): vínculo único → nome e seleção automática;
 * vários vínculos → escolha explícita. Lista apenas OSCs selecionáveis (vínculo
 * ativo e OSC ativa); os demais vínculos são apenas contabilizados.
 */
export function OscSelector({ memberships, activeOscId, pendingOscId, onSelect }: SelectorProps) {
  const selectable = memberships.filter((m) => m.selectable && m.organization)
  const blocked = memberships.length - selectable.length
  const blockedNote = blocked > 0 ? `${blocked} ${blocked === 1 ? 'vínculo sem acesso' : 'vínculos sem acesso'} (inativo ou OSC indisponível).` : null

  if (selectable.length === 0) {
    return (
      <div className={styles.block}>
        <span className={styles.blockLabel}>OSC selecionada</span>
        <span className={styles.blockValue}>Nenhuma OSC disponível</span>
        {blockedNote ? <span className={styles.blockLabel}>{blockedNote}</span> : null}
      </div>
    )
  }

  if (selectable.length === 1 && selectable[0]?.oscId === activeOscId) {
    return (
      <div className={styles.block}>
        <span className={styles.blockLabel}>OSC selecionada</span>
        <span className={styles.blockValue}>{selectable[0].organization?.name}</span>
        <span className={styles.blockLabel}>
          {memberships.length === 1 ? 'Vínculo único: selecionada automaticamente.' : 'Única OSC disponível: selecionada automaticamente.'}
        </span>
        {blockedNote ? <span className={styles.blockLabel}>{blockedNote}</span> : null}
      </div>
    )
  }

  return (
    <div className={styles.block}>
      <label className={styles.blockLabel} htmlFor="osc-selector">
        OSC selecionada
      </label>
      <select
        id="osc-selector"
        className={styles.select}
        value={pendingOscId ?? activeOscId ?? ''}
        disabled={pendingOscId !== null}
        aria-describedby="osc-selector-note"
        onChange={(event) => event.target.value && onSelect(event.target.value)}
      >
        <option value="" disabled>
          Selecione uma OSC
        </option>
        {selectable.map((m) => (
          <option key={m.oscId} value={m.oscId}>
            {m.organization?.name}
          </option>
        ))}
      </select>
      <span id="osc-selector-note" className={styles.blockLabel}>
        {pendingOscId ? 'Validando vínculo…' : `Vínculo com ${selectable.length} OSCs: a escolha é explícita.`}
        {blockedNote ? ` ${blockedNote}` : ''}
      </span>
    </div>
  )
}

interface NavigationProps {
  route: OscRoute
  canManagePermissions: boolean
  /** DEV-02.1: parceria selecionada (contexto de trabalho), se houver. */
  selectedPartnershipId?: string | null
  onNavigate(route: OscRoute, partnershipId?: string): void
}

const LABEL: Record<OscRoute, string> = {
  identificacao: PAGE_META.identificacao.title,
  parcerias: PAGE_META.parcerias.title,
  parceria: 'Identificação da parceria',
  usuarios: 'Usuários e permissões',
}

/**
 * Itens da Gestão da OSC; "Usuários e permissões" só para quem tem a competência.
 * Com uma parceria selecionada, "Identificação da parceria" leva a ela (contexto mantido).
 */
export function OscNavigation({ route, canManagePermissions, selectedPartnershipId = null, onNavigate }: NavigationProps) {
  const items: { route: OscRoute; icon: ReactNode }[] = [
    { route: 'identificacao', icon: <RecordIcon /> },
    { route: 'parcerias', icon: <LayersIcon /> },
    ...(selectedPartnershipId ? [{ route: 'parceria' as const, icon: <RecordIcon /> }] : []),
    ...(canManagePermissions ? [{ route: 'usuarios' as const, icon: <UsersIcon /> }] : []),
  ]
  return (
    <ul className={styles.navList}>
      {items.map((item) => (
        <li key={item.route}>
          <button
            type="button"
            className={styles.navItem}
            aria-current={route === item.route ? 'page' : undefined}
            onClick={() => onNavigate(item.route, item.route === 'parceria' ? (selectedPartnershipId ?? undefined) : undefined)}
          >
            {item.icon}
            <span>{LABEL[item.route]}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
