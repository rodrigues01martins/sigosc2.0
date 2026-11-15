/** Situação de um item exibido no painel de verificação técnica. */
export type StatusLevel = 'ok' | 'pending' | 'info'

export interface StatusItem {
  label: string
  value: string
  level: StatusLevel
}
