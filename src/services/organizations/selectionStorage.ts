/**
 * Memória da última OSC selecionada (DEV-01.2).
 *
 * Guarda APENAS o identificador da OSC, por usuário. Nunca é tratado como
 * autorização: ao restaurar a sessão, o vínculo é revalidado no servidor (U07).
 * Removido integralmente no logout (U06).
 */
export interface SelectionStorage {
  read(uid: string): string | null
  write(uid: string, oscId: string): void
  /** Remove todas as seleções guardadas neste navegador. */
  clearAll(): void
}

const PREFIX = 'sigosc:active-osc:'

/** Implementação em `localStorage` (mesma política LOCAL da sessão). Falhas são ignoradas. */
export function createBrowserSelectionStorage(storage: Storage | undefined = globalThis.localStorage): SelectionStorage {
  return {
    read(uid) {
      try {
        return storage?.getItem(PREFIX + uid) ?? null
      } catch {
        return null
      }
    },
    write(uid, oscId) {
      try {
        storage?.setItem(PREFIX + uid, oscId)
      } catch {
        // Armazenamento bloqueado: a seleção vale apenas nesta página.
      }
    },
    clearAll() {
      try {
        if (!storage) return
        const keys: string[] = []
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i)
          if (key?.startsWith(PREFIX)) keys.push(key)
        }
        for (const key of keys) storage.removeItem(key)
      } catch {
        // Ignorado: nada a limpar.
      }
    },
  }
}

/** Implementação em memória (testes). */
export function createMemorySelectionStorage(): SelectionStorage & { entries(): Record<string, string> } {
  const map = new Map<string, string>()
  return {
    read: (uid) => map.get(uid) ?? null,
    write: (uid, oscId) => void map.set(uid, oscId),
    clearAll: () => map.clear(),
    entries: () => Object.fromEntries(map),
  }
}
