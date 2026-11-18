import { useCallback, useMemo, useSyncExternalStore } from 'react'

/**
 * Navegação da Gestão da OSC por fragmento de URL (DEV-01.4): `#/identificacao`,
 * `#/parcerias`, `#/usuarios` e, na DEV-02.1, `#/parcerias/{id}` (Identificação da
 * Parceria). Não exige reescrita de rotas na Vercel e preserva voltar/avançar.
 * A rota NÃO concede acesso: cada página verifica a autorização, e o identificador
 * da parceria é SEMPRE consultado sob a OSC ativa (as Security Rules decidem).
 */
export const OSC_ROUTES = ['identificacao', 'parcerias', 'usuarios'] as const
export type OscRoute = (typeof OSC_ROUTES)[number] | 'parceria'

export interface OscLocation {
  readonly route: OscRoute
  /** Somente na rota `parceria`; texto bruto da URL (validado pela consulta). */
  readonly partnershipId: string | null
}

function readHash(): string {
  return globalThis.location?.hash.replace(/^#\/?/, '') ?? ''
}

export function parseLocation(hash: string): OscLocation {
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
    const target = next === 'parceria' && partnershipId ? `parcerias/${encodeURIComponent(partnershipId)}` : next === 'parceria' ? 'parcerias' : next
    if (readHash() !== target || globalThis.location.hash === '') globalThis.location.hash = `/${target}`
  }, [])
  return [location, navigate]
}
