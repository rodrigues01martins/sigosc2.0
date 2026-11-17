import { createContext } from 'react'
import type { PermissionsApi } from '../services/permissions/permissionsApi.ts'

export const PermissionsApiContext = createContext<PermissionsApi | null>(null)
