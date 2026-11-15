import { validateEnvironmentConfig } from './environmentValidation.ts'

/**
 * Resultado da validação para o build atual.
 * Lê as variáveis injetadas pelo Vite (definidas na Vercel ou em `.env.local`).
 * Nenhum serviço Firebase é inicializado aqui.
 */
export const environmentValidation = validateEnvironmentConfig({
  VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
  VITE_APP_ENV: import.meta.env.VITE_APP_ENV,
  VITE_EXPECTED_FIREBASE_PROJECT_ID: import.meta.env.VITE_EXPECTED_FIREBASE_PROJECT_ID,
})
