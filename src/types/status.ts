/** Situação de um item exibido no painel de verificação técnica. */
export type StatusLevel = 'ok' | 'pending' | 'info' | 'error'

export interface StatusItem {
  label: string
  value: string
  level: StatusLevel
}
