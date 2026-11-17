import type { OrganizationErrorKind } from './types.ts'

/**
 * Converte erros do Firestore em categorias seguras. Apenas o `code` é lido;
 * mensagens (que podem conter caminhos, IDs ou links do projeto) são descartadas.
 */
export function mapFirestoreError(error: unknown): OrganizationErrorKind {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code.replace(/^firestore\//, '')
      : undefined
  switch (code) {
    case 'permission-denied':
    case 'unauthenticated':
      return 'permission-denied'
    case 'unavailable':
    case 'deadline-exceeded':
      return 'network'
    case 'failed-precondition':
      return 'not-configured'
    default:
      return 'unknown'
  }
}
