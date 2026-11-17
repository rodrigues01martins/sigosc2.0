/** Testes do catálogo e do avaliador de autorização (DEV-01.3) — `npm test`. Lógica pura. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GRANTABLE_PERMISSIONS,
  PERMISSION_CATALOG,
  PERMISSION_MODULES,
  evaluate,
  sanitizePermissions,
  type AuthorizationContext,
  type MembershipFacts,
  type OrganizationFacts,
} from './authorization.ts'

const osc: OrganizationFacts = { id: 'osc-a', registrationStatus: 'active', commercialStatus: 'active', administratorUid: 'admin' }
const member = (uid: string, extra: Partial<MembershipFacts> = {}): MembershipFacts => ({
  uid, status: 'active', permissions: [], canManagePermissions: false, ...extra,
})
const ctx = (m: MembershipFacts | null, o: OrganizationFacts | null = osc, uid = m?.uid ?? null): AuthorizationContext => ({
  uid, oscId: 'osc-a', organization: o, membership: m,
})

test('Catálogo: IDs estáveis, únicos, por módulo, sem identificadores genéricos', () => {
  const ids = PERMISSION_CATALOG.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length)
  const modules = new Set(PERMISSION_MODULES.map((m) => m.id))
  for (const entry of PERMISSION_CATALOG) {
    assert.match(entry.id, /^[a-z-]+\.[a-z-]+$/)
    assert.ok(modules.has(entry.module))
    assert.ok(entry.id.startsWith(`${entry.module}.`))
  }
  for (const generic of ['admin', 'administrator', 'superuser', 'all', '*', 'root', 'owner']) {
    assert.equal(ids.some((id) => id === generic || id.endsWith(`.${generic}`) || id.endsWith('.*')), false, generic)
  }
  // Pendentes de especificação nunca são concedíveis.
  for (const entry of PERMISSION_CATALOG.filter((p) => p.status !== 'grantable')) {
    assert.equal((GRANTABLE_PERMISSIONS as readonly string[]).includes(entry.id), false)
  }
})

test('sanitizePermissions: legado, textos livres e tipos inválidos não concedem nada', () => {
  assert.deepEqual(sanitizePermissions(undefined), [])
  assert.deepEqual(sanitizePermissions('partnerships.view'), [])
  assert.deepEqual(sanitizePermissions(['admin', 'all', '*', 'partnerships.edit', 7, null]), [])
  assert.deepEqual(sanitizePermissions(['documents.view', 'partnerships.view', 'documents.view']), ['partnerships.view', 'documents.view'])
})

test('Identidade e vínculo: autenticação isolada não autoriza', () => {
  assert.deepEqual(evaluate(ctx(null, osc, null), { kind: 'list-members' }), { allowed: false, reason: 'not-authenticated' })
  assert.deepEqual(evaluate(ctx(null, osc, 'u1'), { kind: 'view-own-permissions' }), { allowed: false, reason: 'no-membership' })
  assert.deepEqual(evaluate(ctx(member('u1'), osc, 'u2'), { kind: 'view-own-permissions' }), { allowed: false, reason: 'no-membership' })
  assert.deepEqual(evaluate({ ...ctx(member('u1')), oscId: 'osc-b' }, { kind: 'view-own-permissions' }), { allowed: false, reason: 'organization-mismatch' })
  assert.deepEqual(evaluate(ctx(member('u1', { status: 'inactive' })), { kind: 'view-own-permissions' }), { allowed: false, reason: 'membership-inactive' })
  assert.deepEqual(evaluate(ctx(member('u1'), { ...osc, registrationStatus: 'pending' }), { kind: 'view-own-permissions' }), { allowed: false, reason: 'organization-not-active' })
})

test('Administrador vem só de administratorUid; delegação não é administração', () => {
  const admin = member('admin')
  const delegate = member('d1', { canManagePermissions: true })
  const target = member('t1')
  assert.deepEqual(evaluate(ctx(admin), { kind: 'grant-delegation', target }), { allowed: true, authority: 'administrator' })
  assert.deepEqual(evaluate(ctx(delegate), { kind: 'grant-delegation', target }), { allowed: false, reason: 'not-administrator' })
  assert.deepEqual(evaluate(ctx(delegate), { kind: 'revoke-delegation', target: member('d2', { canManagePermissions: true }) }), { allowed: false, reason: 'not-administrator' })
  assert.deepEqual(evaluate(ctx(member('u1')), { kind: 'grant-permission', target, permission: 'partnerships.view' }), { allowed: false, reason: 'not-authorized' })
  // OSC sem administrador designado: ninguém é administrador.
  assert.deepEqual(evaluate(ctx(member('u1'), { ...osc, administratorUid: null }), { kind: 'list-members' }), { allowed: false, reason: 'not-authorized' })
})

test('Concessão: permissão válida, alvo ativo, sem autoconcessão; delegado não altera o administrador', () => {
  const admin = member('admin')
  const delegate = member('d1', { canManagePermissions: true })
  const target = member('t1')
  const grant = (actor: MembershipFacts, t: MembershipFacts | null, permission: unknown = 'partnerships.view') =>
    evaluate(ctx(actor), { kind: 'grant-permission', target: t, permission })
  assert.equal(grant(admin, target).allowed, true)
  assert.equal(grant(delegate, target).allowed, true)
  assert.deepEqual(grant(delegate, delegate), { allowed: false, reason: 'self-modification' })
  assert.deepEqual(grant(admin, admin), { allowed: false, reason: 'self-modification' })
  assert.deepEqual(grant(delegate, admin), { allowed: false, reason: 'target-is-administrator' })
  assert.deepEqual(grant(admin, null), { allowed: false, reason: 'target-not-member' })
  assert.deepEqual(grant(admin, member('t2', { status: 'inactive' })), { allowed: false, reason: 'target-not-active' })
  for (const bad of ['partnerships.edit', 'admin', 'all', '*', '', 42]) {
    assert.deepEqual(grant(admin, target, bad), { allowed: false, reason: 'invalid-permission' })
  }
  // Revogação de vínculo inativo é permitida (reduz privilégios).
  assert.equal(evaluate(ctx(admin), { kind: 'revoke-permission', target: member('t2', { status: 'inactive' }), permission: 'partnerships.view' }).allowed, true)
})

test('Suspensão comercial: bloqueia alterações e operação; administrador mantém só a consulta', () => {
  const suspended = { ...osc, commercialStatus: 'suspended' }
  const admin = member('admin')
  const delegate = member('d1', { canManagePermissions: true })
  const op = member('o1', { permissions: ['partnerships.view'] })
  const target = member('t1')
  assert.deepEqual(evaluate(ctx(admin, suspended), { kind: 'list-members' }), { allowed: true, authority: 'administrator' })
  assert.deepEqual(evaluate(ctx(delegate, suspended), { kind: 'list-members' }), { allowed: false, reason: 'commercial-suspension' })
  for (const kind of ['grant-permission', 'revoke-permission'] as const) {
    assert.deepEqual(evaluate(ctx(admin, suspended), { kind, target, permission: 'partnerships.view' }), { allowed: false, reason: 'commercial-suspension' })
  }
  assert.deepEqual(evaluate(ctx(admin, suspended), { kind: 'grant-delegation', target }), { allowed: false, reason: 'commercial-suspension' })
  assert.deepEqual(evaluate(ctx(op, suspended), { kind: 'operate', permission: 'partnerships.view' }), { allowed: false, reason: 'commercial-suspension' })
  assert.equal(evaluate(ctx(op, suspended), { kind: 'view-own-permissions' }).allowed, true)
})

test('Operação futura exige permissão individual; administrador não tem permissões implícitas', () => {
  const op = member('o1', { permissions: ['partnerships.view'] })
  assert.equal(evaluate(ctx(op), { kind: 'operate', permission: 'partnerships.view' }).allowed, true)
  assert.deepEqual(evaluate(ctx(op), { kind: 'operate', permission: 'financial.view' }), { allowed: false, reason: 'permission-not-granted' })
  assert.deepEqual(evaluate(ctx(member('admin')), { kind: 'operate', permission: 'partnerships.view' }), { allowed: false, reason: 'permission-not-granted' })
  assert.deepEqual(evaluate(ctx(op), { kind: 'operate', permission: 'partnerships.edit' }), { allowed: false, reason: 'invalid-permission' })
})
