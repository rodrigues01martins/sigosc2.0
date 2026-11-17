import { useCallback, useEffect, useRef, useState } from 'react'
import type { DenialReason, GrantablePermissionId } from '../../../domain/authorization.ts'
import type {
  ApiResult,
  ManagedMember,
  MemberDirectory,
  MutationAction,
  PermissionsApi,
  PermissionsApiError,
} from '../../../services/permissions/permissionsApi.ts'
import { loadErrorMessage, mutationErrorMessage, successMessage } from './messages.ts'

export type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: PermissionsApiError; reason?: DenialReason; message: string }
  | { status: 'ready'; directory: MemberDirectory }

export interface Feedback {
  readonly kind: 'success' | 'error'
  readonly text: string
  /** Muda a cada mensagem: garante novo anúncio mesmo com texto igual. */
  readonly id: number
}

/** Chave de uma célula: usuário + permissão (ou delegação). */
export const cellKey = (uid: string, permission: GrantablePermissionId | 'delegation') => `${uid}|${permission}`

const nameOf = (m: ManagedMember) => m.email ?? m.uid

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key))
}

/**
 * Estado da matriz de usuários e permissões (UX-001).
 *
 * - Uma célula só muda de estado com resposta POSITIVA do servidor (estado
 *   confirmado devolvido pela API); até lá exibe "processando".
 * - Operações por célula: a mesma célula não aceita nova solicitação enquanto
 *   processa; as demais continuam disponíveis.
 * - Respostas tardias são descartadas após desmontagem (troca de OSC ou logout:
 *   o componente é remontado por `key`) e nunca alteram outra OSC.
 * - Consultas da relação iniciadas antes de uma alteração confirmada são
 *   descartadas e refeitas, para não sobrescrever um estado mais recente.
 * - Negação pelo servidor (autorização revogada, suspensão, vínculo removido)
 *   recarrega a relação a partir da fonte confiável.
 */
export function usePermissionDirectory(api: PermissionsApi, oscId: string) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [pending, setPending] = useState<Readonly<Record<string, MutationAction>>>({})
  const [failed, setFailed] = useState<Readonly<Record<string, true>>>({})
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const alive = useRef(true)
  const inflight = useRef(new Set<string>())
  const confirmedMutations = useRef(0)
  const reloadSeq = useRef(0)
  const feedbackSeq = useRef(0)

  const say = useCallback((kind: Feedback['kind'], text: string) => {
    feedbackSeq.current += 1
    setFeedback({ kind, text, id: feedbackSeq.current })
  }, [])

  const reload = useCallback(async (): Promise<void> => {
    for (;;) {
      const seq = ++reloadSeq.current
      const mutationsAtStart = confirmedMutations.current
      const result: ApiResult<MemberDirectory> = await api.listMembers(oscId)
      if (!alive.current || seq !== reloadSeq.current) return
      // Uma alteração foi confirmada durante a consulta: o resultado pode estar defasado.
      if (confirmedMutations.current !== mutationsAtStart) continue
      setLoad(
        result.ok
          ? { status: 'ready', directory: result.data }
          : { status: 'error', error: result.error, reason: result.reason, message: loadErrorMessage(result.error, result.reason) },
      )
      return
    }
  }, [api, oscId])

  useEffect(() => {
    alive.current = true
    void reload()
    return () => {
      alive.current = false
    }
  }, [reload])

  const retryLoad = useCallback(() => {
    setLoad({ status: 'loading' })
    void reload()
  }, [reload])

  const mutate = useCallback(
    async (member: ManagedMember, action: MutationAction, permission?: GrantablePermissionId): Promise<boolean> => {
      const key = cellKey(member.uid, permission ?? 'delegation')
      if (inflight.current.has(key)) return false // bloqueia solicitações duplicadas
      inflight.current.add(key)
      setPending((p) => ({ ...p, [key]: action }))
      setFailed((f) => (key in f ? without(f, key) : f))

      const requestOscId = oscId
      const result = await api.mutate({ oscId: requestOscId, targetUid: member.uid, action, permission })
      inflight.current.delete(key)
      if (!alive.current) return false

      setPending((p) => without(p, key))

      if (result.ok) {
        confirmedMutations.current += 1
        const confirmed = result.data.member
        if (confirmed) {
          setLoad((current) =>
            current.status === 'ready' && current.directory.oscId === requestOscId
              ? {
                  ...current,
                  directory: {
                    ...current.directory,
                    members: current.directory.members.map((m) =>
                      m.uid === confirmed.uid ? { ...m, permissions: confirmed.permissions, canManagePermissions: confirmed.canManagePermissions } : m,
                    ),
                  },
                }
              : current,
          )
        } else {
          void reload() // resposta sem o estado confirmado: busca na fonte confiável
        }
        say('success', successMessage(action, nameOf(member), permission, result.data.changed))
        return true
      }

      setFailed((f) => ({ ...f, [key]: true }))
      say('error', mutationErrorMessage(result.error, result.reason, permission === undefined))
      if (result.error === 'forbidden') void reload()
      return false
    },
    [api, oscId, reload, say],
  )

  return { load, pending, failed, feedback, mutate, retryLoad }
}
