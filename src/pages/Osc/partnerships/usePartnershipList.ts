import { useCallback, useEffect, useRef, useState } from 'react'
import { usePartnershipDependencies } from '../../../hooks/partnershipsContext.ts'
import type { Partnership, PartnershipErrorKind } from '../../../services/partnerships/types.ts'

export type ListState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: PartnershipErrorKind }
  | {
      readonly status: 'ready'
      readonly items: readonly Partnership[]
      readonly next: unknown
      readonly loadingMore: boolean
      readonly moreError: PartnershipErrorKind | null
    }

/**
 * Parcerias da OSC informada, por páginas. O componente que usa o hook é recriado
 * na troca de OSC (`key`), e respostas tardias de outra OSC são descartadas.
 */
export function usePartnershipList(oscId: string) {
  const { service } = usePartnershipDependencies()
  const [state, setState] = useState<ListState>({ status: 'loading' })
  const alive = useRef(true)
  const generation = useRef(0)

  // Sem atualização síncrona de estado: o estado inicial já é "loading".
  const loadFirst = useCallback(async () => {
    const current = ++generation.current
    const result = await service.listPage(oscId, null)
    if (!alive.current || current !== generation.current) return
    setState(result.ok ? { status: 'ready', items: result.data.items, next: result.data.next, loadingMore: false, moreError: null } : { status: 'error', error: result.error })
  }, [oscId, service])

  useEffect(() => {
    alive.current = true
    void loadFirst()
    return () => {
      alive.current = false
    }
  }, [loadFirst])

  const loadMore = useCallback(async () => {
    if (state.status !== 'ready' || state.loadingMore || state.next === null) return
    const current = generation.current
    const cursor = state.next
    setState({ ...state, loadingMore: true, moreError: null })
    const result = await service.listPage(oscId, cursor)
    if (!alive.current || current !== generation.current) return
    setState((previous) => {
      if (previous.status !== 'ready') return previous
      if (!result.ok) return { ...previous, loadingMore: false, moreError: result.error }
      const known = new Set(previous.items.map((p) => p.id))
      return { status: 'ready', items: [...previous.items, ...result.data.items.filter((p) => !known.has(p.id))], next: result.data.next, loadingMore: false, moreError: null }
    })
  }, [oscId, service, state])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    void loadFirst()
  }, [loadFirst])

  return { state, retry, loadMore }
}
