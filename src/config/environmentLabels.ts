import type { AppEnvironment } from './environmentValidation.ts'

/** Rótulos exibidos para cada ambiente. */
export const ENVIRONMENT_LABEL: Record<AppEnvironment, string> = {
  test: 'Testes',
  production: 'Produção',
}
