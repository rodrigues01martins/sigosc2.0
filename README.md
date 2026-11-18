# SIGOSC 2.0

**Sistema de Gestão de Parcerias com Organizações da Sociedade Civil**

> **Estado atual: DEV-01.4 — integração inicial das interfaces homologadas de alta fidelidade (PAG-OSC01 a 03).**
> As **100 funcionalidades homologadas** no Inventário Funcional V1.0 **ainda NÃO foram implementadas**.
> O repositório contém a infraestrutura do frontend, a autenticação inicial e páginas técnicas provisórias.
>
> ⚠️ **Autenticação ≠ autorização.** Estar autenticado apenas IDENTIFICA o usuário. Não concede acesso
> a OSCs, parcerias ou dados. Desde a DEV-01.2, só há LEITURA da própria OSC por membros com
> vínculo ativo; todo o restante continua em negação integral.

## 1. Finalidade

O SIGOSC 2.0 é um sistema Web (SaaS Multi-Tenant) para gestão de parcerias entre
Organizações da Sociedade Civil (OSCs) e a Administração Pública, no contexto da
Lei Federal nº 13.019/2014 (Marco Regulatório das Organizações da Sociedade Civil — MROSC).

## 2. Tecnologias

| Camada | Tecnologia |
| --- | --- |
| Interface | React 19 + TypeScript 6 (modo estrito); Sistema de Design SIGOSC V1.0 (DS-05) com fonte Inter (SIL OFL 1.1, hospedada no próprio app) |
| Desenvolvimento e build | Vite 8 |
| Autenticação | Firebase Authentication (e-mail e senha) — DEV-01.1 |
| Banco de dados (futuro) | Cloud Firestore |
| Arquivos (futuro) | Firebase Cloud Storage |
| Testes | `node:test` (lógica), Vitest + Testing Library + jsdom (interface), emuladores Firebase |
| Verificação estática | ESLint 10 + typescript-eslint (regras `strict`) + regras de React Hooks |
| Hospedagem | Vercel (site estático + Funções de servidor em `api/`) |
| Operações privilegiadas | Firebase Admin SDK (somente em `api/`, nunca no navegador) |
| Versionamento | GitHub |

Navegação da Gestão da OSC por fragmento de URL (`#/identificacao`, `#/parcerias`, `#/usuarios`), sem necessidade de reescritas na Vercel.

Requisito de execução: **Node.js 24.x** (fixado em `package.json` → `engines`; a Vercel usa a mesma versão principal no build e nas funções). Compatível com Vite 8 (`^20.19 || >=22.12`) e Firebase Admin SDK 14 (`>=22`).

## 3. Organização de diretórios

```
.
├── public/               # Arquivos estáticos servidos sem processamento (favicon)
├── api/                  # Funções da Vercel: /api/osc-permissions, /api/osc-partnerships, /api/osc-work-plans
│   └── _lib/             # Lógica do servidor (não exposta como rota)
├── src/
│   ├── assets/           # Imagens, ícones e fontes importados pelo código
│   ├── components/       # Compartilhados (ds/: componentes do DS-05; osc/: contexto; AuthGate, providers)
│   ├── config/           # Configurações centrais (app.ts, firebase.ts)
│   ├── domain/           # Regras de negócio puras compartilhadas com o servidor (authorization.ts, partnerships.ts)
│   ├── hooks/            # Hooks React (useAuthState, useAuthActions)
│   ├── layouts/          # Estruturas de página (BaseLayout)
│   ├── pages/            # Páginas (Osc/: PAG-OSC01 a 03, partnerships/ PAG-OSC02/04; Auth/: login; Home/: diagnóstico)
│   ├── services/         # Serviços (firebase/, auth/, organizations/: vínculos, permissions/, partnerships/)
│   ├── styles/           # tokens.css (DS-05) e estilos globais
│   ├── types/            # Tipos TypeScript compartilhados
│   ├── utils/            # Funções utilitárias puras (validation.ts)
│   ├── App.tsx           # Componente raiz
│   ├── main.tsx          # Ponto de entrada
│   └── vite-env.d.ts     # Tipagem das variáveis de ambiente VITE_*
├── tests/rules/          # Testes das Security Rules (emuladores)
├── tests/auth/           # Integração do Auth SDK real com o emulador do Auth
├── tests/server/         # Operações privilegiadas (Admin SDK) nos emuladores
├── tests/support/        # SDKs simulados e dados fictícios (testes)
├── firestore.rules       # Regras do Firestore (negação por padrão + leituras Multi-Tenant)
├── firestore.indexes.json # Índice de grupo de coleções para members.uid
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
| `npm run test:auth` | SDKs reais (Auth + Firestore) contra os emuladores, projeto fictício `demo-sigosc-auth` (requer Java 21+) |
| `npm run test:server` | Operações privilegiadas (PER) com Admin SDK real nos emuladores, projeto `demo-sigosc-server` |
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
em qualquer caminho — **inclusive para usuários autenticados**. A DEV-01.2 acrescentou somente exceções de LEITURA
para a estrutura Multi-Tenant (ver seção 7.5); a negação por padrão continua valendo.

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

## 7. Estrutura Multi-Tenant (DEV-01.2)

### 7.1 Modelo de coleções

```
oscs/{oscId}                     ← OSC (dados institucionais mínimos)
oscs/{oscId}/members/{uid}       ← vínculo AUTORITATIVO (ID do documento = UID do Auth)
```

**`oscs/{oscId}`**

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `id` | string | Igual ao ID do documento |
| `name` | string | Nome institucional |
| `registrationStatus` | `pending` \| `active` \| `suspended` \| `inactive` | Situação cadastral/ativação |
| `commercialStatus` | `pending` \| `active` \| `suspended` \| `cancelled` | Situação comercial (independente das parcerias) |
| `administratorUid` | string \| null | **Fonte autoritativa** do administrador único |
| `createdAt`, `updatedAt` | timestamp | Datas |
| `createdBy`, `updatedBy` | string | UID do operador administrativo (rastreabilidade) |

**`oscs/{oscId}/members/{uid}`**

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `uid` | string | Igual ao ID do documento |
| `oscId` | string | Igual ao ID da OSC pai |
| `status` | `active` \| `inactive` | Situação do vínculo |
| `specialRole` | `administrator` \| null | **Espelho não autoritativo** de `administratorUid` (auditoria/consulta) |
| `createdAt`, `updatedAt`, `createdBy`, `updatedBy` | | Datas e autores |

Justificativa: o vínculo fica **dentro da OSC** (a organização é dona dos seus membros), o ID do
documento = UID impede vínculos duplicados na mesma OSC, e as regras consultam o caminho exato
`oscs/{oscId}/members/{request.auth.uid}` sem consultas adicionais. Nenhum modelo de parcerias,
financeiro, documentos ou prestação de contas foi criado.

### 7.2 Vínculos e administrador único

- Vínculos são **independentes por OSC**: inativar o vínculo em uma OSC não afeta as demais (teste MT09).
- **Desvinculação = `status: 'inactive'`**, sem excluir o documento: registros históricos preservam a
  identificação dos autores (UIDs continuam resolvíveis).
- **Administrador único**: `oscs/{oscId}.administratorUid` é um campo escalar → no máximo um por OSC
  por construção. O cliente considera administrador **somente** quem é `administratorUid` E tem vínculo ativo;
  o espelho `specialRole` nunca concede a função.
- Designação/substituição/revogação: futuras operações administrativas confiáveis (servidor, Admin SDK),
  em **transação** que atualize `administratorUid` e os espelhos `specialRole` juntos. Não implementadas.
- Nenhuma escrita pelo cliente: o usuário não cria vínculos nem se torna administrador (MT07, MT08).

### 7.3 Estratégia de consulta das OSCs do usuário

As Security Rules **não filtram** resultados: uma consulta só é aceita se a regra provar que
**todos** os documentos possíveis são autorizados. Alternativas avaliadas:

| Alternativa | Decisão |
| --- | --- |
| Índice `users/{uid}/memberships/{oscId}` | **Não adotado**: duplica vínculos (segunda fonte), exige escrita atômica dupla e cria risco de divergência |
| IDs das OSCs em *custom claims* | **Não adotado**: exige Admin SDK, limite de 1000 bytes e revogação atrasada até a renovação do token (até 1 h) |
| `collectionGroup('members').where('uid','==',uid)` | **Adotado**: fonte única e autoritativa; a regra `resource.data.uid == request.auth.uid` torna a consulta provável |

Fluxo: (1) consulta dos próprios vínculos; (2) `get` individual de `oscs/{oscId}` **apenas** para
vínculos ativos. Vínculos inativos não consultam a OSC (a interface mostra só o identificador).
Todas as leituras usam `getDocFromServer`/`getDocsFromServer` (nunca cache).

**Requisito do projeto real:** a consulta por grupo de coleções exige o índice de campo único
`members.uid` com escopo *collection group* (`firestore.indexes.json`). Sem ele, o Firestore
retorna `failed-precondition` e a interface informa "consulta não configurada".

### 7.4 Contexto da OSC ativa

`src/services/organizations/organizationStore.ts` (consumido por `OrganizationProvider` e
`useOrganizationState`/`useOrganizationActions`/`useActiveMembership`):

| Estado | Significado |
| --- | --- |
| `signed-out` | Sem sessão: contexto vazio |
| `loading` | Consultando vínculos |
| `ready` | `memberships`, `activeOscId`, `pendingOscId` (troca em validação), `selectionError` |
| `error` | `permission-denied`, `network`, `not-configured` ou `unknown` (com "Tentar novamente") |
| `unavailable` | Configuração Firebase inválida |

Comportamentos U01–U07: seleção automática com uma OSC; escolha entre várias; orientação sem vínculo;
inativos/OSC não ativada não selecionáveis; troca revalida o vínculo no servidor e remonta a área da OSC;
logout remove contexto e seleção guardada; sessão restaurada só reutiliza a OSC guardada se o vínculo,
consultado novamente, continuar válido. O navegador guarda **apenas o ID** da OSC selecionada
(`localStorage`, chave `sigosc:active-osc:{uid}`) — nunca usado como autorização.

### 7.5 Security Rules (DEV-01.2)

| Caminho | Permitido | Condição |
| --- | --- | --- |
| `oscs/{oscId}` | `get` | vínculo próprio com `status == 'active'`, `uid` e `oscId` consistentes |
| `oscs/{oscId}/members/{uid}` | `get` | `uid == request.auth.uid` (ativo ou inativo) |
| `{**}/members/{uid}` | `list` | consulta filtrada por `uid == request.auth.uid` |
| Todo o resto | — | **negado** (inclusive qualquer escrita e a listagem de `oscs`) |

O Storage **não foi alterado** (negação integral).

### 7.6 Publicação das regras e do índice no Firebase de TESTES (manual)

Pré-condição: `npm run test:rules` e `npm run test:auth` aprovados. **Nunca publicar em produção.**

1. Console Firebase → selecionar o projeto de **testes** (conferir o ID).
2. *Firestore Database → Regras*: copiar as regras atuais (registro), colar `firestore.rules`, **Publicar**.
3. *Firestore Database → Índices → Campo único → Adicionar isenção*: coleção `members`, campo `uid`,
   escopo **Grupo de coleções**, ordem crescente **ativada**. Aguardar o status "Ativado".
4. Alternativa por CLI (projeto sempre explícito):
   `npx firebase deploy --only firestore:rules,firestore:indexes --project ID_DO_PROJETO_DE_TESTES`

Até a publicação, a interface no Preview mostrará "acesso negado pelas regras de segurança" — comportamento
esperado e seguro (as regras antigas negam tudo).

### 7.7 Provisionamento de OSCs fictícias no Firebase de TESTES (manual, administrativo)

A criação de OSCs e vínculos é privilegiada e **não existe no frontend**. Sem credenciais no repositório,
o procedimento é feito no Console (o Console grava com privilégio administrativo e ignora as regras):

1. *Authentication → Users*: criar (ou reutilizar) 3 contas de teste e anotar os **UIDs**:
   `UID_MULTI` (duas OSCs), `UID_SINGLE` (uma OSC), `UID_NONE` (sem vínculo — não criar documentos).
2. *Firestore Database → Dados → Iniciar coleção* `oscs`, criando os documentos (ID = valor de `id`):

| ID | name | registrationStatus | commercialStatus | administratorUid |
| --- | --- | --- | --- | --- |
| `osc-teste-alfa` | OSC Fictícia Alfa (TESTE) | `active` | `active` | `UID_MULTI` |
| `osc-teste-beta` | OSC Fictícia Beta (TESTE) | `active` | `suspended` | *null* |
| `osc-teste-gama` | OSC Fictícia Gama (TESTE) | `active` | `active` | `UID_SINGLE` |

   Em cada documento incluir também `id` (string), `createdAt`/`updatedAt` (timestamp) e
   `createdBy`/`updatedBy` (string, ex.: `provisionamento-manual-teste`).
3. Em cada OSC, criar a subcoleção `members` com documentos cujo **ID é o UID**:

| OSC | ID do documento | uid | oscId | status | specialRole |
| --- | --- | --- | --- | --- | --- |
| `osc-teste-alfa` | `UID_MULTI` | `UID_MULTI` | `osc-teste-alfa` | `active` | `administrator` |
| `osc-teste-beta` | `UID_MULTI` | `UID_MULTI` | `osc-teste-beta` | `active` | *null* |
| `osc-teste-gama` | `UID_MULTI` | `UID_MULTI` | `osc-teste-gama` | `inactive` | *null* |
| `osc-teste-gama` | `UID_SINGLE` | `UID_SINGLE` | `osc-teste-gama` | `active` | `administrator` |

4. Validar no Preview: `UID_MULTI` vê Alfa e Beta selecionáveis e Gama inativa (sem nome);
   `UID_SINGLE` entra com Gama selecionada; `UID_NONE` vê a orientação sem vínculo.

Valores devem ser **exatos** (minúsculas, sem espaços): documentos fora do formato são descartados
pelo cliente (falha fechada). Os mesmos cenários existem em `tests/support/organizationFixtures.ts`
para os emuladores.

## 8. Permissões individuais e controle de acesso (DEV-01.3)

### 8.1 Camadas de autorização

| Camada | Fonte autoritativa | Concede |
| --- | --- | --- |
| Identidade | Firebase Authentication | **Nada** sozinha |
| Vínculo ativo | `oscs/{oscId}/members/{uid}.status` | Requisito de qualquer operação na OSC |
| Administrador único | `oscs/{oscId}.administratorUid` | Gestão de permissões e delegação; **sem** permissões operacionais implícitas |
| Delegação | `members/{uid}.canManagePermissions` | Conceder/revogar permissões operacionais de terceiros |
| Permissões operacionais | `members/{uid}.permissions` | Capacidades nos módulos (alcance: toda a OSC) |
| Situação comercial | `oscs/{oscId}.commercialStatus` | `suspended` bloqueia alterações e operação |

O avaliador único fica em `src/domain/authorization.ts` (sem dependências): a interface o usa só para
decidir o que **exibir**; o servidor o aplica com dados lidos **na hora** do Firestore. `specialRole`
continua sendo apenas espelho — nunca concede autoridade.

### 8.2 Extensão do vínculo (compatível com a DEV-01.2)

| Campo novo | Tipo | Finalidade |
| --- | --- | --- |
| `permissions` | array de IDs do catálogo | Permissões operacionais individuais |
| `canManagePermissions` | boolean | Delegação (só `true` concede) |
| `permissionsUpdatedAt` / `permissionsUpdatedBy` | timestamp / uid | Autoria da última alteração de permissões |
| `delegationUpdatedAt` / `delegationUpdatedBy` | timestamp / uid | Autoria da última alteração de delegação |

Auditoria imutável: `oscs/{oscId}/permissionEvents/{id}` (ação, permissão, solicitante e sua autoridade,
alvo, antes/depois, data), gravada na **mesma transação** da alteração; ilegível e não gravável pelo cliente.

Documentos legados (sem os campos) continuam válidos e resultam em **nenhuma** permissão. Valores
desconhecidos, textos livres ou tipos errados são descartados (falha fechada). Não há migração.

### 8.3 Catálogo inicial

IDs estáveis `modulo.capacidade`. Não existem IDs genéricos (`admin`, `all`, `*`).

| Módulo | Concedível agora | Pendente de especificação (não concedível) |
| --- | --- | --- |
| Gestão de usuários e permissões | — (gestão é competência do administrador/delegado) | `users.invite` |
| Gestão de parcerias | `partnerships.view`, `partnerships.create`, `partnerships.edit` (DEC-PAR-001) | — |
| Plano de Trabalho | `work-plan.view`, `work-plan.edit` (iniciar, editar, finalizar e corrigir — DEC-PT-001); `work-plan.finalize` descontinuada | — |
| Execução e Monitoramento | `execution.view` | `execution.edit` |
| Gestão Financeira | `financial.view` | `financial.edit` |
| Gestão Documental | `documents.view` | `documents.edit` |
| Prestação de Contas | `accountability.view` | `accountability.edit` |

**Atenção:** o Inventário Funcional V1.0 não está no repositório. As capacidades de **consulta**
foram as únicas consideradas de semântica segura; todas as demais aguardam especificação a partir
do Inventário antes de se tornarem concedíveis. O catálogo não concede nada automaticamente.

### 8.4 Competências

- **Administrador** (com vínculo ativo, OSC ativa): consulta a relação de usuários; concede/revoga
  permissões e delegação de **outros** membros; exporta a relação (CSV).
- **Delegado**: consulta a relação e concede/revoga permissões operacionais de **outros** membros, exceto
  do administrador. Não concede/revoga delegação (sem subdelegação), não altera a si mesmo nem o administrador.
- **Ninguém** altera as próprias permissões ou delegação. Concessões exigem alvo com vínculo ativo;
  revogações também valem para vínculos inativos (redução de privilégios).
- **Suspensão comercial**: bloqueia todas as alterações (inclusive do administrador) e a operação;
  o administrador mantém **somente** consulta e exportação; delegados e operadores ficam bloqueados.
- Exclusivos da administração da plataforma (sem rota): designar/substituir administrador, ativar OSC,
  alterar situação comercial, criar vínculos.

### 8.5 Operações privilegiadas (servidor)

**Escolha:** Funções de servidor da **Vercel** (`api/osc-permissions.ts`), na mesma plataforma já
aprovada. Firebase Cloud Functions exigiriam o plano Blaze; não há segunda plataforma de backend.

| Requisição | Operação |
| --- | --- |
| `GET /api/osc-permissions?oscId=…` | P02 — relação de usuários e permissões |
| `POST` `{oscId, targetUid, action, permission?}` | P03–P06 (`grant-permission`, `revoke-permission`, `grant-delegation`, `revoke-delegation`) |

Cada requisição: token de ID verificado com `checkRevoked` → parâmetros validados por formato estrito
(campos extras recusados) → OSC, vínculo do solicitante e do alvo **relidos** dentro de uma **transação**
→ decisão do avaliador → escrita + auditoria atômicas. Respostas: 200, 400, 401, 403/404 (com motivo),
405, 503 (não configurado), 500 (sem detalhes). Sem CORS (mesma origem), `Cache-Control: no-store`.

#### Compatibilidade ESM/CommonJS do servidor (DEV-01.3-FIX01)

Cadeia: `firebase-admin@14` (CommonJS) → `jwks-rsa@4` (CommonJS) → `require('jose')`, e o `jose@6` é
**somente ESM**. Isso depende do recurso `require(esm)` do Node; sem ele, a função falhava com
`ERR_REQUIRE_ESM` antes de responder (observado no Preview).

Correção (`api/_lib/esmInterop.ts`): antes de carregar o Admin SDK, o servidor importa o `jose`
como ESM a partir do **mesmo arquivo** que o `jwks-rsa` resolve e o registra no `require.cache`
(mecanismo documentado do Node). O Admin SDK passa a ser carregado **sob demanda**, sempre depois
dessa preparação. Versões, `node_modules` e a verificação de tokens permanecem inalterados.

Além disso, `engines.node` passou de `>=22.12.0` (que fazia a Vercel adotar automaticamente a
versão principal mais nova) para `24.x`, evitando trocas inesperadas de runtime.

Regressão: `tests/server/esmCompat.test.ts` executa a função num Node **sem** `require(esm)`.

### 8.6 Security Rules (DEV-01.3)

**Nenhuma nova exceção.** O dono continua lendo o próprio vínculo (agora com `permissions` e
`canManagePermissions`); vínculos de terceiros, auditoria e qualquer escrita continuam negados.
Foram acrescentadas as funções `canOperate(oscId)` e `hasPermission(oscId, permissao)`, ainda sem uso,
para as regras dos módulos futuros (validadas por teste de sonda). Storage inalterado.

### 8.7 Implantação no Firebase/Vercel de TESTES (manual)

**Situação:** nada foi publicado. O push para `develop` gera um Preview que **inclui a função**, porém
**inerte** (responde 503) até a etapa 3. A interface mostra "indisponível" — nunca sucesso simulado.

1. **Regras:** as regras da DEV-01.3 mudaram apenas comentários e funções ainda sem uso. Publicar
   `firestore.rules` no projeto de **testes** (mesmo procedimento da seção 7.6) para mantê-las alinhadas.
2. **Conta de serviço dedicada (Google Cloud Console → IAM → Contas de serviço)** no projeto de **testes**:
   criar `sigosc-permissions-preview` com os papéis mínimos **Cloud Datastore User**
   (`roles/datastore.user`) e **Firebase Authentication Viewer** (`roles/firebaseauth.viewer`);
   gerar uma chave JSON. **Não** usar a conta padrão `firebase-adminsdk` (privilégios amplos).
   Nunca enviar a chave por chat, e-mail ou commit.
3. **Vercel → Settings → Environment Variables**, marcando **apenas Preview** (e, se possível, "Sensitive"):
   `SIGOSC_SERVER_ENV=test`, `SIGOSC_FIREBASE_PROJECT_ID`, `SIGOSC_FIREBASE_CLIENT_EMAIL`,
   `SIGOSC_FIREBASE_PRIVATE_KEY` (valor `private_key` do JSON). Depois, apagar o arquivo JSON local.
   **Não** configurar em Production: sem `SIGOSC_SERVER_ENV=test` a API permanece desativada.
4. Gerar novo deploy de Preview (redeploy) para carregar as variáveis.
5. Validar com as contas de teste (seção 8.8).

Revogação/rotação: desativar a chave na conta de serviço e remover as variáveis da Vercel.
Evolução recomendada: federação de identidade (OIDC Vercel → Google Cloud) para eliminar chaves longas.

### 8.8 Dados de teste (aditivo e reversível)

Os documentos da DEV-01.2 **não precisam de alteração** (sem campos → sem permissões). Para validar a
gestão, `osc-teste-alfa` precisa de outros membros além do administrador. Procedimento opcional:

1. *Authentication*: criar as contas `UID_DELEGADO` e `UID_OPERADOR` (novas; não reutilizar SINGLE/NONE,
   para não alterar os cenários homologados).
2. *Firestore*: criar `oscs/osc-teste-alfa/members/UID_DELEGADO` e `.../UID_OPERADOR` com `uid`, `oscId`
   (`osc-teste-alfa`), `status` (`active`), `specialRole` (*null*), datas e autores (como na seção 7.7).
   Opcional: `canManagePermissions: true` no delegado (ou concedê-la pela interface, como administrador).
3. Para testar a suspensão (PER-14/15) **temporariamente**: anotar o valor atual e alterar
   `oscs/osc-teste-alfa.commercialStatus` para `suspended`; ao final, **restaurar** `active`.
4. **Reversão:** excluir os dois documentos de vínculo e as contas criadas; para remover permissões
   gravadas nos vínculos existentes, excluir os campos `permissions`, `canManagePermissions`,
   `permissionsUpdated*`, `delegationUpdated*`; a subcoleção `permissionEvents` pode ser mantida
   (histórico) ou excluída.

### 8.9 Decisões a confirmar (aplicadas de forma conservadora)

- Permissões operacionais do administrador: decididas pela DEC-PAR-002 (somente a Administração da
  Plataforma; operação ainda não implementada — 10.9). Hoje ninguém pelo sistema: o próprio
  administrador não (proibição de autoalteração) e o delegado não (proteção do administrador).
- Situação cadastral diferente de `active` bloqueia toda a gestão, inclusive consulta.
- Granularidade das permissões por módulo (consulta × edição × aprovação) depende do Inventário V1.0.

## 9. Interface homologada da Gestão da OSC (DEV-01.4)

### 9.1 Referências efetivamente consultadas

Canvas de design "SIGOSC 2.0 — PRT-G01 Gestão da OSC" (artefato `3cbd679c-…`), lido sem alteração:

| Referência | Uso |
| --- | --- |
| **HF-G05** (homologado por HF-V06) | Referência visual **mais recente** de PAG-OSC01 a 03; renderizado localmente e medido (estilos computados) |
| HF-G01 (HF-V02) e relatórios HF-G02 a G05 | Confronto: OSC01–03 idênticas desde HF-G01 (AJ-HF-G03-02 removeu a alternância de fidelidade) |
| DS-05 Partes 1 e 2 (Sistema de Design V1.0) | Paleta, tipografia, espaçamento, raios, sombras, foco → `src/styles/tokens.css` |
| DS-05 Partes 3–6, AF-01, PD-01-P01 | Componentes DSC, lacunas e achados posteriores (registrados em 9.4) |
| HF-IN01 | **Não utilizado**: artboard consolidado ainda "Candidato à Homologação" |
| Protótipo de baixa fidelidade (Main) | **Não utilizado** (registro histórico) |

O tema "Aprendiz do Futuro" anexado ao canvas pertence a outro produto e **não** foi usado.

### 9.2 Implementado

- `OscShell`: sidebar verde-petróleo (248 px, raio 20), marca, bloco de contexto, seleção da OSC
  (automática com vínculo único; `<select>` com vários), navegação com estado ativo (`aria-current`,
  marcador dourado), cabeçalho (título 28/36, selo "Gestão da OSC", usuário, Sair), faixa de contexto.
- **PAG-OSC01**: dados reais da OSC (nome, situação cadastral, selo "OSC · situação comercial",
  administrador único pela fonte autoritativa, vínculo do usuário), permissões do usuário e ações.
- **PAG-OSC02**: estrutura visual com **estado indisponível**; pesquisa e "Cadastrar parceria"
  desabilitados e identificados como aguardando implementação. Nenhuma parceria, coleção ou simulação.
- **PAG-OSC03**: matriz de usuários × permissões (UX-001, seção 9.6), delegação **via servidor** com
  confirmação, exportação CSV, suspensão comercial (somente consulta para o administrador; bloqueio
  para os demais, DSC-FBK-06/07).
- Estados: carregando, erro de consulta (com nova tentativa), sem vínculo, vínculo inativo/OSC
  indisponível, escolha de OSC, suspensão, sessão encerrada.

### 9.3 Correspondência com o DS-05

Cores, tipografia (Inter 400–700; 28/36, 20/28, 16/24, 14/22, 13/20, 12/16), espaçamentos (4–32),
raios (8/12/16/20/pílula), sombra `shadow.sm`, foco (`secondary.600` 3 px; `accent.300` na sidebar),
altura de controle 40 px e alvo mínimo 44 px. Nenhum valor foi criado fora do DS-05.

### 9.4 Diferenças em relação ao protótipo homologado

| Item | Protótipo (HF-G05) | Implementação | Motivo |
| --- | --- | --- | --- |
| Barra "Controle de simulação", "Estrutura ilustrativa", códigos WF/PAG, rastreabilidade | Presentes | Ausentes | Elementos de protótipo, fora do produto (AF-01-05) |
| CNPJ e quantidade de parcerias (OSC01) | Exibidos | Ausentes | Não existem no modelo de dados (sem dados inventados) |
| Situação cadastral (OSC01) | Ausente | Exibida | Exigida pela DEV-01.4 (dado real) |
| Administrador único (OSC01) | Nome | "Você" / "Designado pela administração da plataforma" | Nome de terceiros não é legível pelo cliente (Security Rules) |
| Lista de parcerias, pesquisa, seleção (OSC02) | Dados fictícios e operações simuladas | Dados reais da OSC (DEV-02.1); "Cadastrar parceria" substituído pela pendência | Cadastro não especificado (10.7) |
| Administrador "Todas as operacionais" (OSC03) | Sim | Contagem real das permissões | Regra da DEV-01.3: administrador **sem** permissões implícitas |
| Catálogo de permissões (OSC03) | 15 permissões | 6 permissões de consulta | Catálogo vigente (DEV-01.3); alinhamento pendente — ver 9.5 |
| Convidar / Desvincular usuário | Botões (simulação) | Não exibidos; aviso de implementação futura | Funcionalidades não implementadas |
| Conceder/Revogar delegação, Exportar CSV | Ausentes | Presentes | Funcionalidades homologadas na DEV-01.3 |
| OSC03 durante suspensão (administrador) | Página oculta | Somente consulta + exportação | Decisão funcional de suspensão (consulta e exportação pelo administrador) |
| Vínculo inativo na tabela | Não representado | "Vínculo inativo" | Dado real; inativos só podem ter permissões revogadas |
| Sair e identificação do usuário | Avatar e "Usuário da OSC" | E-mail, avatar e botão "Sair" | Logout obrigatório (DEV-01.1) |
| Rodapé da sidebar | "Estrutura ilustrativa" | Ambiente e versão técnica | Identificação do ambiente (DEV-01.1) |
| Tabela | Grade de `div` | `<table>` semântica | Acessibilidade (AF-01-22) |
| Fluxo de alteração de permissão (OSC03) | Painel "Ações autorizadas" + 3 passos | Matriz com um clique por célula (UX-001) | Simplificação solicitada na UX-001 |
| Larguras intermediária/estreita (P08) | Não aplicadas | Quebra natural do flex, como no protótipo | P08 permanece hipótese pendente (L4/L5/L10) |

### 9.5 Pendências para homologação

- Validar visualmente no Preview com as contas de teste reais.
- **Catálogo de permissões**: o HF-G05 mostra 15 permissões nomeadas (ex.: "Cadastrar parceria",
  "Registrar e editar receitas e despesas"); o catálogo vigente tem 6 de consulta. Alinhar exige
  decisão e nova evolução (não alterado nesta etapa).
- Decidir a exibição do nome do administrador único para não administradores.
- Lacunas abertas do DS-05 (tokens destrutivos L11, layout P08, confirmação PD-01-D06).

### 9.6 Matriz de usuários e permissões (UX-001)

- **Estrutura:** linhas = usuários (nome, competência, situação do vínculo); colunas = permissões do
  **catálogo vigente** (6), agrupadas pelo módulo; coluna "Delegação" visível apenas ao administrador.
- **Um clique** concede ou revoga a permissão operacional, sem confirmação. A ação decorre do estado
  atual da célula, e a célula só muda após resposta positiva do servidor (estado confirmado devolvido
  pela API `/api/osc-permissions`, que não foi alterada).
- **Delegação** continua separada e exige confirmação explícita (usuário, OSC, competência e consequência).
- **Estados da célula:** concedida, não concedida, processando, bloqueada (sem autorização, próprio
  usuário, administrador, vínculo inativo) e bloqueada por suspensão; falha preserva o estado e
  permite nova tentativa.
- **Concorrência:** requisições duplicadas bloqueadas por célula; respostas obsoletas descartadas ao
  trocar de OSC ou sair; negação do servidor recarrega os dados da fonte confiável.
- **Responsividade:** tabela com primeira coluna fixa e rolagem horizontal a partir de 720 px;
  cartões por usuário abaixo disso (verificado em 320, 375, 768 e 1440 px).
- **Acessibilidade:** botões com `aria-pressed` e nome acessível "permissão — usuário: estado";
  foco mantido durante o processamento; anúncios em `role="status"`/`role="alert"`; sem violações
  no axe-core (WCAG 2.2 AA).

## 10. Gestão de Parcerias (DEV-02.1 e complemento C01)

**Situação (C01):** consulta, pesquisa, seleção, identificação, **cadastro real** (`partnerships.create`) e
**correção cadastral limitada** (`partnerships.edit`) implementados e habilitados pelo servidor, com as
decisões **DEC-PAR-001 a DEC-PAR-006**. **Validados em emuladores**; ainda **não validados no Preview**
(dependem de 10.8). A DEV-02.1 **não** está homologada.

### 10.1 Referências consultadas

| Referência | Uso | Observação |
| --- | --- | --- |
| HF-G05 (homologado por HF-V06), PAG-OSC02 e PAG-OSC04 | Layout da lista (colunas Parceria/instrumento, Vigência, Situação, Acesso; "Selecionar"/"Selecionada"), campos da Identificação da Parceria, rótulos de situação | No protótipo, "Cadastrar parceria" exibe **"Cadastro de parceria fora do escopo deste incremento (PRT-G01): operação não simulada"** |
| AF-01, entregas 2 a 6 | MT-3 (troca de OSC descarta a parceria), MT-4 (só parcerias da OSC), NV-1 (PAG-OSC02 → PAG-OSC04 direto), NV-2 (parceria mantida entre páginas), AF-01-08/11 | AF-01 está "Candidata à Validação" (aguarda AF-V01) |
| PD-01-P01 (relatório parcial) | Decisões pendentes PD-01-D01 a D05; "Modelo de permissões consolidado: **não verificável**" | Não concluído: a Frente A (inventário FUN) está suspensa |
| DS-05 Parte 2 | `status.partnership.*` (Em execução, Suspensa, Arquivada) | "Encerrada" não tem token (AF-01-11): usa o estilo neutro de Arquivada |
| Inventário Funcional V1.0 (FUN) e Modelo de Negócio | **Não localizados** (repositório, canvas e Google Drive) | Os identificadores RC-004 a RC-019 do pedido vêm de inventário reconstruído e **não** substituem os FUN |

### 10.2 Matriz de campos do cadastro (C01)

Fonte: **H** protótipo homologado (HF-G05); **L** Lei 13.019/2014; **D** decisões DEC-PAR; **T** limite técnico.
As regras técnicas anteriores incompatíveis com a DEC-PAR-005 foram **removidas**: data mínima 23/01/2016,
início ≥ formalização, término ≥ hoje, objeto com 10 caracteres, valor global obrigatório e unicidade.

| Campo | Tipo | Obrigatório | Fonte | Validação | TC | TF | AC | Correção cadastral |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `instrument` | TC \| TF \| AC | Sim | H, L, D-005 | Só os três | ✓ | ✓ | ✓ | Protegido |
| `instrumentNumber` | texto | Sim | H | 1–60 (T), sem caracteres de controle | ✓ | ✓ | ✓ | Editável |
| `publicPartner` | texto | Sim | H | 1–300 (T) | ✓ | ✓ | ✓ | Editável |
| `object` | texto | Sim | H | 1–4000 (T), sem mínimo jurídico | ✓ | ✓ | ✓ | Editável |
| `administrativeProcess` | texto ou nulo | Não | H | até 100 (T) | ✓ | ✓ | ✓ | Editável |
| `formalizationDate` | data | Sim | H, D-005 | Real, não futura; < 23/01/2016 → **aviso** | ✓ | ✓ | ✓ | Protegido |
| `termStart` | data | Sim | H, D-004 | Real; anterior à formalização → **aviso** | ✓ | ✓ | ✓ | Protegido |
| `termEnd` | data | Sim | H, D-004 | Real; não anterior ao início (pode estar encerrada) | ✓ | ✓ | ✓ | Protegido |
| `globalValueStatus` | `informed` \| `not-informed` \| `not-applicable` | Sim (TC/TF escolhem; AC = não aplicável) | D-005 | AC só `not-applicable` | ✓ | ✓ | ✓ | Protegido |
| `globalValueCents` | inteiro ou nulo | Só se `informed` | H, D-005 | Inteiro ≥ 0 (zero → **aviso**); nulo nos demais | ✓ | ✓ | — | Protegido |
| `administrativeStatus` | 4 situações | Sim, **sem padrão** | D-006 | Declarada; não calculada | ✓ | ✓ | ✓ | Protegido |
| `workPlan.approvalDeclared` | `true` | Sim | P | Declaração | ✓ | ✓ | ✓ | Protegido |

Avisos não impedem o cadastro: apontam situação documental a conferir. Campos protegidos na correção
podem configurar alteração formal (aditivo, prorrogação, apostilamento) ou transição de situação.

### 10.3 Modelo no Firestore (esquema 2)

```
oscs/{oscId}/partnerships/{id}           schemaVersion 2, id, oscId, campos de 10.2,
                                         administrativeStatusSource 'declared-at-registration',
                                         administrativeStatusDeclaredAt/By, workPlan {approvalDeclared,
                                         document 'not-incorporated', declaredAt, declaredBy},
                                         duplicateCheckKey, creationRequestId, revision,
                                         createdAt/By, updatedAt/By, lastUpdateRequestId
oscs/{oscId}/partnershipEvents/{id}      action 'create' | 'update', partnershipId, actorUid, actorAuthority,
                                         administrativeStatus (create), duplicateAcknowledged (create),
                                         fields + fromRevision/toRevision (update), at — sem conteúdo textual
oscs/{oscId}/partnershipRequests/{uid}_{requestId}   marcador de idempotência (só servidor)
```

Alterações em relação à DEV-02.1 (sem migração: nenhuma parceria real foi gravada, pois o cadastro estava
bloqueado): `uniqueKey` → `duplicateCheckKey` (conferência, **não** unicidade); `globalValueStatus`,
`revision`, campos de declaração e o marcador são novos. A leitura aceita documentos do esquema 1, sem
inventar valores (valor ausente → "não informado").

### 10.4 Security Rules

```
match /oscs/{oscId}/partnerships/{partnershipId} {
  allow get, list: if canConsult(oscId, 'partnerships.view');
}
```

`canConsult` exige: vínculo ativo e consistente, OSC ativa, a permissão individual `partnerships.view`
e, durante a suspensão comercial, que o solicitante seja o administrador único (regra homologada "AO:
consultar/exportar"). **Nenhuma escrita** pelo cliente; `partnershipEvents` continua ilegível; consulta por
grupo de coleções negada. O avaliador de domínio ganhou a operação equivalente `consult`.
C01: **nenhuma nova exceção**. `partnerships.create`/`edit` não liberam leitura nem escrita direta;
os marcadores de idempotência (`partnershipRequests`) também ficam negados ao cliente.

### 10.5 Permissões (DEC-PAR-001 e DEC-PAR-002)

| Operação | Exige | Decidida em |
| --- | --- | --- |
| Consultar, pesquisar, selecionar | `partnerships.view` | Security Rules + interface |
| Cadastrar | `partnerships.create` (não `edit`, não `view`) | Servidor (`POST /api/osc-partnerships`) |
| Corrigir dados cadastrais | `partnerships.edit` (não `create`); parceria não arquivada | Servidor (`PATCH /api/osc-partnerships`) |
| Qualquer gravação durante suspensão comercial | — (negada a todos, inclusive administrador) | Servidor |

As três competências são independentes e concedidas um a um pela matriz da UX-001 (um clique). Nenhuma
foi concedida automaticamente. **Permissões do administrador único** só podem ser alteradas pela
Administração da Plataforma (DEC-PAR-002): o avaliador nega a qualquer outro (`self-modification` para ele
próprio, `target-is-administrator` para os demais), e a matriz mostra "Adm. da Plataforma". Essa operação
da Administração da Plataforma **não existe** (10.9).

### 10.6 Jornada (PAG-OSC02 → PAG-OSC04)

1. **Parcerias** (PAG-OSC02): lista paginada da OSC ativa, pesquisa imediata (instrumento, número,
   objeto, órgão; sem acentos e sem diferença de maiúsculas), situação e vigência visíveis sem abrir nada.
2. **Selecionar** (um clique): define o contexto e abre diretamente a **Identificação da Parceria** (NV-1),
   em `#/parcerias/{id}`.
3. A faixa de contexto mostra "Parceria: Termo de Fomento 02/2026 · Suspensa" em todas as páginas; a barra
   lateral ganha "Identificação da parceria" (NV-2).
4. **Troca de OSC**: a parceria é descartada, a navegação volta à lista e a nova OSC é consultada (MT-3).
5. **URL manipulada**: o identificador é sempre consultado sob a OSC ativa; parceria de outra OSC aparece
   como "Parceria não encontrada nesta OSC", sem dados (as regras também negam).

**PAG-OSC04:** consulta da identificação (dados, situação e período, instrumento), situação **declarada**
(data e autor), faixa de **arquivada** e, com `partnerships.edit`, "Corrigir dados cadastrais" (10.6-A).
As abas "Dados Complementares" e "Situação e Histórico", prorrogação, alteração formal, transições de
situação e arquivamento **não** foram implementados nem exibidos como botões. A página não é a PAG-OSC04
homologada completa.

**10.6-A Cadastro pela PAG-OSC02** (com `partnerships.create`): "Cadastrar parceria" abre o formulário na
mesma página (grupos: instrumento, identificação, datas, valor global, situação, declaração). Sucesso só após
a resposta do servidor; com `partnerships.view`, a identificação criada abre diretamente; sem ela, o usuário
vê a confirmação e a orientação para obter a consulta (que **não** é concedida automaticamente). Quem tem só
`partnerships.create` vê o formulário, mas não a lista.

Abaixo de 720 px, a lista vira cartões (mesmo ponto de troca da UX-001), com botões de 44 px.

### 10.7 Situações administrativas, idempotência e duplicidade

| Situação | Cadastro | Correção cadastral / novos registros |
| --- | --- | --- |
| Em execução | Permitido | Permitida conforme permissão |
| Suspensa (DEC-PAR-003) | Permitido | Permitida: sem bloqueio automático geral; identificada claramente |
| Encerrada | Permitido | Permitida: registros complementares e prestação de contas não são presumidos bloqueados |
| Arquivada | Permitido (incorporação histórica) | **Bloqueada** (`partnership-archived`); consulta preservada; desarquivar só pela Administração da Plataforma |

- **Idempotência**: o marcador `{uid}_{requestId}` é criado na mesma transação do cadastro. Reenvios
  sequenciais e **concorrentes** do mesmo pedido devolvem a mesma parceria (testado com 5 envios simultâneos).
- **Possível duplicidade**: mesmo instrumento + número + órgão (normalizados) gera **aviso** (409
  `possible-duplicate`) com dados para conferência e indicação "mesmas datas: provável recadastramento".
  O usuário pode confirmar ("instrumento distinto"), e a confirmação fica na auditoria. Quem não tem
  `partnerships.view` recebe só a contagem. Não há bloqueio definitivo.
- **Correção**: controle por `revision`; correções simultâneas → uma aplicada, a outra recebe `stale`
  (os valores digitados são mantidos e os dados recarregados).

### 10.8 Implantação e validação no Firebase/Vercel de TESTES (manual)

Nada foi publicado. Para o Preview:
1. **Regras**: publicar `firestore.rules` no projeto de **testes** (`sigorsc-testes`) pelo procedimento de 7.6.
   Efeito: habilita a **leitura** de parcerias por quem tem `partnerships.view`; nenhuma escrita pelo
   cliente; demais caminhos inalterados. Sem índices novos.
2. **Função**: as variáveis da 8.7 já usadas por `/api/osc-permissions` servem para `/api/osc-partnerships`;
   nenhuma credencial nova. Conferir que o Preview responde 401 (sem token) e não 503.
3. **Permissões**: como administrador ou delegado, conceder a um **usuário operacional** (não ao
   administrador) "Cadastrar parcerias formalizadas", "Alterar dados cadastrais de parcerias" e "Consultar
   parcerias da OSC", pela matriz.
4. **Cadastro real**: entrar como esse usuário, "Parcerias → Cadastrar parceria", preencher e salvar;
   conferir no Console `oscs/osc-teste-alfa/partnerships`, `partnershipEvents` e `partnershipRequests`.
   Os dados gravados são **reais no ambiente de testes**: use identificações claramente fictícias.
   Reversão: excluir os documentos criados (parceria, evento e marcador).
5. Validar: correção cadastral, aviso de duplicidade, parceria arquivada, revogação de `partnerships.create`
   (o cadastro passa a ser negado) e isolamento com outra OSC.

### 10.9 Pendências

- **Administração da Plataforma — permissões do administrador único** (DEC-PAR-002): operação ainda não
  implementada; até lá, o administrador não recebe permissões operacionais pelo sistema.
- Transições de situação (suspender, encerrar, arquivar, desarquivar), prorrogação e alteração formal.
- Fluxo de alteração de campos protegidos (datas, valor, instrumento) com registro formal.
- Upload e conferência do Plano de Trabalho (Storage bloqueado).

## 11. Plano de Trabalho aprovado — estrutura, cadastro e consulta (DEV-02.2)

**Situação:** implementado e habilitado pelo servidor; **validado em emuladores**; **não validado no
Preview** (depende de 11.9). A DEV-02.2 **não** está homologada.

### 11.1 Referências verificadas

| Referência | Uso |
| --- | --- |
| HF-G05 / PAG-OSC05 (WF-OSC05-01; JOR-05) | Etapa 1 "identificação do Plano aprovado": **data da aprovação pelo órgão público** e **período de execução** (obrigatórios); seção "Objeto e Público"; textos "Plano de Trabalho aprovado ainda não registrado", "A finalização [...] não representa aprovação oficial"; permissões "Editar plano de trabalho" (registra) e "Consultar plano de trabalho"; arquivada → "disponível somente para consulta" |
| AF-01 (PT-1 a PT-5) e PD-01-P01 | Versões preservadas e finalização (incremento futuro); prorrogação não cria versão; arquivada somente consulta |
| DEC-006, 032, 033, 034, 035, 037, 038, 039 | **Somente os títulos** informados no pedido; o texto das decisões não foi localizado (repositório, canvas, Google Drive) |
| RC-020 a RC-028, Inventário FUN | Não localizados; não substituem FUN |

Etapas 2 e 3 do protótipo (metas, indicadores, fórmulas, planejamento financeiro) ficam **fora** deste
incremento (DEC-035; módulos futuros). Nada foi inventado como obrigatório além do homologado.

### 11.2 Matriz de campos

Origem: **H** protótipo homologado; **D** título de decisão; **T** proposta técnica (opcional). Estados:
informado / não informado / não aplicável (zero é informado). Todos os campos: editáveis enquanto
"em cadastramento"; **preservados (somente leitura)** após a finalização.

| Campo | ID técnico | Tipo | Grupo | Origem | Exigido para finalizar | Admite "não se aplica" | Validação |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Data da aprovação pelo órgão público | `approvalDate` | data | Identificação do Plano | H | **Sim** | Não | Real, não futura; posterior à formalização → aviso |
| Identificação do ato ou documento de aprovação | `approvalReference` | texto ≤300 | Identificação do Plano | T (DEC-006) | Não | Não | Sem caracteres de controle |
| Início do período de execução | `executionStart` | data | Execução | H | **Sim** | Não | Real |
| Término do período de execução | `executionEnd` | data | Execução | H | **Sim** | Não | ≥ início; fora da vigência → aviso |
| Forma de execução | `executionMethod` | texto ≤4000 | Execução | T (DEC-032) | Não | Não | — |
| Público atendido | `targetAudience` | texto ≤2000 | Abrangência | H ("Objeto e Público") | Não | Sim | — |
| Quantidade estimada de beneficiários | `estimatedBeneficiaries` | inteiro ≥0 | Abrangência | T (DEC-032) | Não | Sim | Inteiro 0–10⁹; zero é informado |
| Abrangência territorial | `geographicScope` | texto ≤1000 | Abrangência | T (DEC-032) | Não | Sim | — |
| Justificativa e contextualização | `justification` | texto ≤8000 | Complementares | T (DEC-032) | Não | Não | — |
| Informações complementares | `complementaryNotes` | texto ≤8000 | Complementares | D (DEC-032) | Não | Não | — |

**Não duplicados (fonte autoritativa = cadastro da parceria):** instrumento, número, órgão, objeto,
formalização, vigência, situação administrativa e declaração de aprovação do Plano. A PAG-OSC05 os
exibe a partir da parceria. Aplicabilidade por instrumento (DEC-037): planejamento financeiro
**não se aplica** ao Acordo de Cooperação (exibido; nada é registrado).

### 11.3 Modelo Firestore

```
oscs/{oscId}/partnerships/{partnershipId}/workPlans/original
  schemaVersion 1, id 'original', oscId, partnershipId,
  origin { kind 'approved-plan-registration', formalVersion false, sequence 1, sourceWorkPlanId null },
  registrationStatus 'in-registration' | 'finalized'   ("não estruturado" = documento ausente),
  values { <campo>: { state, value? } }, document { status 'not-stored', storagePath null },
  revision, startRequestId, lastUpdateRequestId, finalizationRequestId,
  createdAt/By, updatedAt/By, finalizedAt/By
oscs/{oscId}/workPlanEvents/{id}   action start|update|finalize, partnershipId, workPlanId, actorUid,
                                    actorAuthority, fields (update), revisões, at — sem conteúdo textual
```

Identificador fixo `original` sob a parceria: associação inequívoca, consulta por um único `get` e
inícios simultâneos colidindo no mesmo documento (um só registro). Isolamento pelo caminho da OSC.

### 11.4 Versionamento futuro (DEC-034/039) — preparado, não implementado

- O registro atual é a **origem** da cadeia (`origin.sequence = 1`, `sourceWorkPlanId = null`,
  `formalVersion = false`): **não** é apresentado como versão formal.
- Uma nova versão integral será **outro documento** em `workPlans/` (ex.: `sequence = 2`,
  `sourceWorkPlanId = 'original'`, ato formal e data), sem alterar o anterior: o histórico é a lista da
  subcoleção; diferenças = comparação campo a campo de `values`.
- Registros futuros (metas, execução, despesas) guardarão `workPlanId` de origem (DEC-039).
- Neste incremento: nenhuma versão é criada; edição comum não gera versão; prorrogação não toca o Plano;
  registro finalizado não é sobrescrito.

### 11.5 Permissões (catálogo) — DEC-PT-001 (alternativa B)

| Operação | Permissão |
| --- | --- |
| Consultar o Plano e o histórico de correções | `work-plan.view` |
| Iniciar o cadastro | `work-plan.edit` |
| Editar o cadastro em andamento | `work-plan.edit` |
| Finalizar internamente (com confirmação explícita) | `work-plan.edit` |
| Corrigir erro material após a finalização (DEC-PT-002) | `work-plan.edit` |

`view` e `edit` são independentes (nenhuma implica a outra); navegar até o Plano exige também
`partnerships.view`. Rótulo de `work-plan.edit`: "Registrar, finalizar e corrigir o Plano de Trabalho".

**`work-plan.finalize` — DESCONTINUADA.** Permanece no catálogo com `status: 'discontinued'`, apenas para
documentação. Não é concedível (nem na matriz, nem na API de permissões), não aparece no CSV e é
**descartada na leitura** de qualquer vínculo (`sanitizePermissions`), portanto nunca autoriza operações.
Valores já gravados **não são convertidos** em `work-plan.edit` nem apagados: ficam inertes no documento.
No código e nos dados de teste versionados não há vínculos com o identificador; o Firebase de testes não
pode ser inspecionado daqui (se houver, continuam inertes). Administrador sem permissões implícitas e
DEC-PAR-002 preservados.

### 11.6-A Correção de erro material — DEC-PT-002 (alternativa A)

**Conceito.** *Correção material*: ajuste de informação registrada incorretamente no SIGOSC em relação ao
Plano formalmente aprovado. *Alteração formal*: modificação do próprio Plano aprovado (procedimento
administrativo e versionamento futuro) — **não** disponível.

**Contrato** (`POST /api/osc-work-plans`, mantendo as operações existentes):

```json
{ "oscId": "…", "partnershipId": "…", "requestId": "uuid", "action": "correct",
  "expectedRevision": 3,
  "changes": { "approvalDate": { "state": "informed", "value": "2026-02-15" } },
  "justification": "Data transcrita incorretamente do Plano aprovado.",
  "declaration": true }
```

Respostas: 200 `{corrected: true, workPlan: {revision}}`; 200 `{corrected: false}` (reenvio do mesmo
pedido); 403 (sem `work-plan.edit`, suspensão comercial, parceria arquivada, sem vínculo); 404 (parceria
fora da OSC); 409 `not-finalized` | `stale`; 422 `invalid-correction` com `fields` (`correctionReason` =
justificativa, `declaration`, campos do Plano, `changes: no-change | breaks-finalization`).

**Regras.** Somente Plano **finalizado**, parceria não arquivada, OSC ativa e sem suspensão comercial,
vínculo ativo com `work-plan.edit`. Apenas os campos estruturados do Plano (mesmas validações do
cadastro); um ou mais campos por correção; valor idêntico recusado; justificativa com ao menos 10
caracteres significativos (máx. 2000); declaração obrigatória ("Declaro que esta correção corresponde à
informação constante do Plano de Trabalho efetivamente aprovado, não representando alteração formal de seu
conteúdo."), registrada como **declaração do usuário** (`automatedVerification: false`). A correção não pode
deixar o Plano sem os requisitos da finalização. **Não** altera: OSC, parceria, identidade e origem do
Plano, autoria e data de criação, data/autor/pedido da finalização, `registrationStatus` (continua
`finalized`), declaração de aprovação. Não cria versão.

**Armazenamento (append-only).** Na mesma transação: o Plano recebe os valores corrigidos (`values`),
`revision + 1`, `lastCorrectionAt/By`, `correctionCount`; e é criado o evento
`oscs/{oscId}/workPlanEvents/correction_{uid}_{requestId}`:

```
action 'material-correction', oscId, partnershipId, workPlanId, actorUid, actorAuthority, requestId,
corrections [{ field, before {state, value?}, after {state, value?} }], justification,
declaration { accepted: true, text, automatedVerification: false }, fromRevision, toRevision, at (servidor)
```

O ID determinístico do evento é o marcador de idempotência: reenvios (inclusive simultâneos) do mesmo
pedido não duplicam a correção; correções concorrentes com a mesma revisão → uma vence, a outra recebe
`stale`. Eventos nunca são alterados ou excluídos; o evento de finalização original permanece.

**Histórico.** `GET /api/osc-work-plans?oscId=…&partnershipId=…` — somente pelo servidor (a auditoria
continua **ilegível pelo navegador** nas Security Rules), com `work-plan.view` na OSC (suspensão
comercial: só o administrador com a permissão) e parceria da própria OSC. Lista só correções materiais,
em ordem de revisão, com data, responsável ("você" ou a competência: Administrador único, Delegado,
Operacional — sem UID/e-mail de terceiros), campo, valor anterior, valor corrigido e justificativa.

**Registros futuros.** Execução, indicadores e finanças deverão gravar `workPlanId` e a `revision` do Plano
vigente no momento do registro. Uma correção posterior é identificável comparando essa revisão com
`toRevision` dos eventos `material-correction`; nenhuma reconciliação automática é feita.

### 11.6 Servidor (`/api/osc-work-plans`) e regras

Token → corpo estrito → transação (OSC, vínculo, parceria, Plano) → permissão **antes** de revelar a
parceria → parceria da OSC → arquivada bloqueia → finalizado bloqueia (409) → revisão (409 `stale`) →
validação → gravação + auditoria. Suspensão comercial bloqueia tudo; parceria suspensa ou encerrada não.
Idempotência: início pelo ID fixo; alteração por `lastUpdateRequestId`; finalização por
`finalizationRequestId`; a finalização exige `confirm: true`.
Security Rules: `workPlans` com `get/list` somente por `canConsult(oscId, 'work-plan.view')`; nenhuma
escrita pelo cliente; `workPlanEvents` ilegível.

### 11.7 Documento aprovado

Storage continua com negação integral (`storage.rules`). Nenhum upload simulado; o Plano mostra
"Documento não armazenado no SIGOSC". `document.status = 'not-stored'` e `storagePath = null` preparam a
vinculação futura, sem dependência de arquivo inexistente.

### 11.8 Pendências

- Correção de erro material: **resolvida pela DEC-PT-002** (11.6-A).
- Texto integral das decisões DEC-006/032–039 e Inventário FUN: não localizados; campos **T** a confirmar.
- Metas, indicadores, fórmulas, planejamento financeiro, versões e alterações formais: incrementos futuros.
- Armazenamento documental (Storage) e permissões do administrador pela Administração da Plataforma.

### 11.9 Validação no Preview (Firebase de testes)

1. Publicar `firestore.rules` no `sigorsc-testes` (7.6). Efeito: leitura do Plano com `work-plan.view`;
   nenhuma escrita pelo cliente; sem índices novos.
2. A função `/api/osc-work-plans` usa as mesmas variáveis da 8.7; conferir 401 sem token.
3. Pela matriz, conceder a um usuário operacional: "Consultar parcerias da OSC", "Consultar Planos de
   Trabalho" e "Registrar, finalizar e corrigir o Plano de Trabalho".
4. Selecionar uma parceria → "Plano de Trabalho" → iniciar, preencher, salvar e finalizar; depois
   "Corrigir erro material" (campo, valor correto, justificativa, declaração, revisar, confirmar) e
   conferir o histórico; no Console, `workPlans/original` e `workPlanEvents` (evento
   `correction_{uid}_{requestId}`). Os dados são reais no ambiente de testes (use conteúdo
   fictício); reversão: excluir o documento do Plano e os eventos.

## 12. Publicação na Vercel

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

## 13. Estado atual

| Item | Situação |
| --- | --- |
| Frontend React + TypeScript + Vite | Inicializado |
| Página técnica de verificação | Implementada (exibida quando a configuração é inválida) |
| Interface de alta fidelidade PAG-OSC01 a 03 | Integrada (DEV-01.4); PAG-OSC03 em matriz (UX-001) |
| Parcerias: consulta, pesquisa, seleção e identificação (PAG-OSC02 e consulta da PAG-OSC04) | Implementado (DEV-02.1); **regras ainda não publicadas** no Firebase de testes |
| Cadastro e correção cadastral de parcerias | Implementados e habilitados (C01, DEC-PAR-001 a 006); validados em emuladores; **não validados no Preview** |
| Firebase SDK (App, Auth, Firestore, Storage) | Instâncias inicializadas quando a configuração é válida (DEV-00.7) |
| Security Rules Firestore/Storage (negação integral) | Criadas e testadas em emulador; publicação no Firebase de testes pendente |
| Autenticação (login, recuperação de senha, logout, sessão local) | Implementada (DEV-01.1) — interface técnica provisória |
| OSCs, vínculos, administrador único (modelo), seleção da OSC ativa | Implementado (DEV-01.2) — interface técnica provisória |
| Regras Multi-Tenant de leitura | Implementadas e testadas em emulador; **publicação no Firebase de testes pendente** |
| Permissões individuais, delegação, suspensão comercial (DEV-01.3) | Implementado e testado em emuladores; **operações de servidor não configuradas** no Preview |
| Convites, criação de usuários, desvinculação, designação de administrador, cadastro de OSCs | Não iniciados |
| Plano de Trabalho: cadastro estruturado, consulta, finalização interna e correção de erro material (DEV-02.2 e C01) | Implementado; validado em emuladores; **não validado no Preview** |
| Versões do Plano, metas, indicadores, prorrogações, execução, financeiro, prestação de contas | Não iniciados |
| 100 funcionalidades homologadas (Inventário V1.0) | **Não implementadas** |

Próximas etapas dependem de nova autorização.
