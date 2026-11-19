/** DEV-02.4-C01 — conferência de componentes (DEC-PT-007) para testes de servidor e E2E. */
import { componentsToken } from '../../src/domain/workPlanComponents.ts'

export const REVIEW_NONE = {
  goals: { status: 'none-in-document', justification: 'O Plano aprovado não contém metas estruturadas.' },
  indicators: { status: 'none-in-document', justification: 'O Plano aprovado não contém indicadores estruturados.' },
} as const
export const REVIEW_TRANSCRIBED = { goals: { status: 'transcribed', justification: null }, indicators: { status: 'transcribed', justification: null } } as const
export const EMPTY_TOKEN = componentsToken([])

/** Campos da finalização regular: conferência, impressão digital vista e declaração. */
export const reviewed = (review: unknown = REVIEW_NONE, token = EMPTY_TOKEN) => ({ review, componentsToken: token, declaration: true })
