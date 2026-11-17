import { useCallback, useSyncExternalStore } from 'react'

/** Acompanha uma media query (sem `matchMedia`, como em testes, retorna `false`). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      const list = globalThis.matchMedia?.(query)
      list?.addEventListener?.('change', listener)
      return () => list?.removeEventListener?.('change', listener)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => globalThis.matchMedia?.(query).matches ?? false, () => false)
}
