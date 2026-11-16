/**
 * Ambiente de teste das Security Rules (DEV-00.8).
 *
 * Executado somente via `npm run test:rules`, que inicia os emuladores locais de
 * Firestore e Storage com o projeto fictício `demo-sigosc-rules` (o prefixo
 * `demo-` impede qualquer acesso a projetos reais). Nenhum usuário real é criado:
 * os contextos autenticados são simulados pelo `@firebase/rules-unit-testing`.
 */
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'

export const PROJECT_ID = 'demo-sigosc-rules'

function emulatorAddress(variable: string): { host: string; port: number } {
  const value = process.env[variable]
  if (!value) throw new Error(`${variable} não definido: execute com "npm run test:rules".`)
  const [host = '127.0.0.1', port = ''] = value.replace(/^https?:\/\//, '').split(':')
  return { host, port: Number(port) }
}

export async function createTestEnvironment(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      ...emulatorAddress('FIRESTORE_EMULATOR_HOST'),
      rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
    },
    storage: {
      ...emulatorAddress('FIREBASE_STORAGE_EMULATOR_HOST'),
      rules: readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8'),
    },
  })
}

/** Usuários SIMULADOS (tokens fictícios do emulador), de OSCs diferentes. */
export const USER_OSC_A = { uid: 'usuario-osc-a', claims: { oscId: 'osc-a', perfil: 'gestor' } }
export const USER_OSC_B = { uid: 'usuario-osc-b', claims: { oscId: 'osc-b', perfil: 'administrador' } }
