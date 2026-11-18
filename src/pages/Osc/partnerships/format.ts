import { administrativeStatusLabel, partnershipTitle } from '../../../domain/partnerships.ts'
import type { PartnershipErrorKind } from '../../../services/partnerships/types.ts'

/** AAAA-MM-DD → DD/MM/AAAA (sem conversão de fuso: datas civis). */
export function formatDate(value: string): string {
  const [y, m, d] = value.split('-')
  return y && m && d ? `${d}/${m}/${y}` : value
}

export function formatTerm(start: string, end: string): string {
  return `${formatDate(start)} a ${formatDate(end)}`
}

const MONEY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export function formatMoney(cents: number): string {
  return MONEY.format(cents / 100)
}

/** "1.234,56" / "1234.56" / "1234" → centavos; `null` se inválido. */
export function parseMoneyToCents(input: string): number | null {
  const clean = input.replace(/\s|R\$/g, '')
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(clean)) return null
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(clean) ? clean.replace(/\./g, '') : clean
  const value = Math.round(Number(normalized) * 100)
  return Number.isSafeInteger(value) ? value : null
}

export function formatTimestamp(value: Date | null): string {
  return value ? value.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'Não informado'
}

export { administrativeStatusLabel, partnershipTitle }

export const PARTNERSHIP_LOAD_ERROR: Record<PartnershipErrorKind, string> = {
  'permission-denied': 'A consulta foi negada pelas regras de acesso. Verifique se a sua permissão de consulta continua concedida.',
  network: 'Não foi possível comunicar com o servidor. Verifique a conexão e tente novamente.',
  'not-configured': 'A consulta de parcerias não está configurada neste ambiente (índice ou regras ainda não publicados).',
  unknown: 'Não foi possível consultar as parcerias. Tente novamente.',
}

/** Data civil de hoje no fuso de Brasília (AAAA-MM-DD), como no servidor. */
export function todayInBrasilia(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
