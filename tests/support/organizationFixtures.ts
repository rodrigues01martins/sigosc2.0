/**
 * Dados FICTÍCIOS de OSCs e vínculos (DEV-01.2).
 *
 * Usados nos emuladores e no SDK simulado. Nenhum dado real. Os mesmos
 * cenários estão descritos no README para provisionamento manual no Firebase
 * de TESTES (nunca em produção).
 *
 * Cenários:
 * - MULTI: ativo em ALFA (administrador) e BETA; inativo em GAMA; ativo em DELTA (OSC pendente).
 * - SINGLE: ativo somente em GAMA (seleção automática — U01).
 * - NONE: sem vínculos (U03).
 */
export const USERS = {
  MULTI: { uid: 'uid-ficticio-multi', email: 'multi@exemplo.invalid', password: 'senha-ficticia-multi' },
  SINGLE: { uid: 'uid-ficticio-single', email: 'single@exemplo.invalid', password: 'senha-ficticia-single' },
  NONE: { uid: 'uid-ficticio-none', email: 'sem.vinculo@exemplo.invalid', password: 'senha-ficticia-none' },
} as const

const CREATED = new Date('2026-01-01T00:00:00Z')
const ADMIN_OPERATOR = 'operador-plataforma-ficticio'

export interface OscFixture {
  id: string
  name: string
  registrationStatus: 'pending' | 'active' | 'suspended' | 'inactive'
  commercialStatus: 'pending' | 'active' | 'suspended' | 'cancelled'
  administratorUid: string | null
}

export const OSCS: Record<'ALFA' | 'BETA' | 'GAMA' | 'DELTA', OscFixture> = {
  ALFA: { id: 'osc-alfa', name: 'Associação Fictícia Alfa', registrationStatus: 'active', commercialStatus: 'active', administratorUid: USERS.MULTI.uid },
  BETA: { id: 'osc-beta', name: 'Instituto Fictício Beta', registrationStatus: 'active', commercialStatus: 'suspended', administratorUid: null },
  GAMA: { id: 'osc-gama', name: 'Fundação Fictícia Gama', registrationStatus: 'active', commercialStatus: 'active', administratorUid: USERS.SINGLE.uid },
  DELTA: { id: 'osc-delta', name: 'Coletivo Fictício Delta', registrationStatus: 'pending', commercialStatus: 'pending', administratorUid: null },
}

export interface MemberFixture {
  oscId: string
  uid: string
  status: 'active' | 'inactive'
  specialRole: 'administrator' | null
}

export const MEMBERS: MemberFixture[] = [
  { oscId: OSCS.ALFA.id, uid: USERS.MULTI.uid, status: 'active', specialRole: 'administrator' },
  { oscId: OSCS.BETA.id, uid: USERS.MULTI.uid, status: 'active', specialRole: null },
  { oscId: OSCS.GAMA.id, uid: USERS.MULTI.uid, status: 'inactive', specialRole: null },
  { oscId: OSCS.DELTA.id, uid: USERS.MULTI.uid, status: 'active', specialRole: null },
  { oscId: OSCS.GAMA.id, uid: USERS.SINGLE.uid, status: 'active', specialRole: 'administrator' },
]

/** Documento completo da OSC, como seria gravado pela administração da plataforma. */
export function oscDocument(osc: OscFixture) {
  return { ...osc, createdAt: CREATED, updatedAt: CREATED, createdBy: ADMIN_OPERATOR, updatedBy: ADMIN_OPERATOR }
}

/** Documento completo do vínculo. `specialRole` é espelho NÃO autoritativo de `administratorUid`. */
export function memberDocument(member: MemberFixture) {
  return { ...member, createdAt: CREATED, updatedAt: CREATED, createdBy: ADMIN_OPERATOR, updatedBy: ADMIN_OPERATOR }
}

export const memberPath = (m: Pick<MemberFixture, 'oscId' | 'uid'>) => `oscs/${m.oscId}/members/${m.uid}`
export const oscPath = (osc: Pick<OscFixture, 'id'>) => `oscs/${osc.id}`
