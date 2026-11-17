# SIGOSC 2.0

**Sistema de Gestão de Parcerias com Organizações da Sociedade Civil**

> **Estado atual: DEV-01.3 — permissões individuais, delegação e controle de acesso Multi-Tenant.**
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
| Interface | React 19 + TypeScript 6 (modo estrito) |
| Desenvolvimento e build | Vite 8 |
| Autenticação | Firebase Authentication (e-mail e senha) — DEV-01.1 |
| Banco de dados (futuro) | Cloud Firestore |
| Arquivos (futuro) | Firebase Cloud Storage |
| Testes | `node:test` (lógica), Vitest + Testing Library + jsdom (interface), emuladores Firebase |
| Verificação estática | ESLint 10 + typescript-eslint (regras `strict`) + regras de React Hooks |
| Hospedagem | Vercel (site estático + Funções de servidor em `api/`) |
| Operações privilegiadas | Firebase Admin SDK (somente em `api/`, nunca no navegador) |
| Versionamento | GitHub |

Requisito de execução: Node.js `>= 22.12` (exigido pelo Vite 8).

## 3. Organização de diretórios

```
.
├── public/               # Arquivos estáticos servidos sem processamento (favicon)
├── api/                  # Funções de servidor da Vercel (DEV-01.3): /api/osc-permissions
│   └── _lib/             # Lógica do servidor (não exposta como rota)
├── src/
│   ├── assets/           # Imagens, ícones e fontes importados pelo código
│   ├── components/       # Componentes compartilhados (StatusCard, TechnicalPanel, AuthGate, AuthProvider)
│   ├── config/           # Configurações centrais (app.ts, firebase.ts)
│   ├── domain/           # Regras de negócio puras compartilhadas com o servidor (authorization.ts)
│   ├── hooks/            # Hooks React (useAuthState, useAuthActions)
│   ├── layouts/          # Estruturas de página (BaseLayout)
│   ├── pages/            # Páginas (Home/: diagnóstico; Auth/: login e sessão; Organizations/: seleção de OSC)
│   ├── services/         # Serviços (firebase/: inicialização; auth/: autenticação; organizations/: vínculos)
│   ├── styles/           # Estilos globais e variáveis de tema
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
| Gestão de parcerias | `partnerships.view` | `partnerships.edit` |
| Plano de Trabalho | `work-plan.view` | `work-plan.edit` |
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

- Quem concede permissões operacionais ao administrador? Hoje ninguém pelo sistema: o próprio
  administrador não (proibição de autoalteração) e o delegado não (proteção do administrador).
- Situação cadastral diferente de `active` bloqueia toda a gestão, inclusive consulta.
- Granularidade das permissões por módulo (consulta × edição × aprovação) depende do Inventário V1.0.

## 9. Publicação na Vercel

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

## 10. Estado atual

| Item | Situação |
| --- | --- |
| Frontend React + TypeScript + Vite | Inicializado |
| Página técnica de verificação | Implementada |
| Firebase SDK (App, Auth, Firestore, Storage) | Instâncias inicializadas quando a configuração é válida (DEV-00.7) |
| Security Rules Firestore/Storage (negação integral) | Criadas e testadas em emulador; publicação no Firebase de testes pendente |
| Autenticação (login, recuperação de senha, logout, sessão local) | Implementada (DEV-01.1) — interface técnica provisória |
| OSCs, vínculos, administrador único (modelo), seleção da OSC ativa | Implementado (DEV-01.2) — interface técnica provisória |
| Regras Multi-Tenant de leitura | Implementadas e testadas em emulador; **publicação no Firebase de testes pendente** |
| Permissões individuais, delegação, suspensão comercial (DEV-01.3) | Implementado e testado em emuladores; **operações de servidor não configuradas** no Preview |
| Convites, criação de usuários, desvinculação, designação de administrador, cadastro de OSCs | Não iniciados |
| 100 funcionalidades homologadas (Inventário V1.0) | **Não implementadas** |

Próximas etapas dependem de nova autorização.
