Camada de acesso a serviços externos (Firebase Auth, Firestore, Storage).

DEV-00.7: `firebase/` apenas cria as instâncias do SDK (sem leituras, gravações,
login ou uploads). Componentes React usam `getFirebaseDiagnostics()` e nunca
chamam o SDK diretamente.
