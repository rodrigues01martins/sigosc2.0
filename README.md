# SIGOSC 2.0

**Sistema de Gestão de Parcerias com Organizações da Sociedade Civil**

> **Estado atual: DEV-01.1 — autenticação inicial com Firebase Authentication (e-mail e senha).**
> As **100 funcionalidades homologadas** no Inventário Funcional V1.0 **ainda NÃO foram implementadas**.
> O repositório contém a infraestrutura do frontend, a autenticação inicial e páginas técnicas provisórias.
>
> ⚠️ **Autenticação ≠ autorização.** Estar autenticado apenas IDENTIFICA o usuário. Não concede acesso
> a OSCs, parcerias ou dados: as Security Rules continuam em negação integral.

## 1. Finalidade

O SIGOSC 2.0 é um sistema Web (SaaS Multi-Tenant) para gestão de parcerias entre
Organizações da Sociedade Civil (OSCs) e a Administração Pública, no contexto da
Lei Federal nº 13.019/2014 (Marco Regulatório das Organizações da Sociedade Civil — MROSC).

## 2. Tecnologias

| Camada | Tecnologia |
| --- | --- |
| Interface | React 19 + TypeScript 6 (modo estrito) |
| Desenvolvimento e build | Vite 8 |
| Autenticação | Firebase Authentication (e-mail e senha) — DEV-01.1 |
| Banco de dados (futuro) | Cloud Firestore |
| Arquivos (futuro) | Firebase Cloud Storage |
| Testes | `node:test` (lógica), Vitest + Testing Library + jsdom (interface), emuladores Firebase |
| Verificação estática | ESLint 10 + typescript-eslint (regras `strict`) + regras de React Hooks |
| Hospedagem | Vercel |
| Versionamento | GitHub |

Requisito de execução: Node.js `>= 22.12` (exigido pelo Vite 8).

## 3. Organização de diretórios

```
.
├── public/               # Arquivos estáticos servidos sem processamento (favicon)
├── src/
│   ├── assets/           # Imagens, ícones e fontes importados pelo código
│   ├── components/       # Componentes compartilhados (StatusCard, TechnicalPanel, AuthGate, AuthProvider)
│   ├── config/           # Configurações centrais (app.ts, firebase.ts)
│   ├── hooks/            # Hooks React (useAuthState, useAuthActions)
│   ├── layouts/          # Estruturas de página (BaseLayout)
│   ├── pages/            # Páginas (Home/: diagnóstico; Auth/: login, recuperação, sessão)
│   ├── services/         # Serviços externos (firebase/: inicialização; auth/: autenticação)
│   ├── styles/           # Estilos globais e variáveis de tema
│   ├── types/            # Tipos TypeScript compartilhados
│   ├── utils/            # Funções utilitárias puras (validation.ts)
│   ├── App.tsx           # Componente raiz
│   ├── main.tsx          # Ponto de entrada
│   └── vite-env.d.ts     # Tipagem das variáveis de ambiente VITE_*
├── tests/rules/          # Testes das Security Rules (emuladores)
├── tests/auth/           # Integração do Auth SDK real com o emulador do Auth
├── tests/support/        # Firebase Auth SDK simulado (testes)
├── firestore.rules       # Regras do Firestore (negação integral)
├── storage.rules         # Regras do Storage (negação integral)
├── firebase.json         # Regras + emuladores (sem projeto associado)
├── .env.example          # Nomes das variáveis do Firebase (sem valores)
├── eslint.config.js      # Verificação estática
├── index.html            # HTML base do Vite
├── tsconfig*.json        # TypeScript estrito (app e config do Vite)
└── vite.config.ts        # Configuração do Vite
```

Estilos de componentes usam **CSS Modules** (`*.module.css`), nativos do Vite — sem dependências extras.

## 4. Scripts disponíveis

| Script | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento com recarga automática |
| `npm run typecheck` | Verificação de tipos TypeScript (`tsc -b`) |
| `npm run lint` | Verificação estática com ESLint |
| `npm run build` | Verificação de tipos + build de produção em `dist/` |
| `npm run preview` | Serve localmente o conteúdo de `dist/` |
| `npm test` | Executa `test:unit` e `test:ui` |
| `npm run test:unit` | Testes de lógica com `node:test` (ambiente, inicialização, autenticação — SDK simulado) |
| `npm run test:ui` | Testes de interface React com Vitest + jsdom (SDK simulado) |
| `npm run test:auth` | Auth SDK real contra o emulador do Auth, projeto fictício `demo-sigosc-auth` (requer Java 21+) |
| `npm run test:rules` | Testes das Security Rules nos emuladores locais (requer Java 21+) |

## 5. Configuração futura do Firebase

O módulo `src/config/firebase.ts` lê as variáveis abaixo (prefixo `VITE_` é obrigatório para o Vite expô-las ao navegador):

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

- **Sem as variáveis**, a aplicação compila e funciona normalmente; `getFirebaseConfig()` retorna `null`.
- **Na Vercel**: cadastrar em *Project Settings → Environment Variables*.
- **Em desenvolvimento**: copiar `.env.example` para `.env.local` (ignorado pelo Git).

Regras de segurança:

- As variáveis do Firebase Web são **públicas** (vão para o bundle). Elas **não protegem dados**:
  a proteção depende das **Security Rules** do Firestore/Storage e da autenticação.
- Nunca versionar arquivos `.env*` com valores, chaves privadas ou contas de serviço.
- Nunca usar o **Firebase Admin SDK** no frontend.
- Os serviços são inicializados apenas quando a configuração é válida (ver 5.2); nenhuma operação de dados é executada.

### 5.1 Validação de ambiente (DEV-00.6.2)

Duas variáveis adicionais identificam o ambiente:

| Variável | Valor |
| --- | --- |
| `VITE_APP_ENV` | `test` (Preview/`develop`) ou `production` (Production/`main`) |
| `VITE_EXPECTED_FIREBASE_PROJECT_ID` | ID do projeto Firebase esperado para o ambiente |

A função pura `validateEnvironmentConfig` (`src/config/environmentValidation.ts`) classifica a configuração:

- **Válida** — 8 variáveis presentes, ambiente permitido e `VITE_FIREBASE_PROJECT_ID` idêntico ao esperado.
- **Incompleta** — há variáveis ausentes (vazias ou só com espaços).
- **Incompatível** — ambiente com valor não permitido ou ID do projeto divergente (prevalece sobre "Incompleta").

A validação não acessa a rede e **não comprova conexão real** com o Firebase.
Variáveis `VITE_` são públicas: nunca usá-las como mecanismo de autorização.

### 5.2 Inicialização dos serviços Firebase (DEV-00.7)

Estrutura em `src/services/firebase/`:

| Arquivo | Responsabilidade |
| --- | --- |
| `initialization.ts` | Lógica pura: bloqueia se a configuração não for "válida", reutiliza o App existente e isola falhas por serviço |
| `sdk.ts` | Adaptador do SDK modular oficial (`initializeApp`, `getAuth`, `getFirestore`, `getStorage`) |
| `index.ts` | Ponto único: `getFirebaseServices()` (instâncias) e `getFirebaseDiagnostics()` (somente estados), memoizados |

Distinções importantes:

- **Inicialização do SDK** ≠ **conectividade**: criar instâncias não faz requisições nem prova que os serviços respondem.
- **Storage**: `getStorage()` não verifica se o bucket existe. Bucket não provisionado só aparece na primeira operação real.
- **Autenticação** (identificar o usuário) foi implementada na DEV-01.1 (seção 6); **autorização** (acesso a dados) continua bloqueada pelas Security Rules.
- **Multi-Tenant**: o isolamento entre organizações NÃO existe ainda; depende de modelagem e de Security Rules futuras.

### 5.3 Security Rules (DEV-00.8)

`firestore.rules` e `storage.rules` aplicam **negação integral**: nenhuma leitura, listagem,
criação, atualização, exclusão, upload, download ou alteração de metadados pelo SDK cliente,
em qualquer caminho — **inclusive para usuários autenticados**. Regras Multi-Tenant
(por OSC, parceria ou usuário) serão criadas em evolução futura.

`firebase.json` registra as regras e os emuladores (Firestore e Storage). **Não existe
`.firebaserc`**: nenhum projeto é associado ao repositório; todo comando exige `--project` explícito.

**Testes (S01–S10):** `npm run test:rules` inicia os emuladores com o projeto fictício
`demo-sigosc-rules` (prefixo `demo-` impede acesso a projetos reais) e usa contextos de
autenticação simulados — nenhum usuário real é criado.

#### Publicação das regras no Firebase de TESTES (manual e controlada)

Pré-condições: `npm run test:rules` aprovado; projeto de destino confirmado como o de **testes**.
**Nunca publicar no projeto de produção nesta etapa.**

Opção A — Console Firebase (sem instalar nada):

1. Abrir o Console Firebase e selecionar o projeto de **testes** (conferir o ID no topo).
2. *Firestore Database → Regras*: copiar as regras atuais para registro, substituir pelo conteúdo de
   `firestore.rules` e clicar em **Publicar**.
3. *Storage → Regras*: idem com `storage.rules`. Se a aba *Storage* pedir "Vamos começar"/"Get started",
   o bucket **não está provisionado** — não crie agora; registre a situação.
4. Conferir na aba *Regras* que a versão publicada é a nova (histórico de versões à esquerda).

Opção B — Firebase CLI (projeto sempre explícito):

```bash
npx firebase login
npx firebase deploy --only firestore:rules,storage --project ID_DO_PROJETO_DE_TESTES
```

## 6. Autenticação (DEV-01.1)

### 6.1 Autenticação × autorização

| Conceito | Pergunta | Onde é decidido | Situação |
| --- | --- | --- | --- |
| **Autenticação** | Quem é você? | Firebase Authentication | Implementada (e-mail e senha) |
| **Autorização** | O que você pode acessar? | Security Rules no servidor + vínculos com OSCs | **Negação integral** — ninguém acessa dados |

O `AuthGate` só decide **qual página técnica a interface mostra**. Ele **não é mecanismo de
autorização**: qualquer código no navegador pode ser alterado pelo usuário. A proteção real dos
dados depende exclusivamente das Security Rules, que permanecem fechadas.

### 6.2 Fluxo

```
carregando ──► (sessão persistida?) ──sim──► página autenticada ──Sair──► login
     │                                                                    ▲
     └──não──► login ──Entrar──► página autenticada                       │
                 └──Esqueci minha senha──► recuperação ──Voltar ao login──┘
configuração inválida ──► diagnóstico técnico (autenticação bloqueada)
```

- **Sem cadastro público**: a aplicação não contém nenhuma função de criação de usuários.
  Contas são criadas manualmente no Console do Firebase.
- **Erros genéricos**: "E-mail ou senha incorretos." para qualquer rejeição de credenciais
  (não revela se a conta existe ou está desativada).
- **Recuperação de senha**: enviada pelo próprio Firebase (`sendPasswordResetEmail`); a confirmação
  é sempre a mesma, exista ou não a conta.
- **Sem logs**: senhas, e-mails, tokens e mensagens do SDK nunca são registrados.

### 6.3 Organização (`src/services/auth/`)

| Arquivo | Responsabilidade |
| --- | --- |
| `types.ts` | `AuthState`, `AuthUser`, `AuthResult`, `AuthErrorKind`, `AuthService` |
| `sdk.ts` | Adaptador do SDK modular: `setPersistence`, `signInWithEmailAndPassword`, `signOut`, `sendPasswordResetEmail`, `onAuthStateChanged` — e nada mais |
| `authService.ts` | Validação, persistência, chamadas ao SDK e conversão de resultados; indisponível se `auth === null` |
| `errors.ts` | Converte códigos `auth/*` em categorias seguras (descarta mensagens do SDK) |
| `authStore.ts` | Store para `useSyncExternalStore`, com **um único** observador ativo (seguro no StrictMode) |
| `index.ts` | Reutiliza a instância de Auth da DEV-00.7 (`getFirebaseServices().auth`) |

Componentes usam apenas `useAuthState()` e `useAuthActions()`; nenhum chama o SDK diretamente.

### 6.4 Política de sessão (inicial, sujeita a revisão)

- Persistência **LOCAL** (`browserLocalPersistence`): a sessão sobrevive a recarregar a página e
  a fechar o navegador, até o usuário clicar em **Sair**.
- Aplicada antes do primeiro login. Se o navegador bloquear o armazenamento, a sessão fica só em memória.
- Sem opção "lembrar-me" nesta etapa. Políticas de expiração serão definidas futuramente.

### 6.5 Configuração no Console do Firebase (projeto de TESTES)

1. *Authentication → Sign-in method*: ativar **E-mail/senha** (não ativar "link de e-mail").
2. *Authentication → Settings → User actions*: **desmarcar "Enable create (sign-up)"**. Sem isso,
   qualquer pessoa com a chave pública pode criar contas pela API REST, mesmo sem tela de cadastro.
   (Se a opção não aparecer, ela pode exigir o upgrade para Firebase Authentication with Identity Platform.)
3. *Authentication → Settings → User account management*: manter **Email enumeration protection** ativada.
4. *Authentication → Settings → Authorized domains*: adicionar o domínio de Preview da Vercel.
5. *Authentication → Templates → Password reset*: revisar idioma (português) e remetente.
6. *Authentication → Users → Add user*: criar manualmente as contas de teste.

## 7. Publicação na Vercel

1. Na Vercel, *Add New → Project* e importar o repositório `rodrigues01martins/sigosc2.0`.
2. A Vercel detecta o preset **Vite** automaticamente:
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`
3. Branch de produção: `main`. Cada push em `main` gera um deploy de produção; outros branches geram *preview deployments*.
4. Cadastrar as variáveis `VITE_FIREBASE_*` quando o projeto Firebase existir (exige novo deploy para valer).

**Por que não há `vercel.json`:** a aplicação possui uma única página, sem roteamento no cliente,
e o preset Vite da Vercel já define build e diretório de saída. Quando um roteador SPA for adotado,
será necessário adicionar uma regra de *rewrite* para `index.html`.

## 8. Estado atual

| Item | Situação |
| --- | --- |
| Frontend React + TypeScript + Vite | Inicializado |
| Página técnica de verificação | Implementada |
| Firebase SDK (App, Auth, Firestore, Storage) | Instâncias inicializadas quando a configuração é válida (DEV-00.7) |
| Security Rules Firestore/Storage (negação integral) | Criadas e testadas em emulador; publicação no Firebase de testes pendente |
| Autenticação (login, recuperação de senha, logout, sessão local) | Implementada (DEV-01.1) — interface técnica provisória |
| Autorização, vínculos com OSCs, permissões, Multi-Tenant, leituras/gravações | Não iniciados |
| 100 funcionalidades homologadas (Inventário V1.0) | **Não implementadas** |

Próximas etapas dependem de nova autorização.
