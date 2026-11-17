import { useCallback, useSyncExternalStore } from 'react'

/**
 * Navegação da Gestão da OSC por fragmento de URL (DEV-01.4): `#/identificacao`,
 * `#/parcerias`, `#/usuarios`. Não exige reescrita de rotas na Vercel e preserva
 * voltar/avançar do navegador. A rota NÃO concede acesso: cada página verifica a
 * autorização, e o servidor/Security Rules decidem as operações.
 */
export const OSC_ROUTES = ['identificacao', 'parcerias', 'usuarios'] as const
export type OscRoute = (typeof OSC_ROUTES)[number]

function readRoute(): OscRoute {
  const value = globalThis.location?.hash.replace(/^#\/?/, '') ?? ''
  return (OSC_ROUTES as readonly string[]).includes(value) ? (value as OscRoute) : 'identificacao'
}

function subscribe(listener: () => void) {
  globalThis.addEventListener?.('hashchange', listener)
  return () => globalThis.removeEventListener?.('hashchange', listener)
}

export function useOscRoute(): [OscRoute, (route: OscRoute) => void] {
  const route = useSyncExternalStore(subscribe, readRoute, () => 'identificacao' as OscRoute)
  const navigate = useCallback((next: OscRoute) => {
    if (readRoute() !== next || globalThis.location.hash === '') globalThis.location.hash = `/${next}`
  }, [])
  return [route, navigate]
}
