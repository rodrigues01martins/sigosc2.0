/**
 * Adaptador do Firebase Authentication SDK modular (oficial) — DEV-01.1.
 *
 * Expõe SOMENTE: persistência local, login com e-mail e senha, logout,
 * envio de e-mail de redefinição de senha e observação da sessão.
 * Não há criação de usuários, login anônimo, provedores sociais nem Admin SDK.
 */
import {
  browserLocalPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from 'firebase/auth'
import type { AuthSdk } from './authService.ts'

export const firebaseAuthSdk: AuthSdk<Auth> = {
  setLocalPersistence: (auth) => setPersistence(auth, browserLocalPersistence),
  signInWithEmailAndPassword: (auth, email, password) => signInWithEmailAndPassword(auth, email, password),
  signOut: (auth) => signOut(auth),
  sendPasswordResetEmail: (auth, email) => {
    // Idioma do e-mail enviado pelo Firebase (modelo configurado no Console).
    auth.languageCode = 'pt-BR'
    return sendPasswordResetEmail(auth, email)
  },
  onAuthStateChanged: (auth, next, error) => onAuthStateChanged(auth, next, error),
}
