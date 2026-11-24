# INV-UXPT-01 — Procedimento operacional e de segurança do inventário somente leitura

| Item | Valor |
| --- | --- |
| Preparação | INV-PREP-01 (workflow, script, testes e este documento); revisão de segurança INV-PREP-02A (achados REV-INV-001 a 013) |
| Situação | **Preparado, NÃO habilitado.** Nenhuma identidade Google, nenhum IAM, nenhuma variável do repositório, nenhum ambiente e nenhum arquivo de disparo foram criados |
| Projeto-alvo | `sigorsc-testes` (exclusivamente). Produção: proibido |
| Base documental | `docs/uxpt/DEV-UXPT-01-compatibilidade.md` (estados E1–E15, dependências D01–D26) |

## 1. Objetivo

Contar, de forma **agregada** e **somente leitura**, quantas ocorrências de cada estado legado do Plano de Trabalho (E1–E15) existem no Firebase de testes.

O resultado alimenta as decisões ainda pendentes para a DEV-UXPT-02, em especial P2, P3 e P5:
- versões aguardando finalização (E8);
- versões `pending-decision` (E9);
- cadeias inconsistentes;
- incorporações abertas (E10, E12).

O inventário retrata o **código publicado**: por exemplo, a vigência segue `resolveCurrentVersion` atual, sem antecipar a DEC-UXPT-P1. Ele não corrige, não regulariza e não migra nada.

## 2. Decisões administrativas autorizadoras

| Decisão | Conteúdo |
| --- | --- |
| DEC-INV-UXPT-01 = C | Identidade **exclusiva** de leitura |
| DEC-INV-UXPT-02 = A | Workflow no `develop`, sem modificar `main` |
| DEC-INV-UXPT-03 = A | Disparo excepcional por `push` controlado |

Contexto funcional, que **não** é implementado aqui: DEC-UXPT-P1 = A, DEC-UXPT-P8 = B, DEC-UXPT-P9 = B.

## 3. Arquitetura: GitHub Actions + Workload Identity Federation (WIF)

```
push em develop alterando ops/inventory/trigger.txt
        │
        ▼
job "guard"  (contents: read; SEM id-token; SEM ambiente)
  • repositório, branch, evento, push não forçado
  • INV_UXPT_ENABLED, INV_UXPT_PROJECT = sigorsc-testes, provedor WIF e conta de serviço com formato válido
  • commit de disparo: um único pai = INV_UXPT_APPROVED_BASE_SHA; altera SOMENTE trigger.txt;
    o arquivo existe, é comum (não link) e tem até 1 KB (excluir o arquivo não dispara a execução)
        │
        ▼
job "inventory"  (environment: inv-uxpt-01 → aprovação humana; contents: read; id-token: write)
  • checkout do mesmo SHA, sem credenciais persistidas; revalidação do commit
  • npm ci --ignore-scripts (lockfile) → testes offline do inventário
  • google-github-actions/auth v3.0.0 (node24): token OIDC → STS → impersonação da conta (curta duração)
  • node scripts/inventory/uxpt-legacy-readonly.mjs (somente leitura)
      → código 0 (completo) | 4 (emitido, parcial) | 2 (não emitido) | 3 (configuração recusada)
  • se emitido: conferência dos 2 arquivos → artefato (inclusive parcial, retenção de 3 dias)
  • etapa final: falha o job se o código não for 0
```

Nenhuma chave JSON, token permanente, credencial de outro ambiente ou credencial da Vercel é usada.

## 4. Arquivos envolvidos

| Arquivo | Papel |
| --- | --- |
| `.github/workflows/inv-uxpt-01.yml` | Workflow temporário (gatilho, validações, autenticação federada, artefato) |
| `scripts/inventory/uxpt-legacy-readonly.mjs` | Ponto de entrada: valida configuração e credencial federada, executa, aplica a verificação de vazamento e grava os relatórios |
| `scripts/inventory/reader.mjs` | Leitura paginada com projeção de campos, falha segura por seção, relatório agregado, lista de permissões do relatório, adaptador de leitura do Firestore |
| `scripts/inventory/classify.mjs` | Classificação **pura** E1–E15 (reutiliza o domínio `src/domain/workPlanVersions.ts` e `partnerships.ts`) |
| `scripts/inventory/uxpt-legacy-readonly.test.mjs` | Testes offline INV-T01..T29 |
| `ops/inventory/trigger.txt` | **Não existe.** Será criado somente em commit próprio, com autorização expressa |

## 5. Requisitos de segurança

1. **Somente leitura em dois níveis.** O papel IAM concede só permissões de leitura; esta é a garantia principal. O código não usa métodos de escrita, o que é verificado por:
   - varredura estática (INV-T11);
   - execução com um banco fictício que registra qualquer escrita (INV-T12).

   **As verificações de código e de YAML complementam, mas não substituem, o IAM.**
2. **Escopo de projeto.** O script recusa qualquer projeto diferente de `sigorsc-testes`, variáveis de projeto conflitantes e qualquer emulador configurado.
3. **Credencial exclusivamente federada.** O script exige `GOOGLE_APPLICATION_CREDENTIALS` com `type: external_account`, impersonando exatamente a conta configurada. Ele recusa:
   - chave de conta de serviço;
   - `authorized_user`;
   - presença de `private_key` ou `refresh_token`;
   - variáveis de token.

   O arquivo gerado pela action contém, em `credential_source.headers`, o token de solicitação OIDC do GitHub. O script o lê apenas para validar o tipo e o alvo da impersonação, e nunca o imprime.
4. **Dados mínimos.** O script lê com projeção apenas os campos abaixo e não lê `values`, metas, indicadores, itens financeiros, autores nem conteúdo de atos.

   | Coleção | Campos lidos |
   | --- | --- |
   | OSCs e parcerias | Nenhum (só existência) |
   | Versões | `oscId`, `partnershipId`, `registrationStatus`, `origin.sequence`, `origin.previousWorkPlanId`, `activation.status`, `revision`, `finalizedAt`, `correctionCount`, `formalAct.type`, `formalAct.actDate`, `complementaryTranscription.status`, `financialTranscription.status` |
   | Eventos | `action` |

5. **Sem identificação na saída.** Os identificadores ficam só em memória. A verificação é de falha fechada, em três camadas:
   1. **Lista de permissões estrutural:** toda chave e todo texto do relatório pertencem a um vocabulário fixo derivado do próprio modelo (ou são data ISO / código de falha seguro); qualquer outro texto bloqueia a emissão.
   2. **Markdown derivado:** o Markdown precisa ser exatamente o gerado a partir do relatório validado.
   3. **Defesa em profundidade:** nenhum e-mail, e nenhum identificador lido como token isolado ou, se tiver 12 ou mais caracteres, como trecho.

   Identificadores que coincidem com palavras do vocabulário ou que são só dígitos não geram falso positivo, porque não revelam nada (INV-T22). Erros de terceiros são reduzidos a códigos seguros: gRPC `grpc-0..16` ou códigos internos fixos. Mensagens e códigos textuais, que podem conter caminhos e identificadores, nunca são propagados (INV-T23).
6. **Sem números fabricados.** Falha de leitura, de paginação (inclusive em página intermediária) ou de classificação torna a seção afetada "não verificável" (`null`).
7. **Código revisado.** Depois da autenticação, só roda o script do commit revisado (`INV_UXPT_APPROVED_BASE_SHA`). Para isso:
   - o commit de disparo não pode alterar nenhum outro arquivo;
   - as dependências vêm do lockfile, com `--ignore-scripts`;
   - as actions estão fixadas por SHA completo, conferido contra as tags.
8. **Aprovação humana.** O job autenticado usa o ambiente `inv-uxpt-01`. **O ambiente precisa existir com revisores obrigatórios ANTES de habilitar o inventário** (seção 10): um ambiente referenciado e inexistente é criado automaticamente pelo GitHub **sem proteção**, e o atributo `environment` do token seria emitido do mesmo modo.

## 6. Identidade Google proposta (não criada)

| Item | Proposta |
| --- | --- |
| Conta de serviço | `inv-uxpt-01-reader@sigorsc-testes.iam.gserviceaccount.com`, **sem chaves**. A criação de chaves deve ser bloqueada por política, quando disponível |
| Pool WIF | `github-inv-uxpt` (projeto `sigorsc-testes`) |
| Provedor | `sigosc-develop`, emissor `https://token.actions.githubusercontent.com` |
| Vínculo | `roles/iam.workloadIdentityUser` concedido **somente** ao sujeito do ambiente: `principal://iam.googleapis.com/projects/<NÚMERO>/locations/global/workloadIdentityPools/github-inv-uxpt/subject/repo:rodrigues01martins/sigosc2.0:environment:inv-uxpt-01` |

### 6.1 Restrição do provedor por atributos confiáveis do GitHub

O token OIDC do GitHub Actions contém as declarações `sub`, `repository`, `repository_id`, `repository_owner_id`, `ref`, `event_name` e `workflow_ref` em todo job. Quando o job referencia um ambiente, ele contém também `environment`, e o `sub` passa a ter o formato `repo:<dono>/<repo>:environment:<nome>`.

Ressalvas:
- **Não confirmado nesta revisão (offline).** A presença dessas declarações vem da documentação pública do GitHub. A verificação prática fica para a INV-PREP-02B: um único token de teste, sem acesso ao Firestore, inspecionado na tela de teste do provedor ou pelo registro de auditoria do STS.
- Se o repositório ou a organização usarem um **modelo personalizado de `sub`**, o principal do vínculo precisa ser ajustado.

Mapeamento de atributos:

```
google.subject                = assertion.sub
attribute.repository          = assertion.repository
attribute.repository_id       = assertion.repository_id
attribute.repository_owner_id = assertion.repository_owner_id
attribute.ref                 = assertion.ref
attribute.event_name          = assertion.event_name
attribute.workflow_ref        = assertion.workflow_ref
attribute.environment         = assertion.environment
```

Condição de atributos do provedor. Usar os IDs **numéricos** do repositório e do dono, que resistem a renomeação e recriação:

```
assertion.repository_id == "<ID numérico do repositório>" &&
assertion.repository_owner_id == "<ID numérico do dono>" &&
assertion.ref == "refs/heads/develop" &&
assertion.event_name == "push" &&
assertion.workflow_ref == "rodrigues01martins/sigosc2.0/.github/workflows/inv-uxpt-01.yml@refs/heads/develop" &&
assertion.environment == "inv-uxpt-01"
```

**Mesma identidade nos dois controles.** A condição do provedor (IDs, `ref`, evento, workflow, ambiente) e o vínculo de impersonação (`subject/repo:rodrigues01martins/sigosc2.0:environment:inv-uxpt-01`, pelo nome) restringem o mesmo job, e ambos precisam ser satisfeitos.

| Tentativa | Bloqueada por |
| --- | --- |
| Outro repositório ou fork | `repository_id` / `repository_owner_id` e `sub` |
| Outro branch | `ref` |
| Outro workflow | `workflow_ref` |
| Outro evento | `event_name` |
| Job sem o ambiente | `environment` e `sub` |
| Outra conta de serviço | Só esta conta tem o vínculo |
| Credenciais permanentes, de produção ou da Vercel | Não existem no fluxo; o script recusa credencial não federada e outro projeto |

**Limitação:** nem o IAM nem o token provam que o ambiente **tem revisores configurados**. Isso depende da configuração do GitHub (seção 5, item 8).

## 7. Permissões mínimas

As operações efetivas do Admin SDK são somente **consultas** (`RunQuery`: `select`, `orderBy(__name__)`, `limit`, `startAfter`) em coleções do banco `(default)`.

| Permissão | Necessária? | Justificativa |
| --- | --- | --- |
| `datastore.entities.list` | **Sim** | Execução de consultas (`RunQuery`) |
| `datastore.entities.get` | **Sim** (por precaução) | Leitura de documentos; algumas consultas são autorizadas como leitura de entidades |
| `datastore.databases.getMetadata` | **Não demonstrada** | O cliente não lê metadados do banco. Manter fora do papel inicial e acrescentar somente se a verificação da INV-PREP-02B mostrar necessidade |
| `serviceusage.services.use` | Não esperada | Só se a credencial federada definir projeto de cota diferente; não é o caso |

- **Pendência:** a suficiência do papel `invUxptFirestoreReader` (`entities.get` e `entities.list`) **não pôde ser confirmada offline**. Na INV-PREP-02B, confirmar administrativamente com `testIamPermissions` / Policy Troubleshooter para a conta, sem executar o inventário. A alternativa predefinida é `roles/datastore.viewer`, mais ampla.
- Se possível, acrescentar ao vínculo uma condição IAM limitando ao banco `(default)`.
- **Proibido:** `roles/datastore.user`, `roles/datastore.owner`, `roles/firebase.*`, `roles/editor`, `roles/owner`, criação de tokens ampla e qualquer chave.
- **Limitação conhecida:** o IAM do Firestore não restringe a leitura por coleção. A restrição a metadados é feita pelo código revisado e pela aprovação humana.
- **GitHub:** `contents: read` em todos os jobs; `id-token: write` só no job `inventory`.

## 8. Condições do disparo por `push`

O workflow só é **acionado** se todas estas condições forem verdadeiras:
1. evento `push`;
2. branch `develop`;
3. o push altera `ops/inventory/trigger.txt`.

Pushes em `main`, em outros branches ou sem esse arquivo **não acionam**. Um commit que exclua o arquivo aciona, mas é recusado pelo `guard`.

Ele só **autentica** se, além disso:
- as variáveis do repositório estiverem configuradas: `INV_UXPT_ENABLED=true`, `INV_UXPT_PROJECT=sigorsc-testes`, `INV_UXPT_WIF_PROVIDER`, `INV_UXPT_SERVICE_ACCOUNT`, `INV_UXPT_APPROVED_BASE_SHA`;
- o push não for forçado;
- o commit de disparo tiver um único pai (não merge) igual a `INV_UXPT_APPROVED_BASE_SHA`, alterar só `trigger.txt` e o arquivo existir como arquivo comum com até 1 KB;
- um revisor aprovar o ambiente `inv-uxpt-01`;
- o provedor WIF aceitar os atributos do token.

Sem qualquer dessas condições, **falha segura**: nenhuma autenticação e nenhuma credencial alternativa.

O commit de preparação, e qualquer commit de revisão como o da INV-PREP-02A, **não** satisfaz o filtro de caminhos.

## 9. Sequência de preparação

| Etapa | Conteúdo | Situação |
| --- | --- | --- |
| INV-PREP-01 | Workflow, script, testes e esta documentação no `develop` | Concluída (`b451742`) |
| INV-PREP-02A | Revisão de segurança adversarial e correções REV-INV-001 a 013 | Concluída; o novo SHA revisado substitui `b451742` como base |
| INV-PREP-02B | Configuração IAM/WIF, ambiente `inv-uxpt-01` e variáveis do repositório (seção 10) | **Requer autorização** |
| Disparo | Commit exclusivo criando `ops/inventory/trigger.txt` (seção 11) | **Requer autorização expressa** |

## 10. Procedimento futuro de configuração (INV-PREP-02B, não executar agora)

Executado por administrador do `sigorsc-testes`, em terminal próprio, com projeto explícito em cada comando. **A ordem importa.**
1. **GitHub — ambiente primeiro:** criar o ambiente `inv-uxpt-01` com:
   - revisores obrigatórios;
   - branch de implantação somente `develop`;
   - impedimento de autoaprovação, se disponível.
2. Habilitar `iamcredentials.googleapis.com` e `sts.googleapis.com` no `sigorsc-testes`.
3. Criar a conta de serviço da seção 6, sem chaves.
4. Criar o papel personalizado da seção 7 (`entities.get` e `entities.list`) e concedê-lo à conta, **somente** no `sigorsc-testes`.
5. Criar o pool e o provedor OIDC da seção 6.1, com o mapeamento e a condição de atributos (IDs numéricos obtidos na API do GitHub).
6. Conceder `roles/iam.workloadIdentityUser` na conta de serviço ao `principal://…/subject/repo:rodrigues01martins/sigosc2.0:environment:inv-uxpt-01`.
7. Verificar administrativamente as permissões (seção 7) e as declarações do token (seção 6.1), sem executar o inventário.
8. No GitHub, em *Variables* (não *Secrets*, porque não são segredos), criar `INV_UXPT_PROJECT`, `INV_UXPT_WIF_PROVIDER`, `INV_UXPT_SERVICE_ACCOUNT`, `INV_UXPT_APPROVED_BASE_SHA` (= SHA revisado mais recente) e, **por último**, `INV_UXPT_ENABLED=true`.
9. Recomendado: proteção do branch `develop` restringindo quem pode enviar commits.

## 11. Procedimento futuro de execução (não executar agora)

1. Confirmar que `INV_UXPT_APPROVED_BASE_SHA` é o HEAD revisado do `develop`.
2. Criar **um único commit**, sobre esse SHA, contendo apenas `ops/inventory/trigger.txt` (texto livre curto, sem dados pessoais), e enviá-lo para `develop` sem `--force`.
3. Acompanhar o job `guard`.
4. O revisor do ambiente confere o diff do commit de disparo e aprova o job `inventory`.
5. Baixar o artefato `inv-uxpt-01-aggregate` dentro do prazo de retenção (3 dias).

## 12. Verificação dos resultados

Em `report.json`, há **três propriedades distintas**; nenhuma implica as outras.

| Campo | Significado |
| --- | --- |
| `queryComplete` / `status` | **Completude das consultas**: todas as seções lidas integralmente (`complete`, `partial`, `failed`; `sections` e `failures` detalham) |
| `arithmeticConsistent` / `arithmeticIssues` | **Integridade aritmética**: as contagens fecham entre si (`null` se não verificável) |
| `dataAnomalies` | **Anomalias dos dados históricos**, achados do inventário, nunca corrigidos: integridade, cadeias inconsistentes, ativa não finalizada, ato formal inválido, eventos desconhecidos e divergência entre `correctionCount` e eventos `material-correction` (`correctionCountMatchesEvents`) |

`states` (E1–E15, com `value` e `finding` = `found` / `not-found` / `not-verifiable`) e `counts` trazem as contagens. Os estados **se sobrepõem** e **não somam** ao total.

Somente `status: complete` com `arithmeticConsistent: true` (código de saída 0) vale como inventário completo. Anomalias nos dados são **resultado**, não falha. Um relatório parcial é publicado (código 4) para análise, mas o job termina como falho e o relatório **não** pode ser apresentado como completo.

Critérios, iguais aos de `DEV-UXPT-01-compatibilidade.md`, seção 2.1:

| Estado | Critério |
| --- | --- |
| E1 | Ausência de `workPlans/original`; `withVersionsButWithoutOriginal` distingue a cadeia só com versões posteriores |
| E2 / E3 | `registrationStatus`; `finalizedWithoutFinalizedAt` é relatado à parte |
| E4 / E5 | `original` / `v{n}` válidos (`isVersionId`) |
| E6 | `resolveCurrentVersion` atual |
| E7 | `E7_storedSuperseded` (valor **gravado**) e `E7_shownSuperseded` (situação apresentada por `activationStatusOf`, que também classifica como substituída a versão finalizada sem ativação válida ou ativa em cadeia inconsistente) |
| E8 | Posterior em cadastramento com ativação `awaiting-finalization`, `pending-decision` ou ausente |
| E9a | Finalizada `pending-decision` |
| E9b | Sem `activation.status` válido (servidor: `null`; cliente: `pending-decision` — O3 do DEV-UXPT-01) |
| E9c | Cadeia inconsistente pelo domínio. **Ausência de vigente não é inconsistência:** `current.none` cobre, por exemplo, originais em cadastramento |
| E9d / E9e / E9f | Mais de uma ativa / ativa não finalizada / original substituída sem sucessora ativa finalizada |
| Integridade | IDs inválidos, sequência incoerente, campos de caminho divergentes, versão anterior inexistente ou não anterior (ciclos e auto-referência), revisão ou `correctionCount` inválidos, situações não reconhecidas |
| E14 | Eventos `material-correction`, comparados à soma de `correctionCount` |
| E15 | Eventos por tipo; `unknownAction` e `withoutValidAction` |

## 13. Desativação e revogação

Ao final do inventário, ou em caso de incidente:
1. Definir `INV_UXPT_ENABLED` como `false` ou removê-la; remover as demais variáveis `INV_UXPT_*`.
2. Remover o vínculo `roles/iam.workloadIdentityUser`, desativar o provedor e, depois, excluir o pool.
3. Remover o papel da conta de serviço e desativá-la ou excluí-la.
4. Remover o ambiente `inv-uxpt-01`.
5. Em commit próprio e autorizado, remover o workflow temporário e `ops/inventory/trigger.txt`. Remova o workflow primeiro ou no mesmo commit; a exclusão isolada do disparo é recusada pelo `guard`.

O artefato expira em 3 dias; pode ser excluído antes manualmente.

## 14. Limitações e riscos

| Risco | Mitigação |
| --- | --- |
| Quem pode enviar commits ao `develop` pode alterar o próprio workflow no commit de disparo e remover as verificações do YAML | Condição WIF com `environment` + vínculo pelo `sub` do ambiente + aprovação humana com revisão do diff + proteção do branch. **O YAML não é barreira suficiente** |
| Ambiente referenciado inexistente é criado sem proteção | Criar o ambiente com revisores **antes** de qualquer variável (seção 10) |
| IAM do Firestore sem granularidade por coleção | Papel somente leitura; projeção mínima; código revisado |
| Permissões do papel personalizado não confirmadas offline | Verificação administrativa na INV-PREP-02B (seção 7) |
| Declarações do token OIDC não confirmadas na prática | Verificação na INV-PREP-02B (seção 6.1) |
| Ações de terceiros comprometidas | Fixadas por SHA completo, conferido contra as tags; runtime node24 nas quatro |
| Dependência maliciosa no `npm ci` | Lockfile versionado, `--ignore-scripts`, sem cache |
| Leitura não transacional (dados podem mudar durante a execução; a paginação por ID não detecta inclusões ou exclusões entre páginas) | Não gravar no banco de testes durante a janela de execução; registrar o horário. A leitura transacional (`runTransaction` somente leitura) foi descartada porque a verificação estática proíbe transações |
| Volume alto | Paginação por cursor (200 por página, até 1000 páginas por coleção); acima disso, a seção fica não verificável |
| Importação de módulos TypeScript do domínio pelo Node | Remoção de tipos nativa do Node 24 (`setup-node 24.x`); localmente verificada também em Node 22.23 |

## 15. Critérios de homologação

1. Diff restrito aos arquivos do inventário; nenhum código funcional, API, regra ou credencial alterados; `trigger.txt` inexistente.
2. `actionlint` (com `shellcheck`) sem apontamentos; testes offline INV-T01..T29 verdes; suítes existentes, `typecheck`, `lint` e `build` verdes.
3. INV-PREP-02B autorizado e executado na ordem da seção 10, sem chaves, com verificação das permissões e das declarações do token.
4. Execução autorizada produzindo código 0 (`status: complete`, `arithmeticConsistent: true`), ou classificação explícita como parcial.
