# SIGOSC 2.0

**Sistema de Gestão de Parcerias com Organizações da Sociedade Civil**

> **Estado atual: DEV-00.5 — inicialização técnica.**
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
│   ├── services/         # Acesso a serviços externos (Firebase) — vazio nesta etapa
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
| Firebase SDK | Instalado, **não inicializado** |
| Autenticação, Multi-Tenant, Firestore, Storage | Não iniciados |
| 100 funcionalidades homologadas (Inventário V1.0) | **Não implementadas** |

Próximas etapas dependem de nova autorização.
