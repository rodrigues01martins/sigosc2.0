# INV-UXPT-01 — Procedimento operacional e de segurança do inventário somente leitura

| Item | Valor |
| --- | --- |
| Preparação | INV-PREP-01 (este documento, workflow, script e testes) |
| Situação | **Preparado, NÃO habilitado.** Nenhuma identidade Google, nenhum IAM, nenhuma variável do repositório e nenhum arquivo de disparo foram criados |
| Projeto-alvo | `sigorsc-testes` (exclusivamente). Produção: proibido |
| Base documental | `docs/uxpt/DEV-UXPT-01-compatibilidade.md` (estados E1–E15, dependências D01–D26) |

## 1. Objetivo

Contar, de forma **agregada** e **somente leitura**, quantas ocorrências de cada estado legado do Plano de Trabalho (E1–E15) existem no Firebase de testes.

O resultado alimenta as decisões ainda pendentes para a DEV-UXPT-02, P2, P3 e P5 em particular:
- versões aguardando finalização (E8);
- versões `pending-decision` (E9);
- cadeias inconsistentes;
- incorporações abertas (E10, E12).

O inventário não corrige, não regulariza e não migra nada.

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
job "guard"  (contents: read; SEM id-token)
  • repositório, branch, evento, push não forçado
  • INV_UXPT_ENABLED, INV_UXPT_PROJECT = sigorsc-testes, provedor WIF e conta de serviço com formato válido
  • commit de disparo: um único pai = INV_UXPT_APPROVED_BASE_SHA; altera SOMENTE trigger.txt
        │
        ▼
job "inventory"  (environment: inv-uxpt-01 → aprovação humana; contents: read; id-token: write)
  • checkout do mesmo SHA, sem credenciais persistidas; revalidação do commit
  • npm ci --ignore-scripts (lockfile) → testes offline do inventário
  • google-github-actions/auth: token OIDC do GitHub → STS → impersonação da conta de serviço (curta duração)
  • node scripts/inventory/uxpt-legacy-readonly.mjs (somente leitura) → report.json + report.md (agregados)
  • upload do artefato (retenção de 3 dias)
```

Nenhuma chave JSON, token permanente, credencial de outro ambiente ou credencial da Vercel é usada.

## 4. Arquivos envolvidos

| Arquivo | Papel |
| --- | --- |
| `.github/workflows/inv-uxpt-01.yml` | Workflow temporário (gatilho, validações, autenticação federada, artefato) |
| `scripts/inventory/uxpt-legacy-readonly.mjs` | Ponto de entrada: valida configuração e credencial federada, executa, aplica a verificação de vazamento e grava os relatórios |
| `scripts/inventory/reader.mjs` | Leitura paginada com projeção de campos, falha segura por seção, relatório agregado, adaptador de leitura do Firestore |
| `scripts/inventory/classify.mjs` | Classificação **pura** E1–E15 (reutiliza o domínio `src/domain/workPlanVersions.ts`) |
| `scripts/inventory/uxpt-legacy-readonly.test.mjs` | Testes offline (INV-T01..T14) |
| `ops/inventory/trigger.txt` | **Não existe.** Será criado somente em commit próprio, com autorização expressa |

## 5. Requisitos de segurança

1. **Somente leitura em dois níveis.** O papel IAM concede só permissões de leitura; esta é a garantia principal. O código, além disso, não usa métodos de escrita, o que é verificado de duas formas: varredura estática (INV-T11) e execução com um banco fictício que registra qualquer escrita (INV-T12). **As verificações de código e de YAML complementam, mas não substituem, o IAM.**
2. **Escopo de projeto.** O script recusa qualquer projeto diferente de `sigorsc-testes`, variáveis de projeto conflitantes e qualquer emulador configurado.
3. **Credencial exclusivamente federada.** O script exige `GOOGLE_APPLICATION_CREDENTIALS` com `type: external_account`, impersonando exatamente a conta configurada. Ele recusa:
   - chave de conta de serviço;
   - `authorized_user`;
   - presença de `private_key` ou `refresh_token`;
   - variáveis de token (`CLOUDSDK_AUTH_ACCESS_TOKEN`, `GOOGLE_OAUTH_ACCESS_TOKEN`).
4. **Dados mínimos.** O script lê com projeção apenas os campos abaixo e não lê `values`, metas, indicadores, itens financeiros, autores nem conteúdo de atos.

   | Coleção | Campos lidos |
   | --- | --- |
   | OSCs e parcerias | Nenhum (só existência) |
   | Versões | `oscId`, `partnershipId`, `registrationStatus`, `origin.sequence`, `origin.previousWorkPlanId`, `activation.status`, `revision`, `finalizedAt`, `formalAct.type`, `formalAct.actDate`, `complementaryTranscription.status`, `financialTranscription.status` |
   | Eventos | `action` |

5. **Sem identificação na saída.** Os identificadores ficam só em memória. Antes de gravar, `assertAggregateOnly` recusa o relatório se ele contiver qualquer identificador de OSC ou de parceria, ou padrão de e-mail (falha fechada). Mensagens de erro trazem só a etapa e o código do erro.
6. **Sem números fabricados.** Uma falha de leitura ou de paginação torna a seção afetada "não verificável" (`null`). O relatório só é `complete` com todas as seções lidas integralmente e totais consistentes.
7. **Código revisado.** Depois da autenticação, só roda o script do commit revisado (`INV_UXPT_APPROVED_BASE_SHA`). Para isso:
   - o commit de disparo não pode alterar nenhum outro arquivo;
   - as dependências vêm do lockfile, sem scripts de instalação;
   - as actions de terceiros estão fixadas por SHA completo.
8. **Aprovação humana.** O job autenticado usa o ambiente `inv-uxpt-01`, que deve ter revisores obrigatórios, restrição ao branch `develop` e, quando disponível, a opção de impedir a autoaprovação. O revisor confere o diff do commit de disparo antes de aprovar.

## 6. Identidade Google proposta (não criada)

| Item | Proposta |
| --- | --- |
| Conta de serviço | `inv-uxpt-01-reader@sigorsc-testes.iam.gserviceaccount.com`, **sem chaves**. A criação de chaves deve ser bloqueada por política, quando disponível |
| Pool WIF | `github-inv-uxpt` (projeto `sigorsc-testes`) |
| Provedor | `sigosc-develop`, emissor `https://token.actions.githubusercontent.com` |
| Vínculo | `roles/iam.workloadIdentityUser` concedido **somente** ao sujeito do ambiente: `principal://iam.googleapis.com/projects/<NÚMERO>/locations/global/workloadIdentityPools/github-inv-uxpt/subject/repo:rodrigues01martins/sigosc2.0:environment:inv-uxpt-01` |

### 6.1 Restrição do provedor por atributos confiáveis do GitHub

Mapeamento de atributos:

```
google.subject        = assertion.sub
attribute.repository  = assertion.repository
attribute.repository_id       = assertion.repository_id
attribute.repository_owner_id = assertion.repository_owner_id
attribute.ref         = assertion.ref
attribute.event_name  = assertion.event_name
attribute.workflow_ref = assertion.workflow_ref
attribute.environment = assertion.environment
```

Condição de atributos do provedor. Usar os IDs **numéricos** do repositório e do dono, que resistem a renomeação e recriação do repositório:

```
assertion.repository_id == "<ID numérico do repositório>" &&
assertion.repository_owner_id == "<ID numérico do dono>" &&
assertion.ref == "refs/heads/develop" &&
assertion.event_name == "push" &&
assertion.workflow_ref == "rodrigues01martins/sigosc2.0/.github/workflows/inv-uxpt-01.yml@refs/heads/develop" &&
assertion.environment == "inv-uxpt-01"
```

A condição `environment` impede que um workflow sem o ambiente protegido (e, portanto, sem aprovação humana) obtenha a credencial, mesmo que alguém altere o YAML.

## 7. Permissões mínimas

- **Na conta de serviço:** papel personalizado `invUxptFirestoreReader` contendo somente `datastore.databases.getMetadata`, `datastore.entities.get` e `datastore.entities.list`. A alternativa predefinida é `roles/datastore.viewer`, que é mais ampla.
- **Proibido:** `roles/datastore.user`, `roles/datastore.owner`, `roles/firebase.*`, `roles/editor`, `roles/owner`, `roles/iam.serviceAccountTokenCreator` amplo e qualquer chave.
- **Limitação conhecida:** o IAM do Firestore não restringe a leitura por coleção. A conta poderá ler qualquer documento do banco de testes. A restrição a metadados é feita pelo código revisado e pela aprovação humana, não pelo IAM.
- **No GitHub:** o workflow tem `contents: read` em todos os jobs e `id-token: write` só no job `inventory`.

## 8. Condições do disparo por `push`

O workflow só é **acionado** se todas estas condições forem verdadeiras:
1. evento `push`;
2. branch `develop`;
3. o push altera `ops/inventory/trigger.txt`.

Ele só **autentica** se, além disso:
- as variáveis do repositório estiverem configuradas: `INV_UXPT_ENABLED=true`, `INV_UXPT_PROJECT=sigorsc-testes`, `INV_UXPT_WIF_PROVIDER`, `INV_UXPT_SERVICE_ACCOUNT`, `INV_UXPT_APPROVED_BASE_SHA`;
- o commit de disparo tiver um único pai igual a `INV_UXPT_APPROVED_BASE_SHA` e alterar só `trigger.txt`;
- um revisor aprovar o ambiente `inv-uxpt-01`;
- o provedor WIF aceitar os atributos do token.

Sem qualquer dessas condições, **falha segura**: nenhuma autenticação e nenhuma credencial alternativa.

O commit de preparação (INV-PREP-01) **não** satisfaz o filtro de caminhos, porque não cria `trigger.txt`.

## 9. Sequência de preparação

| Etapa | Conteúdo | Situação |
| --- | --- | --- |
| INV-PREP-01 | Workflow, script, testes e esta documentação no `develop` | Concluída nesta etapa |
| INV-PREP-02 | Configuração IAM/WIF, ambiente `inv-uxpt-01` e variáveis do repositório (seção 10) | **Requer autorização** |
| Revisão de segurança | Revisar o commit-base, fixar `INV_UXPT_APPROVED_BASE_SHA` e reconfirmar os SHAs das actions | **Requer autorização** |
| Disparo | Commit exclusivo criando `ops/inventory/trigger.txt` (seção 11) | **Requer autorização expressa** |

## 10. Procedimento futuro de configuração IAM (INV-PREP-02, não executar agora)

Executado por administrador do `sigorsc-testes`, em terminal próprio, com projeto explícito em cada comando.
1. Habilitar `iamcredentials.googleapis.com` e `sts.googleapis.com` no `sigorsc-testes`.
2. Criar a conta de serviço da seção 6, sem chaves.
3. Criar o papel personalizado da seção 7 e concedê-lo à conta, **somente** no `sigorsc-testes`.
4. Criar o pool e o provedor OIDC da seção 6.1, com o mapeamento e a condição de atributos.
5. Conceder `roles/iam.workloadIdentityUser` na conta de serviço ao `principal://…/subject/repo:rodrigues01martins/sigosc2.0:environment:inv-uxpt-01`.
6. No GitHub, criar o ambiente `inv-uxpt-01` com:
   - revisores obrigatórios;
   - branch de implantação somente `develop`;
   - impedimento de autoaprovação, se disponível.
7. No GitHub, em *Variables* (não *Secrets*, porque não são segredos), criar `INV_UXPT_PROJECT`, `INV_UXPT_WIF_PROVIDER`, `INV_UXPT_SERVICE_ACCOUNT`, `INV_UXPT_APPROVED_BASE_SHA` e, por último, `INV_UXPT_ENABLED=true`.
8. Recomendado: proteção do branch `develop` restringindo quem pode enviar commits.

## 11. Procedimento futuro de execução (não executar agora)

1. Confirmar que `INV_UXPT_APPROVED_BASE_SHA` é o HEAD revisado do `develop`.
2. Criar **um único commit**, sobre esse SHA, contendo apenas `ops/inventory/trigger.txt` (texto livre, sem dados pessoais), e enviá-lo para `develop` sem `--force`.
3. Acompanhar o job `guard`.
4. O revisor do ambiente confere o diff do commit de disparo e aprova o job `inventory`.
5. Baixar o artefato `inv-uxpt-01-aggregate` dentro do prazo de retenção (3 dias).

## 12. Verificação dos resultados

Em `report.json`, conferir:
- **`status`:** `complete`, `partial` ou `failed`;
- **`sections`:** situação de cada seção;
- **`failures`:** etapa e código de cada falha;
- **`totalsConsistent`:** `true`, `false` ou `null` (não verificável);
- **`states`:** E1–E15, cada um com `value` e `finding` (`found` / `not-found` / `not-verifiable`);
- **`counts`:** contagens detalhadas.

Os estados **se sobrepõem** e não somam ao total. Somente `status: complete` com `totalsConsistent: true` vale como inventário completo; qualquer outro resultado é parcial e **não** pode ser apresentado como completo.

Critérios (iguais aos de `DEV-UXPT-01-compatibilidade.md`, seção 2.1):
- **Vigência (E6, E9c):** calculada pela própria função do domínio `resolveCurrentVersion`.
- **E7:** situação apresentada por `activationStatusOf`.
- **E8:** versão posterior em cadastramento com ativação `awaiting-finalization`, `pending-decision` ou ausente.
- **E9a:** finalizada com `pending-decision`.
- **E9b:** versão posterior sem `activation.status` válido. O servidor a trata como `null` (não vigente) e o cliente, como `pending-decision`; é a observação O3 do DEV-UXPT-01.
- **Integridade (seção F do pedido):** `counts.integrity` traz:
  - IDs de versão inválidos;
  - sequência incoerente com o ID;
  - `oscId` / `partnershipId` divergentes do caminho;
  - versão anterior inexistente;
  - revisão inválida;
  - situações de cadastro, ativação e incorporação não reconhecidas.

  Em `laterVersions`, `invalidFormalAct` conta as versões que o cliente atual descartaria. Em `current`, `multipleActive` conta as cadeias com mais de uma versão ativa.

## 13. Desativação e revogação

Ao final do inventário, ou em caso de incidente:
1. Definir `INV_UXPT_ENABLED` como `false` ou removê-la; remover as demais variáveis `INV_UXPT_*`.
2. Remover o vínculo `roles/iam.workloadIdentityUser`, desativar o provedor e, depois, excluir o pool.
3. Remover o papel da conta de serviço e desativá-la ou excluí-la.
4. Remover o ambiente `inv-uxpt-01`.
5. Em commit próprio e autorizado, remover `ops/inventory/trigger.txt` e o workflow temporário.

O artefato expira em 3 dias; pode ser excluído antes manualmente.

## 14. Limitações e riscos

| Risco | Mitigação |
| --- | --- |
| Quem pode enviar commits ao `develop` pode alterar o próprio workflow no commit de disparo e remover as verificações do YAML | Condição WIF exige `environment == inv-uxpt-01`, que obriga a aprovação humana; o revisor confere o diff; proteção do branch. **O YAML não é barreira suficiente** |
| IAM do Firestore sem granularidade por coleção | Papel somente leitura; projeção mínima; código revisado |
| Ações de terceiros comprometidas | Fixadas por SHA completo; reconfirmar os SHAs e a compatibilidade do runtime das actions na revisão de segurança (a `auth` v2.1.13 pode exigir atualização) |
| Dependência maliciosa no `npm ci` | Lockfile versionado, `--ignore-scripts`, sem cache compartilhado |
| Falso positivo da verificação de vazamento (identificador curto igual a um rótulo do relatório) | Falha **fechada**: o relatório não é emitido; investigar antes de nova execução |
| Volume alto de documentos | Paginação por cursor (200 por página, até 1000 páginas por coleção); acima do limite, a seção fica não verificável |
| Leitura não transacional (dados podem mudar durante a execução) | O banco de testes não deve receber gravações durante a janela de execução; registrar o horário |
| Workflow não validado por `actionlint` nesta preparação | Validado por dois parsers YAML e pelo teste estrutural INV-T13; recomenda-se `actionlint` na revisão de segurança |

## 15. Critérios de homologação

1. Diff do INV-PREP-01 restrito a workflow, scripts, testes e documentação; nenhum código funcional, API, regra ou credencial alterados; `trigger.txt` inexistente.
2. Testes offline INV-T01..T14 verdes; suítes existentes, `typecheck`, `lint` e `build` verdes.
3. Revisão de segurança do workflow e do script, com reconfirmação dos SHAs das actions.
4. INV-PREP-02 (IAM, WIF, ambiente e variáveis) autorizado e configurado conforme as seções 6, 7 e 10, sem chaves.
5. Execução autorizada produzindo `status: complete` e `totalsConsistent: true`, ou classificação explícita como parcial.
