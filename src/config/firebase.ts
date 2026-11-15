import type { FirebaseOptions } from 'firebase/app'

/**
 * Configuração central do Firebase Web.
 *
 * Os valores vêm de variáveis de ambiente do Vite (prefixo VITE_), definidas em
 * `.env.local` (desenvolvimento) ou no painel da Vercel (produção).
 *
 * IMPORTANTE:
 * - Estes valores são públicos por natureza (vão para o bundle do navegador).
 *   A proteção dos dados depende EXCLUSIVAMENTE das Security Rules do
 *   Firestore/Storage e da autenticação — não destas variáveis.
 * - Nenhum serviço (Auth, Firestore, Storage) é inicializado nesta etapa (DEV-00.5).
 * - Nunca usar Firebase Admin SDK ou contas de serviço no frontend.
 */
const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const REQUIRED_KEYS = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
] as const satisfies readonly (keyof FirebaseOptions)[]

/** Indica se todas as variáveis do Firebase foram fornecidas. */
export const isFirebaseConfigured: boolean = REQUIRED_KEYS.every(
  (key) => typeof firebaseConfig[key] === 'string' && firebaseConfig[key] !== '',
)

/**
 * Retorna a configuração do Firebase somente quando completa.
 * Retorna `null` enquanto as variáveis não forem definidas, permitindo que a
 * aplicação compile e funcione sem configuração real.
 */
export function getFirebaseConfig(): FirebaseOptions | null {
  return isFirebaseConfigured ? firebaseConfig : null
}
