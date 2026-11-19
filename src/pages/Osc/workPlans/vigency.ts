/**
 * Textos de vigência cadastral e de produção de efeitos (DEC-PT-003/005) — puros, sem React.
 * Vigência no SIGOSC é CADASTRAL; a produção de efeitos administrativos segue a data DECLARADA no
 * ato (nunca presumida). Nenhum texto afirma aprovação ou validação jurídica.
 */
import { effectsStatus, versionLabel, type ActivationStatus } from '../../../domain/workPlanVersions.ts'
import styles from '../partnerships/Partnerships.module.css'
import { formatDate, formatTimestamp } from '../partnerships/format.ts'
import type { WorkPlan } from '../../../services/workPlans/types.ts'

export const VIGENCY_BADGE: Record<ActivationStatus, string | undefined> = {
  'in-registration': styles.vigencyDraft,
  'original-current': styles.vigencyCurrent,
  active: styles.vigencyCurrent,
  superseded: styles.vigencySuperseded,
  'legacy-pending': styles.vigencySuperseded,
}

const label = (id: string | null, versions: readonly WorkPlan[]) => {
  const v = versions.find((x) => x.id === id)
  return v ? versionLabel(v.sequence) : 'versão seguinte'
}

/** Mensagem principal de vigência da versão exibida (null quando não há o que acrescentar). */
export function vigencyNotice(plan: WorkPlan, status: ActivationStatus, versions: readonly WorkPlan[], today: string): { kind: 'info' | 'warning'; text: string } | null {
  if (plan.sequence === 1 && status !== 'superseded') return null
  const effective = plan.formalAct?.effectiveDate ?? null
  switch (status) {
    case 'active': {
      const effects = effectsStatus(effective, today)
      if (effects === 'future')
        return { kind: 'warning', text: `Versão vigente no SIGOSC desde sua finalização interna. A alteração formal possui início de efeitos administrativos previsto para ${formatDate(effective as string)}.` }
      if (effects === 'not-informed') return { kind: 'info', text: 'Versão vigente no SIGOSC. Data de produção de efeitos administrativos não informada.' }
      return { kind: 'info', text: `Versão vigente no SIGOSC desde sua finalização interna. Data de produção de efeitos informada no ato: ${formatDate(effective as string)}.` }
    }
    case 'in-registration':
      return { kind: 'info', text: 'Versão em cadastramento. Ao ser finalizada, passará a ser a vigente no SIGOSC e a versão atual ficará registrada como substituída, preservada para consulta.' }
    case 'superseded':
      return {
        kind: 'info',
        text: `Versão substituída no SIGOSC${plan.activation.supersededAt ? ` em ${formatTimestamp(plan.activation.supersededAt)}` : ''} pela ${label(plan.activation.supersededByWorkPlanId, versions)}. Permanece preservada para consulta; a substituição cadastral não significa revogação jurídica.`,
      }
    case 'legacy-pending':
      return { kind: 'warning', text: 'Versão finalizada antes da regra de ativação automática (DEC-PT-003) e não ativada: não é a vigente no SIGOSC. A regularização depende de procedimento administrativo.' }
    default:
      return null
  }
}

/** Selo de efeitos futuros no histórico (somente versão vigente ou substituída com data declarada futura). */
export function futureEffectsLabel(plan: WorkPlan, today: string): string | null {
  const effective = plan.formalAct?.effectiveDate ?? null
  if (plan.sequence === 1 || plan.registrationStatus !== 'finalized' || effectsStatus(effective, today) !== 'future') return null
  return `Efeitos administrativos a partir de ${formatDate(effective as string)}`
}
