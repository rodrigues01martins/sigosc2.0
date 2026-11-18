import type { ReactNode } from 'react'
import { WorkPlansContext, type WorkPlanDependencies } from '../hooks/workPlansContext.ts'

/** Disponibiliza consulta e gravações do Plano de Trabalho (substituíveis em testes). */
export function WorkPlansProvider({ value, children }: { value: WorkPlanDependencies; children: ReactNode }) {
  return <WorkPlansContext value={value}>{children}</WorkPlansContext>
}
