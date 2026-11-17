/**
 * Ícones da Gestão da OSC — traçados copiados do protótipo homologado HF-G05
 * (sidebar e cabeçalhos). Decorativos: sempre acompanhados de texto.
 */
interface IconProps {
  size?: number
}

export function BrandMark({ size = 32 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 56 56" fill="none">
      <rect width="56" height="56" rx="16" fill="#16565A" />
      <rect x="12" y="12" width="22" height="22" rx="7" fill="#D5E7ED" />
      <rect x="22" y="22" width="22" height="22" rx="7" fill="#F2C94C" />
      <rect x="22" y="22" width="12" height="12" rx="3" fill="#007F7A" />
    </svg>
  )
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 } as const

export function LayersIcon({ size = 20 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" {...stroke}>
      <path d="M2.5 5.5l5.5-3 5.5 3-5.5 3z" />
      <path d="M2.5 8.5l5.5 3 5.5-3" />
    </svg>
  )
}

export function RecordIcon({ size = 20 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" {...stroke}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M5.5 6h5M5.5 9h3" />
    </svg>
  )
}

export function UsersIcon({ size = 20 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" {...stroke}>
      <circle cx="6" cy="5.5" r="2.5" />
      <path d="M2 13c.5-2.5 2-3.5 4-3.5s3.5 1 4 3.5M11 3.5a2.5 2.5 0 010 4.5M12 10c1.2.5 1.8 1.5 2 3" />
    </svg>
  )
}

export function CheckIcon({ size = 12 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.4}>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  )
}

export function MinusIcon({ size = 12 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.4}>
      <path d="M4 8h8" />
    </svg>
  )
}

export function InfoIcon({ size = 18 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2v3.6M8 5.2v.1" />
    </svg>
  )
}

export function PlusIcon({ size = 16 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

export function SearchIcon({ size = 16 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  )
}

export function LockIcon({ size = 20 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
    </svg>
  )
}
