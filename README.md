# SIGOSC 2.0

**Sistema de Gestão de Parcerias com Organizações da Sociedade Civil**

> **Estado atual: DEV-00.7 — inicialização técnica dos serviços Firebase.**
> As **100 funcionalidades homologadas** no Inventário Funcional V1.0 **ainda NÃO foram implementadas**.
> O repositório contém apenas a infraestrutura do frontend e uma página técnica de verificação.

## 1. Finalidade

O SIGOSC 2.0 é um sistema Web (SaaS Multi-Tenant) para gestão de parcerias entre
Organizações da Sociedade Civil (OSCs) e a Administração Pública, no contexto da
Lei Federal nº 13.019/2014 (Marco Regulatório das Organizações da Sociedade Civil — MROSC).

## 2. Tecnologias

| Camada | Tecnologia |
| --- | --- |
| Interface | React 19 + TypeScript 6 (modo estrito) |
| Desenvolvimento e build | Vite 8 |
| Autenticação (futura) | Firebase Authentication |
| Banco de dados (futuro) | Cloud Firestore |
| Arquivos (futuro) | Firebase Cloud Storage |
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
│   ├── components/       # Componentes compartilhados (ex.: StatusCard)
│   ├── config/           # Configurações centrais (app.ts, firebase.ts)
│   ├── hooks/            # Hooks React customizados
│   ├── layouts/          # Estruturas de página (BaseLayout)
│   ├── pages/            # Páginas (uma pasta por página: Home/)
│   ├── services/         # Acesso a serviços externos (firebase/: inicialização do SDK)
│   ├── styles/           # Estilos globais e variáveis de tema
│   ├── types/            # Tipos TypeScript compartilhados
│   ├── utils/            # Funções utilitárias puras
│   ├── App.tsx           # Componente raiz
│   ├── main.tsx          # Ponto de entrada
│   └── vite-env.d.ts     # Tipagem das variáveis de ambiente VITE_*
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
| `npm test` | Testes da validação de ambiente (executor nativo `node:test`) |

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
- Nenhum serviço Firebase (Auth, Firestore, Storage) é inicializado nesta etapa.

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
- **Autenticação** (identificar o usuário) e **autorização** (Security Rules) ainda não foram implementadas.
- **Multi-Tenant**: o isolamento entre organizações NÃO existe ainda; depende de modelagem e de Security Rules futuras.

## 6. Publicação na Vercel

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

## 7. Estado atual

| Item | Situação |
| --- | --- |
| Frontend React + TypeScript + Vite | Inicializado |
| Página técnica de verificação | Implementada |
| Firebase SDK (App, Auth, Firestore, Storage) | Instâncias inicializadas quando a configuração é válida (DEV-00.7) |
| Login, permissões, Multi-Tenant, leituras/gravações | Não iniciados |
| 100 funcionalidades homologadas (Inventário V1.0) | **Não implementadas** |

Próximas etapas dependem de nova autorização.
