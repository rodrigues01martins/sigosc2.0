import { permissionLabel, type DenialReason, type GrantablePermissionId } from '../../../domain/authorization.ts'
import type { MutationAction, PermissionsApiError } from '../../../services/permissions/permissionsApi.ts'

/**
 * Mensagens da matriz de permissões (UX-001). Objetivas e seguras: nunca expõem
 * tokens, identificadores internos ou mensagens do SDK.
 */
export const SUSPENSION_MESSAGE =
  'As alterações de permissões estão bloqueadas porque a OSC está com a situação comercial suspensa.'

const FORBIDDEN_MESSAGE: Partial<Record<DenialReason, string>> = {
  'commercial-suspension': SUSPENSION_MESSAGE,
  'target-not-active': 'O vínculo deste usuário está inativo; a permissão não pode ser concedida.',
  'target-not-member': 'Este usuário não possui mais vínculo com esta OSC. A lista foi atualizada.',
  'membership-inactive': 'Seu vínculo com esta OSC está inativo. A lista foi atualizada.',
  'not-administrator': 'Somente o administrador único da OSC pode conceder ou revogar delegação.',
}

/** Mensagem de falha de uma alteração (a permissão NÃO foi alterada). */
export function mutationErrorMessage(error: PermissionsApiError, reason: DenialReason | undefined, delegation: boolean): string {
  const subject = delegation ? 'A delegação' : 'A permissão'
  switch (error) {
    case 'network':
      return `Não foi possível comunicar com o servidor. ${subject} não foi alterada. Tente novamente.`
    case 'session-expired':
      return 'Sua sessão expirou. Entre novamente para continuar.'
    case 'forbidden':
      return (reason && FORBIDDEN_MESSAGE[reason]) ?? 'Você não possui autorização para alterar as permissões deste usuário.'
    case 'unavailable':
      return `A gestão de permissões está indisponível neste ambiente. ${subject} não foi alterada.`
    default:
      return `Não foi possível concluir a operação. ${subject} não foi alterada. Tente novamente.`
  }
}

/** Mensagem de falha da consulta da relação de usuários. */
export function loadErrorMessage(error: PermissionsApiError, reason: DenialReason | undefined): string {
  switch (error) {
    case 'network':
      return 'Não foi possível comunicar com o servidor para consultar os usuários. Tente novamente.'
    case 'session-expired':
      return 'Sua sessão expirou. Entre novamente para continuar.'
    case 'forbidden':
      return reason === 'commercial-suspension'
        ? 'A consulta de usuários está bloqueada durante a suspensão comercial; somente o administrador único mantém a consulta.'
        : 'Você não possui autorização para consultar os usuários e permissões desta OSC.'
    case 'unavailable':
      return 'A consulta de usuários e permissões está temporariamente indisponível neste ambiente.'
    default:
      return 'Não foi possível consultar os usuários e permissões agora. Tente novamente.'
  }
}

export function successMessage(action: MutationAction, who: string, permission: GrantablePermissionId | undefined, changed: boolean): string {
  if (!changed) return `Nenhuma alteração necessária para ${who}: a situação já estava registrada.`
  const perm = permission ? `“${permissionLabel(permission)}”` : ''
  switch (action) {
    case 'grant-permission':
      return `Permissão ${perm} concedida a ${who}.`
    case 'revoke-permission':
      return `Permissão ${perm} revogada de ${who}.`
    case 'grant-delegation':
      return `Delegação para gestão de permissões concedida a ${who}.`
    case 'revoke-delegation':
      return `Delegação para gestão de permissões revogada de ${who}.`
  }
}

/** Motivos de bloqueio exibidos na célula (texto curto + descrição acessível). */
export const BLOCK_REASON: Partial<Record<DenialReason, { short: string; long: string }>> = {
  'self-modification': { short: 'Próprio usuário', long: 'não é permitido alterar as próprias permissões' },
  'target-is-administrator': { short: 'Administrador', long: 'as permissões do administrador único não podem ser alteradas por delegado' },
  'target-not-active': { short: 'Vínculo inativo', long: 'vínculo inativo não recebe novas permissões' },
  'commercial-suspension': { short: 'Somente consulta', long: 'alterações bloqueadas pela suspensão comercial' },
  'not-authorized': { short: 'Sem autorização', long: 'sem competência para alterar esta permissão' },
  'not-administrator': { short: 'Sem autorização', long: 'somente o administrador único altera a delegação' },
}
