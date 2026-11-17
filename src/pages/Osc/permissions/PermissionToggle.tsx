import { CheckIcon, LockIcon, MinusIcon } from '../../../components/ds/icons.tsx'
import ds from '../../../components/ds/ds.module.css'
import type { MutationAction } from '../../../services/permissions/permissionsApi.ts'
import type { CellModel } from './cellModel.ts'
import { BLOCK_REASON } from './messages.ts'
import styles from './PermissionMatrix.module.css'

interface Props {
  model: CellModel
  /** Nome acessível: permissão — usuário (identifica linha e coluna). */
  label: string
  pending: MutationAction | undefined
  failed: boolean
  onToggle(): void
}

/**
 * Célula de permissão operacional (UX-001): um clique concede ou revoga.
 * O estado exibido é sempre o último CONFIRMADO pelo servidor; durante o
 * processamento a célula fica desabilitada e o estado não muda.
 */
export function PermissionToggle({ model, label, pending, failed, onToggle }: Props) {
  const stateText = model.granted ? 'Concedida' : 'Não concedida'

  if (model.blockedBy) {
    const reason = BLOCK_REASON[model.blockedBy] ?? { short: 'Bloqueada', long: 'alteração não autorizada' }
    return (
      <span className={styles.blocked}>
        <span className={`${styles.blockedState} ${model.granted ? styles.blockedGranted : styles.blockedNot}`}>
          {model.granted ? <CheckIcon /> : <MinusIcon />}
          {stateText}
        </span>
        <span className={styles.blockedReason}>
          <LockIcon size={12} />
          {reason.short}
        </span>
        <span className={ds.srOnly}>{`${label}: ${stateText}; bloqueada — ${reason.long}.`}</span>
      </span>
    )
  }

  // O MESMO botão em todos os estados: o foco não se perde durante o processamento.
  // `aria-disabled` (e não `disabled`) mantém o foco; o hook impede duplicidade.
  const visible = pending ? (pending === 'grant-permission' ? 'Concedendo…' : 'Revogando…') : stateText
  return (
    <>
      <button
        type="button"
        className={pending ? styles.processing : model.granted ? styles.granted : styles.notGranted}
        aria-pressed={model.granted}
        aria-disabled={pending ? 'true' : undefined}
        aria-busy={pending ? 'true' : undefined}
        // Nome acessível: permissão — usuário (linha e coluna) + o texto visível (WCAG 2.5.3).
        aria-label={`${label}: ${visible}`}
        title={pending ? undefined : model.granted ? 'Clique para revogar' : 'Clique para conceder'}
        onClick={pending ? undefined : onToggle}
      >
        {pending ? <span className={styles.spinner} aria-hidden="true" /> : model.granted ? <CheckIcon /> : <MinusIcon />}
        {visible}
      </button>
      {failed && !pending ? <span className={styles.failed}>Não alterada — tente novamente</span> : null}
    </>
  )
}

interface DelegationProps {
  model: CellModel
  who: string
  pending: MutationAction | undefined
  failed: boolean
  onRequest(): void
}

/** Delegação: competência administrativa, separada e sempre com confirmação. */
export function DelegationControl({ model, who, pending, failed, onRequest }: DelegationProps) {
  const stateText = model.granted ? 'Delegado' : 'Sem delegação'
  if (model.blockedBy) {
    const reason = BLOCK_REASON[model.blockedBy] ?? { short: 'Bloqueada', long: 'alteração não autorizada' }
    return (
      <span className={styles.blocked}>
        <span className={`${styles.blockedState} ${styles.blockedNot}`}>{stateText}</span>
        <span className={styles.blockedReason}>
          <LockIcon size={12} />
          {reason.short}
        </span>
        <span className={ds.srOnly}>{`Delegação de ${who}: ${stateText}; bloqueada — ${reason.long}.`}</span>
      </span>
    )
  }
  return (
    <>
      <span className={styles.delegationState}>{stateText}</span>
      <button
        type="button"
        className={styles.delegation}
        disabled={pending !== undefined}
        aria-busy={pending ? 'true' : undefined}
        aria-label={model.granted ? `Revogar delegação de ${who}` : `Conceder delegação a ${who}`}
        onClick={onRequest}
      >
        {pending ? <span className={styles.spinner} aria-hidden="true" /> : null}
        {model.granted ? 'Revogar delegação' : 'Conceder delegação'}
      </button>
      {failed ? <span className={styles.failed}>Não alterada — tente novamente</span> : null}
    </>
  )
}
