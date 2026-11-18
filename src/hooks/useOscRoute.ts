import { useCallback, useMemo, useSyncExternalStore } from 'react'

/**
 * Navegação da Gestão da OSC por fragmento de URL (DEV-01.4): `#/identificacao`,
 * `#/parcerias`, `#/usuarios` e, na DEV-02.1, `#/parcerias/{id}` (Identificação da
 * Parceria). Não exige reescrita de rotas na Vercel e preserva voltar/avançar.
 * A rota NÃO concede acesso: cada página verifica a autorização, e o identificador
 * da parceria é SEMPRE consultado sob a OSC ativa (as Security Rules decidem).
 */
export const OSC_ROUTES = ['identificacao', 'parcerias', 'usuarios'] as const
export type OscRoute = (typeof OSC_ROUTES)[number] | 'parceria' | 'plano'

export interface OscLocation {
  readonly route: OscRoute
  /** Somente nas rotas `parceria` e `plano`; texto bruto da URL (validado pela consulta). */
  readonly partnershipId: string | null
}

function readHash(): string {
  return globalThis.location?.hash.replace(/^#\/?/, '') ?? ''
}

export function parseLocation(hash: string): OscLocation {
  // DEV-02.2: `#/parcerias/{id}/plano` — Plano de Trabalho da parceria (PAG-OSC05).
  const plan = /^parcerias\/([^/]+)\/plano$/.exec(hash)
  if (plan) {
    let id: string
    try {
      id = decodeURIComponent(plan[1] as string)
    } catch {
      id = ''
    }
    return { route: 'plano', partnershipId: id }
  }
  const detail = /^parcerias\/([^/]+)$/.exec(hash)
  if (detail) {
    let id: string
    try {
      id = decodeURIComponent(detail[1] as string)
    } catch {
      id = ''
    }
    return { route: 'parceria', partnershipId: id }
  }
  const route = (OSC_ROUTES as readonly string[]).includes(hash) ? (hash as OscRoute) : 'identificacao'
  return { route, partnershipId: null }
}

function subscribe(listener: () => void) {
  globalThis.addEventListener?.('hashchange', listener)
  return () => globalThis.removeEventListener?.('hashchange', listener)
}

export function useOscRoute(): [OscLocation, (route: OscRoute, partnershipId?: string) => void] {
  const hash = useSyncExternalStore(subscribe, readHash, () => '')
  const location = useMemo(() => parseLocation(hash), [hash])
  const navigate = useCallback((next: OscRoute, partnershipId?: string) => {
    const target =
      (next === 'parceria' || next === 'plano') && partnershipId
        ? `parcerias/${encodeURIComponent(partnershipId)}${next === 'plano' ? '/plano' : ''}`
        : next === 'parceria' || next === 'plano'
          ? 'parcerias'
          : next
    if (readHash() !== target || globalThis.location.hash === '') globalThis.location.hash = `/${target}`
  }, [])
  return [location, navigate]
}
