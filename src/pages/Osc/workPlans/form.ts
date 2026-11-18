import { FIELD_DEFINITIONS, type FieldValue, type WorkPlanField, type WorkPlanValues } from '../../../domain/workPlans.ts'

/** Estado do formulário do Plano: texto digitado e marcação "não se aplica" por campo. */
export type FormState = Record<WorkPlanField, { text: string; na: boolean }>

export function formFromValues(values: WorkPlanValues): FormState {
  return Object.fromEntries(
    FIELD_DEFINITIONS.map((f) => {
      const v = values[f.id]
      return [f.id, { text: v.state === 'informed' ? String(v.value) : '', na: v.state === 'not-applicable' }]
    }),
  ) as FormState
}

/** Campo do formulário → estado de informação: vazio = não informado; "não se aplica" = não aplicável. */
export function valueFromForm(field: WorkPlanField, input: { text: string; na: boolean }): FieldValue | 'invalid' {
  const def = FIELD_DEFINITIONS.find((f) => f.id === field)
  if (input.na) return { state: 'not-applicable' }
  const text = input.text.trim()
  if (text === '') return { state: 'not-informed' }
  if (def?.kind === 'integer') return /^\d+$/.test(text) ? { state: 'informed', value: Number(text) } : 'invalid'
  return { state: 'informed', value: text }
}


const NUMBER = new Intl.NumberFormat('pt-BR')

/** Valor para exibição, com o estado de informação explícito (nunca "zero" para ausência). */
export function displayValue(value: FieldValue, kind: string): string {
  if (value.state === 'not-informed') return 'Não informado'
  if (value.state === 'not-applicable') return 'Não se aplica'
  if (kind === 'date') return String(value.value).split('-').reverse().join('/')
  if (kind === 'integer') return NUMBER.format(Number(value.value))
  return String(value.value)
}
