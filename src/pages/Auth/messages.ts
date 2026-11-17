import type { AuthErrorKind } from '../../services/auth/types.ts'

/**
 * Mensagens exibidas ao usuário. São genéricas de propósito: não revelam se um
 * e-mail está cadastrado nem expõem detalhes internos do Firebase.
 */
export const SIGN_IN_ERROR_MESSAGE: Record<AuthErrorKind, string> = {
  'invalid-email': 'Informe um e-mail em formato válido.',
  'missing-password': 'Informe a senha.',
  'invalid-credentials': 'E-mail ou senha incorretos.',
  'too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
  network: 'Falha de conexão. Verifique sua internet e tente novamente.',
  unavailable: 'Serviço de autenticação indisponível no momento. Tente novamente mais tarde.',
  unknown: 'Não foi possível entrar agora. Tente novamente.',
}

export const PASSWORD_RESET_ERROR_MESSAGE: Record<AuthErrorKind, string> = {
  ...SIGN_IN_ERROR_MESSAGE,
  'invalid-credentials': 'Não foi possível processar a solicitação agora. Tente novamente.',
  unknown: 'Não foi possível processar a solicitação agora. Tente novamente.',
}


export const PASSWORD_RESET_CONFIRMATION =
  'Se o e-mail informado estiver cadastrado, você receberá uma mensagem com as instruções para redefinir a senha. Verifique também a caixa de spam.'

export const PROVISIONAL_NOTICE = 'Interface técnica provisória — DEV-01.1'
