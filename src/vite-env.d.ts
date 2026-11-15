/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  /** Ambiente da aplicação: "test" ou "production" (validado em runtime). */
  readonly VITE_APP_ENV?: string
  /** ID do projeto Firebase esperado para o ambiente atual. */
  readonly VITE_EXPECTED_FIREBASE_PROJECT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
