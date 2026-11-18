/**
 * Dados FICTÍCIOS de parcerias (DEV-02.1) — somente emuladores e testes.
 * Nenhum dado é gravado em ambiente real por este arquivo.
 */
import { OSCS } from './organizationFixtures.ts'

const CREATED = new Date('2026-04-01T12:00:00Z')

export interface PartnershipFixture {
  id: string
  oscId: string
  instrument?: 'termo-colaboracao' | 'termo-fomento' | 'acordo-cooperacao'
  instrumentNumber?: string
  publicPartner?: string
  object?: string
  administrativeStatus?: 'em-execucao' | 'suspensa' | 'encerrada' | 'arquivada'
  termStart?: string
  termEnd?: string
  globalValueCents?: number | null
  globalValueStatus?: 'informed' | 'not-informed' | 'not-applicable'
  revision?: number
  createdAt?: Date
}

/** Documento completo como o servidor o gravaria (estrutura `oscs/{oscId}/partnerships/{id}`). */
export function partnershipDocument(p: PartnershipFixture) {
  const instrument = p.instrument ?? 'termo-colaboracao'
  const cooperation = instrument === 'acordo-cooperacao'
  const valueStatus = cooperation ? 'not-applicable' : (p.globalValueStatus ?? (p.globalValueCents === null ? 'not-informed' : 'informed'))
  return {
    schemaVersion: 2,
    id: p.id,
    oscId: p.oscId,
    instrument,
    instrumentNumber: p.instrumentNumber ?? '06/2026',
    publicPartner: p.publicPartner ?? 'Secretaria Municipal Fictícia de Assistência Social',
    object: p.object ?? 'Atividades socioeducativas fictícias para crianças e adolescentes.',
    administrativeProcess: null,
    formalizationDate: '2026-02-20',
    termStart: p.termStart ?? '2026-03-01',
    termEnd: p.termEnd ?? '2028-02-28',
    globalValueStatus: valueStatus,
    globalValueCents: valueStatus === 'informed' ? (p.globalValueCents ?? 15_000_000) : null,
    administrativeStatus: p.administrativeStatus ?? 'em-execucao',
    administrativeStatusSource: 'declared-at-registration',
    administrativeStatusDeclaredAt: p.createdAt ?? CREATED,
    administrativeStatusDeclaredBy: 'uid-ficticio-operator',
    workPlan: { approvalDeclared: true, document: 'not-incorporated' },
    duplicateCheckKey: `${instrument}|${p.instrumentNumber ?? '06/2026'}|${p.id}`,
    creationRequestId: `req-${p.id}`,
    revision: p.revision ?? 1,
    createdAt: p.createdAt ?? CREATED,
    createdBy: 'uid-ficticio-operator',
    updatedAt: p.createdAt ?? CREATED,
    updatedBy: 'uid-ficticio-operator',
  }
}

/** Três parcerias de ALFA (instrumentos e situações do protótipo, com dados fictícios) e uma de GAMA. */
export const PARTNERSHIPS: PartnershipFixture[] = [
  { id: 'pAlfaColaboracao06', oscId: OSCS.ALFA.id, instrument: 'termo-colaboracao', instrumentNumber: '06/2026', object: 'Oficinas socioeducativas no contraturno escolar.', createdAt: new Date('2026-04-03T12:00:00Z') },
  { id: 'pAlfaFomento02xxxxx', oscId: OSCS.ALFA.id, instrument: 'termo-fomento', instrumentNumber: '02/2026', object: 'Fomento a hortas comunitárias urbanas.', administrativeStatus: 'suspensa', termEnd: '2027-12-31', createdAt: new Date('2026-04-02T12:00:00Z') },
  { id: 'pAlfaCooperacao01xx', oscId: OSCS.ALFA.id, instrument: 'acordo-cooperacao', administrativeStatus: 'arquivada', instrumentNumber: '01/2026', publicPartner: 'Fundação Pública Fictícia de Cultura', object: 'Cessão de espaço para atividades culturais.', termEnd: '2027-06-30', createdAt: new Date('2026-04-01T12:00:00Z') },
  { id: 'pGamaColaboracao09x', oscId: OSCS.GAMA.id, instrument: 'termo-colaboracao', instrumentNumber: '09/2026', object: 'Atendimento fictício exclusivo da OSC Gama.', createdAt: new Date('2026-04-04T12:00:00Z') },
]

export const partnershipPath = (p: Pick<PartnershipFixture, 'id' | 'oscId'>) => `oscs/${p.oscId}/partnerships/${p.id}`
