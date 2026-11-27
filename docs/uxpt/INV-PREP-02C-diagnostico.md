# INV-PREP-02C — Diagnóstico isolado dos atributos OIDC do GitHub Actions

| Item | Valor |
| --- | --- |
| Preparação | INV-PREP-02C.1 (este documento, workflow, script e testes) |
| Situação | **Preparado, NÃO executado.** Nenhum arquivo de disparo, nenhuma variável, nenhum token solicitado |
| Base do inventário (inalterada) | `27700348b38ab9aa4693207524ec97d94407a91d` (`inv-uxpt-01.yml` e scripts do inventário preservados) |
| Ambiente GitHub | `inv-uxpt-01` (o mesmo do inventário) |
| Google Cloud | **Nenhum acesso.** Sem STS, sem `google-github-actions/auth`, sem conta de serviço, sem Firestore; `INV_UXPT_ENABLED` permanece `false` |

## 1. Objetivo

Comprovar, antes de habilitar o inventário, quais declarações o GitHub Actions emite no token OIDC de um job que usa o ambiente protegido `inv-uxpt-01`. Em especial: `environment`, o formato de `sub` com ambiente, `workflow_ref` e os IDs numéricos.

São esses os atributos de que dependem a condição do provedor WIF (`github-inv-uxpt/sigosc-develop`) e o vínculo `roles/iam.workloadIdentityUser` documentados em `INV-UXPT-01-procedimento.md`, seção 6.1.

## 2. Arquivos

| Arquivo | Papel |
| --- | --- |
| `.github/workflows/inv-uxpt-oidc-diagnostic.yml` | Workflow independente: `guard` (sem token) e `oidc-claims` (ambiente `inv-uxpt-01`, `id-token: write`) |
| `scripts/inventory/oidc-claims-diagnostic.mjs` | Solicita o token ao emissor do GitHub, decodifica as declarações em memória, registra PASS/FAIL/NOT_VERIFIABLE |
| `tests/inventory-oidc/oidc-claims-diagnostic.test.mjs` | Testes OIDC-T01..T18 (só módulos nativos; também rodam no job, antes do token) |
| `tests/inventory-oidc/oidc-diagnostic-workflow.test.mjs` | Testes OIDC-W01..W05 (estrutura do workflow e simulação local do `guard`) |
| `ops/inventory/oidc-diagnostic-trigger.txt` | **Não existe.** Somente em commit próprio, com autorização expressa |

Os testes ficam em `tests/inventory-oidc/`, e não em `scripts/inventory/`, porque o workflow do inventário executa `scripts/inventory/*.test.mjs`. Assim, os testes do diagnóstico não entram na execução do inventário, que segue inalterada.

## 3. Gatilho, permissões e validações

| Item | Configuração |
| --- | --- |
| Evento | Somente `push` no `develop` alterando `ops/inventory/oidc-diagnostic-trigger.txt` |
| Permissões | `contents: read` em tudo; `id-token: write` **apenas** no job `oidc-claims` |
| Ambiente | `oidc-claims` usa `environment: inv-uxpt-01` (revisores obrigatórios) |
| Concorrência | Grupo `inv-uxpt-oidc-diagnostic`, sem cancelar execução em andamento |
| Tempo | 5 minutos por job |
| Checkout | Sem credenciais persistidas |
| Actions | Fixadas por SHA completo, as mesmas já revisadas na INV-PREP-02A (node24) |

Validações do job `guard`, todas antes de qualquer token:
- **Contexto:** repositório `rodrigues01martins/sigosc2.0`, `refs/heads/develop`, evento `push`, push não forçado.
- **Habilitação:** variável `INV_UXPT_OIDC_DIAG_ENABLED=true`.
- **Base revisada:** `INV_UXPT_OIDC_DIAG_APPROVED_BASE_SHA` com 40 caracteres hexadecimais. É uma variável **própria**, separada de `INV_UXPT_APPROVED_BASE_SHA`.
- **Commit de disparo:**
  - tem exatamente um pai, ou seja, não é merge;
  - o pai é o SHA aprovado;
  - altera **somente** o arquivo de disparo, portanto não altera o workflow nem o script;
  - o arquivo existe, é comum (não link) e tem até 1 KB. Excluir o arquivo de disparo não executa o diagnóstico.

## 4. Critérios de validação dos atributos

O token é solicitado com o público **exclusivo** `sigosc-inv-uxpt-oidc-diagnostic`.

| Atributo | PASS quando |
| --- | --- |
| `iss` | `https://token.actions.githubusercontent.com` |
| `aud` | Exatamente o público solicitado (texto ou lista com um único item) |
| `repository` | `rodrigues01martins/sigosc2.0` |
| `repository_id` / `repository_owner_id` | Iguais a `INV_UXPT_EXPECTED_REPOSITORY_ID` / `INV_UXPT_EXPECTED_OWNER_ID`, os mesmos IDs da condição WIF. **NOT_VERIFIABLE** se as variáveis não estiverem configuradas |
| `ref` | `refs/heads/develop` |
| `event_name` | `push` |
| `workflow_ref` | `rodrigues01martins/sigosc2.0/.github/workflows/inv-uxpt-oidc-diagnostic.yml@refs/heads/develop` |
| `workflow_ref_format` | Mesmo repositório e branch, arquivo em `.github/workflows/`: o formato que a condição WIF compara para `inv-uxpt-01.yml` |
| `environment` | `inv-uxpt-01` |
| `sub` | `repo:rodrigues01martins/sigosc2.0:environment:inv-uxpt-01` (modelo padrão do GitHub com ambiente) |
| `exp` / `iat` | Validade temporal: não expirado, emitido até 60 s no futuro, vida útil de no máximo 1 h |

| Resultado | Código de saída |
| --- | --- |
| Todos PASS | 0 |
| Algum FAIL | 1 |
| Algum NOT_VERIFIABLE | 4 |
| Token indisponível ou inválido | 2 |
| Configuração recusada | 3 |

O job falha se o código não for 0.

**Conferência de declarações ≠ aceitação pelo Google.**
- O script decodifica o token localmente e **não verifica a assinatura** (`signatureVerified: false`); só o emissor e o próprio canal do runner dão confiança à origem.
- Ele também **não testa** se o provedor WIF aceitaria o token (`googleCloudAcceptanceTested: false`).
- Um PASS comprova o **formato e os valores das declarações emitidas**, não a configuração do Google.
- Este workflow tem `workflow_ref` diferente do inventário, então a condição WIF atual **rejeitaria** o token dele, como deve. O diagnóstico confirma o formato; a igualdade exata com `inv-uxpt-01.yml` só aparece no workflow do inventário.

## 5. Proteções contra vazamento do token

- O token e o token de solicitação ficam só em memória; nunca são impressos, gravados ou publicados como artefato. Nenhum valor de declaração é registrado: só a situação por atributo.
- Lista de permissões do relatório: ele só pode conter o vocabulário fixo, a data ISO e booleanos. O Markdown precisa ser exatamente o derivado do relatório, e o relatório é recusado se contiver o token, uma de suas partes ou o token de solicitação. As mensagens de erro são códigos fixos.
- Não há `::add-mask::`, porque o mecanismo exige escrever o valor na saída. O token nunca chega à saída.
- A única requisição vai ao emissor informado pelo runner (`ACTIONS_ID_TOKEN_REQUEST_URL`, somente HTTPS). Nenhum envio a terceiros.
- **Público exclusivo:** o token não serve para o provedor WIF, cujo público aceito é o do próprio provedor. Mesmo vazado, não autenticaria no Google, **desde que** `sigosc-inv-uxpt-oidc-diagnostic` não seja incluído nos públicos permitidos do provedor.
- Testes OIDC-T13, T14, T17 e T18.

## 6. Isolamento do Google Cloud e do Firebase

- O script se recusa a executar se houver qualquer credencial Google no ambiente (`GOOGLE_APPLICATION_CREDENTIALS`, `CLOUDSDK_AUTH_*` e similares) — OIDC-T15.
- O workflow não usa `google-github-actions/auth`, `npm ci`, `gcloud`, segredos nem artefatos — OIDC-W03.
- O script não importa SDKs e não referencia nenhum endereço do Google ou do Firebase — OIDC-T17.
- Nenhuma variável do inventário é lida ou alterada (`INV_UXPT_ENABLED`, `INV_UXPT_APPROVED_BASE_SHA`).

## 7. Condições para executar (mediante nova autorização)

1. Confirmar que o ambiente `inv-uxpt-01` existe com revisores obrigatórios e branch de implantação `develop`. Não foi verificável nesta preparação.
2. Confirmar que o provedor WIF **não** lista `sigosc-inv-uxpt-oidc-diagnostic` entre os públicos permitidos.
3. Criar as variáveis do repositório:
   - `INV_UXPT_EXPECTED_REPOSITORY_ID` e `INV_UXPT_EXPECTED_OWNER_ID`, com os mesmos IDs usados na condição WIF;
   - `INV_UXPT_OIDC_DIAG_APPROVED_BASE_SHA`, com o SHA desta preparação;
   - por último, `INV_UXPT_OIDC_DIAG_ENABLED=true`.
4. Criar **um único commit**, sobre esse SHA, contendo só `ops/inventory/oidc-diagnostic-trigger.txt` (texto curto, sem dados pessoais), e enviá-lo sem `--force`.
5. O revisor do ambiente confere o diff e aprova o job `oidc-claims`.
6. Ler o resumo do job: só situações por atributo.
7. Em seguida, voltar `INV_UXPT_OIDC_DIAG_ENABLED` para `false`. Remover o arquivo de disparo e o workflow em commit próprio e autorizado; o `guard` recusa a exclusão isolada.

O novo commit de disparo muda o HEAD do `develop`. Antes do inventário, `INV_UXPT_APPROVED_BASE_SHA` terá de apontar para um commit revisado posterior, cujo código do inventário seja idêntico a `2770034`.

## 8. Testar depois a aceitação pelo Google sem ampliar a política WIF

| Opção | Como | Avaliação |
| --- | --- | --- |
| **A. Modo de pré-verificação no próprio inventário** (recomendada) | Em incremento futuro e revisado, o script ganha um modo que autentica (STS + impersonação) e obtém só o token de acesso, **sem nenhuma chamada ao Firestore**. Roda no workflow `inv-uxpt-01.yml`, com o mesmo `workflow_ref` | Testa exatamente a condição WIF real, sem ampliá-la. Exige mudança autorizada no workflow/script e novo SHA aprovado |
| **B. Registros de auditoria do Google Cloud** | Após uma execução autorizada, o administrador consulta os logs de auditoria de STS e IAM Credentials (troca de token e `generateAccessToken`) | Somente leitura administrativa; mostra aceitação ou recusa e o motivo |
| **C. Análise estática da política** | Policy Troubleshooter / Policy Analyzer para o principal `subject/repo:…:environment:inv-uxpt-01` na conta de serviço | Confirma o vínculo e as permissões sem token, mas não as declarações |
| **Não recomendado** | Incluir o `workflow_ref` do diagnóstico, o público de diagnóstico ou curingas na condição WIF; levar o token para fora do runner | Amplia a confiança ou expõe o token |

## 9. Riscos residuais

- A ausência de verificação de assinatura é aceitável para um **diagnóstico de formato**; ela não substitui a validação feita pelo Google STS.
- O ambiente compartilhado com o inventário significa que a aprovação do revisor é o controle humano dos dois workflows; o revisor deve conferir qual workflow está pedindo aprovação.
- Quem pode enviar commits ao `develop` pode alterar este workflow. Proteções: aprovação humana no ambiente, proteção do branch e público exclusivo, que torna o token inútil no Google.
