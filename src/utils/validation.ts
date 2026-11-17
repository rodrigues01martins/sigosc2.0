/**
 * Validações básicas de formulário (DEV-01.1). Funções puras, sem dependências.
 * A validação no cliente melhora a experiência, mas NÃO substitui as verificações
 * do Firebase Authentication.
 */

/** Formato mínimo: texto@dominio.tld, sem espaços. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Remove espaços nas extremidades do e-mail digitado. */
export function normalizeEmail(value: string): string {
  return value.trim()
}

export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value)
  return email.length <= 254 && EMAIL_PATTERN.test(email)
}

/** A senha não é normalizada nem inspecionada: apenas exige-se que não esteja vazia. */
export function isPasswordProvided(value: string): boolean {
  return value.length > 0
}
