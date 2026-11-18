/**
 * Catálogo de permissões e avaliação de autorização (DEV-01.3).
 *
 * Módulo de DOMÍNIO, puro e sem dependências: é usado tanto pela interface
 * (apenas para decidir o que exibir) quanto pelas operações de servidor
 * (`api/`), onde a decisão é aplicada com dados recém-lidos do Firestore.
 * Uma decisão favorável na interface NUNCA é suficiente: o servidor e as
 * Security Rules decidem de novo.
 *
 * Distinções do modelo:
 * 1. Identidade autenticada (uid)            → não concede nada sozinha.
 * 2. Vínculo ativo com a OSC                  → requisito de qualquer operação.
 * 3. Administrador único                      → `oscs/{oscId}.administratorUid` (fonte autoritativa).
 * 4. Delegação de gestão de permissões         → `members/{uid}.canManagePermissions` (concedida só pelo administrador).
 * 5. Permissões operacionais individuais       → `members/{uid}.permissions` (alcance: toda a OSC).
 * 6. Situação comercial                       → `suspended` bloqueia alterações e operação.
 */

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export const PERMISSION_MODULES = [
  { id: 'users', label: 'Gestão de usuários e permissões' },
  { id: 'partnerships', label: 'Gestão de parcerias' },
  { id: 'work-plan', label: 'Plano de Trabalho' },
  { id: 'execution', label: 'Execução e Monitoramento' },
  { id: 'financial', label: 'Gestão Financeira' },
  { id: 'documents', label: 'Gestão Documental' },
  { id: 'accountability', label: 'Prestação de Contas' },
] as const

export type PermissionModuleId = (typeof PERMISSION_MODULES)[number]['id']

/**
 * `grantable`: semântica determinada com segurança; pode ser concedida.
 * `pending-specification`: depende de especificação no Inventário Funcional V1.0;
 *   NÃO pode ser concedida nem verificada até ser especificada.
 * `discontinued`: identificador já existente que deixou de ser competência (ex.: DEC-PT-001).
 *   Permanece no catálogo apenas para documentação: não é concedível, é descartado na leitura
 *   dos vínculos (`sanitizePermissions`) e NUNCA autoriza operações. Valores já gravados não são
 *   convertidos nem apagados.
 */
export type PermissionStatus = 'grantable' | 'pending-specification' | 'discontinued'

interface CatalogEntry {
  readonly id: string
  readonly module: PermissionModuleId
  readonly label: string
  readonly status: PermissionStatus
}

/**
 * Catálogo inicial. Identificadores ESTÁVEIS (`modulo.capacidade`): uma vez
 * gravados em vínculos, nunca devem ser renomeados — apenas descontinuados.
 * Não existem identificadores genéricos (`admin`, `all`, `*`): administração e
 * delegação NÃO são permissões operacionais.
 */
export const PERMISSION_CATALOG = [
  // Gestão de usuários e permissões: gerir permissões é competência do
  // administrador/delegado, não permissão operacional. Convites ainda não especificados.
  { id: 'users.invite', module: 'users', label: 'Convidar usuários para a OSC', status: 'pending-specification' },

  // DEC-PAR-001 (DEV-02.1-C01): três competências independentes; nenhuma implica outra.
  // `partnerships.edit` mantém o identificador original, agora restrito à EDIÇÃO.
  { id: 'partnerships.view', module: 'partnerships', label: 'Consultar parcerias da OSC', status: 'grantable' },
  { id: 'partnerships.create', module: 'partnerships', label: 'Cadastrar parcerias formalizadas', status: 'grantable' },
  { id: 'partnerships.edit', module: 'partnerships', label: 'Alterar dados cadastrais de parcerias', status: 'grantable' },

  // DEC-PT-001 (DEV-02.2-C01, alternativa B): `work-plan.edit` é a competência ÚNICA para iniciar,
  // alterar, finalizar internamente e corrigir erro material (DEC-PT-002) do cadastro estruturado.
  // `view` e `edit` continuam independentes. `work-plan.finalize` foi DESCONTINUADA.
  { id: 'work-plan.view', module: 'work-plan', label: 'Consultar Planos de Trabalho', status: 'grantable' },
  { id: 'work-plan.edit', module: 'work-plan', label: 'Registrar, finalizar e corrigir o Plano de Trabalho', status: 'grantable' },
  { id: 'work-plan.finalize', module: 'work-plan', label: 'Finalizar internamente o cadastro do Plano de Trabalho (descontinuada)', status: 'discontinued' },

  { id: 'execution.view', module: 'execution', label: 'Consultar execução e monitoramento', status: 'grantable' },
  { id: 'execution.edit', module: 'execution', label: 'Registrar execução e monitoramento', status: 'pending-specification' },

  { id: 'financial.view', module: 'financial', label: 'Consultar gestão financeira', status: 'grantable' },
  { id: 'financial.edit', module: 'financial', label: 'Registrar movimentações financeiras', status: 'pending-specification' },

  { id: 'documents.view', module: 'documents', label: 'Consultar documentos', status: 'grantable' },
  { id: 'documents.edit', module: 'documents', label: 'Incluir e editar documentos', status: 'pending-specification' },

  { id: 'accountability.view', module: 'accountability', label: 'Consultar prestações de contas', status: 'grantable' },
  { id: 'accountability.edit', module: 'accountability', label: 'Elaborar prestações de contas', status: 'pending-specification' },
] as const satisfies readonly CatalogEntry[]

export type PermissionId = (typeof PERMISSION_CATALOG)[number]['id']

type GrantableEntry = Extract<(typeof PERMISSION_CATALOG)[number], { status: 'grantable' }>
export type GrantablePermissionId = GrantableEntry['id']

export const GRANTABLE_PERMISSIONS: readonly GrantablePermissionId[] = PERMISSION_CATALOG.filter(
  (entry): entry is GrantableEntry => entry.status === 'grantable',
).map((entry) => entry.id)

export function isGrantablePermission(value: unknown): value is GrantablePermissionId {
  return typeof value === 'string' && (GRANTABLE_PERMISSIONS as readonly string[]).includes(value)
}

export function permissionLabel(id: PermissionId): string {
  return PERMISSION_CATALOG.find((entry) => entry.id === id)?.label ?? id
}

/**
 * Normaliza a lista gravada no vínculo: mantém apenas identificadores concedíveis
 * do catálogo, sem repetição, em ordem estável. Valores desconhecidos, textos
 * livres ou tipos inválidos são DESCARTADOS (falha fechada). Documentos legados
 * sem o campo resultam em lista vazia.
 */
export function sanitizePermissions(value: unknown): GrantablePermissionId[] {
  if (!Array.isArray(value)) return []
  const granted = new Set(value.filter(isGrantablePermission))
  return GRANTABLE_PERMISSIONS.filter((id) => granted.has(id))
}

// ---------------------------------------------------------------------------
// Avaliação de autorização
// ---------------------------------------------------------------------------

export interface OrganizationFacts {
  readonly id: string
  readonly registrationStatus: string
  readonly commercialStatus: string
  readonly administratorUid: string | null
}

export interface MembershipFacts {
  readonly uid: string
  readonly status: 'active' | 'inactive'
  readonly permissions: readonly GrantablePermissionId[]
  readonly canManagePermissions: boolean
}

export interface AuthorizationContext {
  /** UID autenticado (verificado pelo servidor no ambiente confiável). */
  readonly uid: string | null
  /** OSC alvo da operação: toda decisão é vinculada a ela. */
  readonly oscId: string
  readonly organization: OrganizationFacts | null
  /** Vínculo do próprio solicitante na OSC alvo. */
  readonly membership: MembershipFacts | null
}

export type Operation =
  | { readonly kind: 'view-own-permissions' }
  | { readonly kind: 'list-members' }
  | { readonly kind: 'grant-permission' | 'revoke-permission'; readonly target: MembershipFacts | null; readonly permission: unknown }
  | { readonly kind: 'grant-delegation' | 'revoke-delegation'; readonly target: MembershipFacts | null }
  /** Operação futura de módulo (ex.: consultar parcerias), exige a permissão correspondente. */
  | { readonly kind: 'operate'; readonly permission: unknown }
  /**
   * DEV-02.1 — CONSULTA de módulo: exige a permissão individual (sem permissões implícitas).
   * Na suspensão comercial, somente o administrador único mantém a consulta (regra homologada
   * "AO: consultar/exportar"); para os demais, a suspensão bloqueia como em `operate`.
   */
  | { readonly kind: 'consult'; readonly permission: unknown }

export type Authority = 'administrator' | 'delegate' | 'member'

export type DenialReason =
  | 'not-authenticated'
  | 'no-membership'
  | 'organization-mismatch'
  | 'membership-inactive'
  | 'organization-not-active'
  | 'commercial-suspension'
  | 'not-authorized'
  | 'not-administrator'
  | 'invalid-permission'
  | 'permission-not-granted'
  | 'target-not-member'
  | 'target-not-active'
  | 'target-is-administrator'
  | 'self-modification'

export type Decision =
  | { readonly allowed: true; readonly authority: Authority }
  | { readonly allowed: false; readonly reason: DenialReason }

const deny = (reason: DenialReason): Decision => ({ allowed: false, reason })

export function isCommerciallySuspended(organization: OrganizationFacts): boolean {
  return organization.commercialStatus === 'suspended'
}

/** Autoridade do solicitante, considerando SOMENTE as fontes autoritativas. */
export function authorityOf(organization: OrganizationFacts, membership: MembershipFacts): Authority {
  if (organization.administratorUid !== null && organization.administratorUid === membership.uid) return 'administrator'
  if (membership.canManagePermissions === true) return 'delegate'
  return 'member'
}

/**
 * Avalia uma operação. Determinística e sem efeitos colaterais.
 * Ordem: identidade → vínculo → OSC → competência → situação comercial → alvo.
 */
export function evaluate(context: AuthorizationContext, operation: Operation): Decision {
  const { uid, oscId, organization, membership } = context
  if (!uid) return deny('not-authenticated')
  if (!organization || !membership || membership.uid !== uid) return deny('no-membership')
  if (organization.id !== oscId) return deny('organization-mismatch')
  if (membership.status !== 'active') return deny('membership-inactive')
  if (organization.registrationStatus !== 'active') return deny('organization-not-active')

  const authority = authorityOf(organization, membership)
  const suspended = isCommerciallySuspended(organization)

  switch (operation.kind) {
    case 'view-own-permissions':
      return { allowed: true, authority }

    case 'list-members':
      if (authority === 'member') return deny('not-authorized')
      // Na suspensão comercial, apenas o administrador mantém a consulta.
      if (suspended && authority !== 'administrator') return deny('commercial-suspension')
      return { allowed: true, authority }

    case 'operate':
      if (suspended) return deny('commercial-suspension')
      if (!isGrantablePermission(operation.permission)) return deny('invalid-permission')
      // O administrador NÃO possui permissões operacionais implícitas.
      if (!membership.permissions.includes(operation.permission)) return deny('permission-not-granted')
      return { allowed: true, authority }

    case 'consult':
      if (suspended && authority !== 'administrator') return deny('commercial-suspension')
      if (!isGrantablePermission(operation.permission)) return deny('invalid-permission')
      if (!membership.permissions.includes(operation.permission)) return deny('permission-not-granted')
      return { allowed: true, authority }

    case 'grant-permission':
    case 'revoke-permission': {
      if (authority === 'member') return deny('not-authorized')
      if (suspended) return deny('commercial-suspension')
      if (!isGrantablePermission(operation.permission)) return deny('invalid-permission')
      const { target } = operation
      if (!target) return deny('target-not-member')
      if (target.uid === uid) return deny('self-modification')
      // DEC-PAR-002: permissões operacionais do administrador único só pela Administração da
      // Plataforma (operação ainda não implementada) — nem ele próprio, nem delegado, nem terceiros.
      if (target.uid === organization.administratorUid) return deny('target-is-administrator')
      if (operation.kind === 'grant-permission' && target.status !== 'active') return deny('target-not-active')
      return { allowed: true, authority }
    }

    case 'grant-delegation':
    case 'revoke-delegation': {
      // Somente o administrador único concede ou revoga delegação (sem subdelegação).
      if (authority !== 'administrator') return deny('not-administrator')
      if (suspended) return deny('commercial-suspension')
      const { target } = operation
      if (!target) return deny('target-not-member')
      if (target.uid === uid) return deny('self-modification')
      if (operation.kind === 'grant-delegation' && target.status !== 'active') return deny('target-not-active')
      return { allowed: true, authority }
    }
  }
}

/** Mensagens compreensíveis para cada negação. */
export const DENIAL_MESSAGE: Record<DenialReason, string> = {
  'not-authenticated': 'Sessão não identificada. Entre novamente.',
  'no-membership': 'Você não possui vínculo com esta OSC.',
  'organization-mismatch': 'A operação não corresponde à OSC selecionada.',
  'membership-inactive': 'Seu vínculo com esta OSC está inativo.',
  'organization-not-active': 'A OSC não está ativa na plataforma.',
  'commercial-suspension': 'A OSC está com a situação comercial suspensa: alterações estão bloqueadas.',
  'not-authorized': 'Você não tem competência para gerir permissões nesta OSC.',
  'not-administrator': 'Somente o administrador da OSC pode conceder ou revogar delegação.',
  'invalid-permission': 'Permissão inexistente ou ainda não disponível para concessão.',
  'permission-not-granted': 'Permissão não concedida.',
  'target-not-member': 'O usuário não possui vínculo com esta OSC.',
  'target-not-active': 'O vínculo do usuário está inativo.',
  'target-is-administrator': 'As permissões operacionais do administrador único só podem ser alteradas pela Administração da Plataforma.',
  'self-modification': 'Não é permitido alterar as próprias permissões ou delegação.',
}
