import { createContext, useContext } from 'react'
import type { WorkPlanService } from '../services/workPlans/types.ts'
import type { WorkPlansApi } from '../services/workPlans/workPlansApi.ts'

export interface WorkPlanDependencies {
  readonly service: WorkPlanService
  readonly api: WorkPlansApi
}

export const WorkPlansContext = createContext<WorkPlanDependencies | null>(null)

export function useWorkPlanDependencies(): WorkPlanDependencies {
  const value = useContext(WorkPlansContext)
  if (value === null) throw new Error('useWorkPlanDependencies deve ser usado dentro de <WorkPlansProvider>.')
  return value
}
