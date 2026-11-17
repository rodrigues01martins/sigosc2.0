import type {
  CommercialStatus,
  OrganizationErrorKind,
  RegistrationStatus,
  SelectionErrorKind,
  UnselectableReason,
} from '../../services/organizations/types.ts'

export const REGISTRATION_LABEL: Record<RegistrationStatus, string> = {
  pending: 'Pendente de ativação',
  active: 'Ativa',
  suspended: 'Suspensa',
  inactive: 'Inativa',
}

export const COMMERCIAL_LABEL: Record<CommercialStatus, string> = {
  pending: 'Pendente',
  active: 'Regular',
  suspended: 'Suspensa',
  cancelled: 'Cancelada',
}

export const UNSELECTABLE_LABEL: Record<UnselectableReason, string> = {
  'membership-inactive': 'Vínculo inativo — não pode ser selecionada.',
  'organization-not-active': 'OSC ainda não ativada pela administração da plataforma.',
  'organization-unavailable': 'Dados da OSC indisponíveis no momento.',
}

export const LOAD_ERROR_MESSAGE: Record<OrganizationErrorKind, string> = {
  'permission-denied':
    'Não foi possível consultar seus vínculos: o acesso foi negado pelas regras de segurança deste ambiente.',
  network: 'Falha de conexão ao consultar seus vínculos. Verifique sua internet e tente novamente.',
  'not-configured': 'A consulta de vínculos ainda não está configurada neste ambiente.',
  unknown: 'Não foi possível consultar seus vínculos agora. Tente novamente.',
}

export const SELECTION_ERROR_MESSAGE: Record<SelectionErrorKind, string> = {
  ...LOAD_ERROR_MESSAGE,
  'permission-denied': 'Não foi possível confirmar o vínculo: acesso negado pelas regras de segurança.',
  'not-selectable': 'Esta OSC não pode ser selecionada com o vínculo atual.',
  'not-found': 'O vínculo com esta OSC não foi encontrado.',
}

export const NO_MEMBERSHIP_MESSAGE =
  'Você ainda não possui vínculo organizacional autorizado. O acesso a uma OSC é concedido pela administração da plataforma ou pelo administrador da própria OSC. Em caso de dúvida, procure o responsável pela sua organização.'
