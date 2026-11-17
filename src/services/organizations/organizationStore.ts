/**
 * Contexto organizacional centralizado (DEV-01.2), compatível com `useSyncExternalStore`.
 *
 * Deriva do estado de autenticação e implementa:
 * - U01: um único vínculo selecionável → selecionado automaticamente.
 * - U02: vários vínculos → escolha do usuário.
 * - U03: sem vínculos → estado `ready` com lista vazia.
 * - U04: vínculo inativo (ou OSC não ativa) → não selecionável.
 * - U05: troca de OSC revalida o vínculo no servidor e substitui o contexto.
 * - U06: logout → contexto e seleção guardada removidos.
 * - U07: sessão restaurada → a seleção guardada só é reutilizada se o vínculo
 *        recém-consultado no servidor continuar selecionável.
 *
 * Respostas tardias (ex.: logout durante a consulta) são descartadas por geração.
 * O contexto NÃO substitui as Security Rules.
 */
import type { AuthStore } from '../auth/authStore.ts'
import type { AuthState } from '../auth/types.ts'
import type { SelectionStorage } from './selectionStorage.ts'
import type { Membership, OrganizationService, OrganizationState } from './types.ts'

export interface OrganizationStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): OrganizationState
  /** Seleciona a OSC ativa após revalidar o vínculo no servidor. */
  select(oscId: string): Promise<void>
  /** Consulta novamente os vínculos (ex.: após falha de rede). */
  reload(): Promise<void>
}

const SIGNED_OUT: OrganizationState = { status: 'signed-out' }
const UNAVAILABLE: OrganizationState = { status: 'unavailable' }

interface Dependencies {
  authStore: AuthStore
  service: OrganizationService
  selectionStorage: SelectionStorage
}

export function createOrganizationStore({ authStore, service, selectionStorage }: Dependencies): OrganizationStore {
  let state: OrganizationState = service.available ? SIGNED_OUT : UNAVAILABLE
  let currentUid: string | null = null
  /** Incrementada a cada mudança de usuário: invalida respostas pendentes. */
  let generation = 0
  const listeners = new Set<() => void>()
  let stopAuth: (() => void) | null = null

  function setState(next: OrganizationState) {
    if (next === state) return
    state = next
    for (const listener of listeners) listener()
  }

  function onAuthChange(auth: AuthState) {
    if (!service.available || auth.status === 'loading') return
    if (auth.status !== 'authenticated') {
      // U06: sem sessão (logout ou sessão encerrada) → limpeza integral do contexto local.
      if (currentUid !== null) generation++
      currentUid = null
      selectionStorage.clearAll()
      setState(SIGNED_OUT)
      return
    }
    const uid = auth.user.uid
    if (uid === currentUid) return

    generation++
    if (currentUid !== null) selectionStorage.clearAll()
    currentUid = uid
    void load(uid, generation)
  }

  async function load(uid: string, gen: number) {
    setState({ status: 'loading', uid })
    const result = await service.loadMemberships(uid)
    if (gen !== generation) return
    if (!result.ok) {
      setState({ status: 'error', uid, error: result.error })
      return
    }
    const memberships = result.data
    const selectable = memberships.filter((m) => m.selectable)
    const stored = selectionStorage.read(uid)

    let activeOscId: string | null = null
    if (stored !== null && selectable.some((m) => m.oscId === stored)) activeOscId = stored // U07
    else if (selectable.length === 1 && selectable[0]) activeOscId = selectable[0].oscId // U01
    if (activeOscId === null && stored !== null) selectionStorage.clearAll()
    if (activeOscId !== null) selectionStorage.write(uid, activeOscId)

    setState({ status: 'ready', uid, memberships, activeOscId, pendingOscId: null, selectionError: null })
  }

  function replaceMembership(list: readonly Membership[], oscId: string, next: Membership | null): Membership[] {
    return next === null ? list.filter((m) => m.oscId !== oscId) : list.map((m) => (m.oscId === oscId ? next : m))
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      if (stopAuth === null) {
        stopAuth = authStore.subscribe(() => onAuthChange(authStore.getSnapshot()))
        onAuthChange(authStore.getSnapshot())
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && stopAuth !== null) {
          stopAuth()
          stopAuth = null
        }
      }
    },

    getSnapshot: () => state,

    async select(oscId) {
      const current = state
      if (current.status !== 'ready' || current.pendingOscId !== null) return
      const known = current.memberships.find((m) => m.oscId === oscId)
      if (!known?.selectable) {
        setState({ ...current, selectionError: 'not-selectable' })
        return
      }
      if (current.activeOscId === oscId) return

      const gen = generation
      const uid = current.uid
      setState({ ...current, pendingOscId: oscId, selectionError: null })
      const result = await service.revalidateMembership(uid, oscId)
      const latest = state
      if (gen !== generation || latest.status !== 'ready') return

      if (!result.ok) {
        setState({ ...latest, pendingOscId: null, selectionError: result.error })
        return
      }
      const fresh = result.data
      const memberships = replaceMembership(latest.memberships, oscId, fresh)
      if (fresh?.selectable) {
        selectionStorage.write(uid, oscId)
        setState({ ...latest, memberships, activeOscId: oscId, pendingOscId: null, selectionError: null })
      } else {
        setState({
          ...latest,
          memberships,
          pendingOscId: null,
          selectionError: fresh === null ? 'not-found' : 'not-selectable',
        })
      }
    },

    async reload() {
      if (currentUid === null) return
      generation++
      await load(currentUid, generation)
    },
  }
}
