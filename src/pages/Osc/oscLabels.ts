import type { Authority } from '../../domain/authorization.ts'
import type { CommercialStatus } from '../../services/organizations/types.ts'

/** Vocabulário do protótipo homologado (PAG-OSC01/03) para a competência do usuário. */
export const AUTHORITY_LABEL: Record<Authority, string> = {
  administrator: 'Administrador único',
  delegate: 'Delegado',
  member: 'Operacional',
}

/** status.commercial.* — rótulos do DS-05 (Regular, Suspensa, Não ativada). */
export const COMMERCIAL_BADGE_LABEL: Record<CommercialStatus, string> = {
  active: 'Regular',
  suspended: 'Suspensa',
  pending: 'Não ativada',
  cancelled: 'Cancelada',
}

export const PAGE_META = {
  identificacao: { title: 'Identificação da OSC', description: 'Dados da organização selecionada.' },
  parcerias: { title: 'Parcerias', description: 'Localização, seleção e cadastro autorizado.' },
  parceria: { title: 'Identificação da Parceria', description: 'Consulta das informações de identificação, situação e vigência da parceria.' },
  plano: { title: 'Plano de Trabalho', description: 'Consulta e cadastro estruturado do Plano de Trabalho aprovado.' },
  usuarios: { title: 'Usuários e Permissões', description: 'Administração de vínculos e permissões no nível da OSC' },
} as const
