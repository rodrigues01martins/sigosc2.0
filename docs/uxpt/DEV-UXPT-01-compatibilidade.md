# DEV-UXPT-01 — Preparação e contratos de compatibilidade do Plano de Trabalho

| Item | Valor |
| --- | --- |
| Incremento | DEV-UXPT-01 (primeiro incremento do PTI-UXPT-01; UX-PT-01 e UX-PT-02) |
| Referência de código | `develop` em `6b9fc3c` (DEV-02.5-C01) |
| Natureza | **Estudo, documentação e testes de caracterização.** Nenhuma funcionalidade, API, regra, permissão, interface ou dado foi alterado |
| Decisões consideradas definitivas | DEC-UXPT-02.1 (A), 02.2 (B), 02.3 (B), 02.4 (B), 02.5 (A) — não reabertas |
| Testes de caracterização | `src/domain/workPlanLegacy.characterization.test.ts`, `src/services/workPlans/legacyParsing.characterization.test.ts`, `tests/server/workPlanLegacy.characterization.server.test.ts`, `tests/rules/workPlanLegacy.rules.test.ts` |

**Convenções.**
- **[C] Comprovado pelo código:** o estado é produzido ou interpretado pelo código de `6b9fc3c` ou de commits anteriores do histórico Git.
- **[A] Depende de inventário do ambiente:** não se sabe se existe em dados reais do Firebase de testes. Nenhum dado real foi consultado.
- **LEGADO:** comportamento atual que poderá ser substituído pela UX-PT-02.

Estrutura: seção 1 (diagnóstico) e quatro documentos, correspondentes às seções 2 a 5, mais as seções 6 a 8.
- 2: inventário de estados e dependências da finalização;
- 3: matriz de compatibilidade;
- 4: contratos propostos;
- 5: plano de testes e transição;
- 6: defeitos e observações registrados;
- 7: pendências que exigem decisão funcional;
- 8: critérios para iniciar DEV-UXPT-02.

---

## 1. Diagnóstico do modelo atual

### 1.1 Persistência (Firestore)

```
oscs/{oscId}/partnerships/{partnershipId}                  parceria (workPlan.approvalDeclared, instrument, administrativeStatus…)
oscs/{oscId}/partnerships/{partnershipId}/workPlans/{id}   id ∈ { original, v2, v3, … }  (VERSION_ID_PATTERN)
  …/workPlans/{id}/goals/{g_…}                             metas previstas da versão
  …/workPlans/{id}/indicators/{i_…}                        indicadores previstos da versão
  …/workPlans/{id}/financialCategories/{c_…}               categorias do planejamento financeiro
  …/workPlans/{id}/financialItems/{f_…}                    itens do planejamento financeiro (centavos)
oscs/{oscId}/workPlanEvents/{auto | correction_{uid}_{requestId}}   auditoria append-only (ilegível pelo navegador)
```

**Cada versão é integral.** `create-version` copia todos os componentes com os mesmos IDs lógicos e registra `inheritedFrom`.

### 1.2 Operações (somente servidor, Admin SDK)

| API | Arquivo | Ações |
| --- | --- | --- |
| `/api/osc-work-plans` | `api/_lib/workPlansService.ts` | `start`, `update` (PATCH), `update-act` (PATCH), `finalize`, `correct`, `create-version`, `open-/close-transcription`, `open-/close-financial-transcription`, GET do histórico de correções |
| `/api/osc-work-plan-components` | `api/_lib/workPlanComponentsService.ts` | `create-goal`, `create-indicator`, PATCH de meta e indicador (sem exclusão; descontinuação por `status`) |
| `/api/osc-work-plan-financial` | `api/_lib/workPlanFinancialService.ts` | `create-category`, `create-item`, PATCH de categoria e item (sem exclusão; descontinuação por `status`) |

Padrão comum de todas as gravações:
1. token verificado;
2. corpo estrito;
3. **transação** que relê OSC, vínculo, parceria, versão e componentes;
4. permissão `work-plan.edit` avaliada **antes** de revelar a parceria;
5. parceria arquivada é somente consulta;
6. suspensão comercial bloqueia;
7. situação do cadastro;
8. `revision`, com 409 `stale` em caso de conflito;
9. validação;
10. gravação e evento na mesma transação.

**Idempotência:**
- `start`: ID fixo `original`.
- `update` / `update-act`: `lastUpdateRequestId` mais `updatedBy`.
- `finalize`: `finalizationRequestId` mais `finalizedBy`.
- `correct`: evento com ID `correction_{uid}_{requestId}`.
- `create-version`: `creationRequestId`.
- Incorporações: `openRequestId` e `closeRequestId`.
- Componentes e financeiro: ID determinístico `sha256(uid, requestId)` mais `creationRequestId` / `lastUpdateRequestId`.

### 1.3 Leitura (cliente, Security Rules)

O cliente lê diretamente os documentos sob `firestore.rules` (`canConsult(oscId, 'work-plan.view')`). Não há nenhuma escrita pelo navegador. A leitura é **defensiva**:
- `src/services/workPlans/parsing.ts` (`parseWorkPlan`, `parseComponents`, `parseFinancial`) descarta documentos fora do contrato;
- valores inválidos viram "não informado".

### 1.4 Interface atual (não alterada)

- `#/parcerias/{id}`: Identificação da Parceria (`PartnershipIdentificationPage.tsx`), com botões "Plano de Trabalho" e "Monitoramento e Avaliação".
- `#/parcerias/{id}/plano`: página única (`WorkPlanPage.tsx`) que reúne:
  - campos do Plano (`WorkPlanEditor`);
  - metas e indicadores (`PlanComponents`, `TranscriptionPanel`);
  - financeiro (`FinancialPlanning`, `FinancialTranscriptionPanel`);
  - finalização;
  - correção (`WorkPlanCorrection`, `CorrectionHistory`);
  - histórico e comparação de versões (`VersionHistory`, `VersionComparison`, `FormalActForm`).
- `#/parcerias/{id}/indicadores`: consulta dos indicadores da versão **vigente** (`IndicatorsPage.tsx`).

### 1.5 Eixo central

**A finalização interna (`registrationStatus: 'finalized'`) é a chave de todo o modelo atual:**
- separa a edição comum da correção material;
- define a versão vigente (`resolveCurrentVersion`);
- dispara a ativação de versões posteriores (DEC-PT-003);
- é pré-condição de nova alteração formal e das incorporações excepcionais;
- concentra as conferências: campos obrigatórios, DEC-PT-007 e DEC-PT-013.

Removê-la (DEC-UXPT-02.1) exige substituir **cada** uma dessas funções (seção 2.2).

---

## 2. Documento 1 — Inventário de estados e dependências

### 2.1 Inventário dos estados legados

Os estados se combinam. Por exemplo, uma versão pode estar finalizada, substituída e com incorporação encerrada ao mesmo tempo.

#### Parte A — persistência, operações e dependências

| # | Estado | Campos persistidos | Localização | Operações permitidas | Operações bloqueadas | Dependências |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | **Plano não estruturado** [C] | Nenhum (ausência de `workPlans/original`) | — | `start` | `update` / `finalize` → 409 `not-structured`; `correct` → 409 `not-finalized`; metas e financeiro → 404; `create-version` → 409 `base-not-finalized` | Parceria existente; `work-plan.edit`; parceria não arquivada |
| E2 | **Plano em cadastramento** [C] | `schemaVersion`, `id`, `oscId`, `partnershipId`, `origin`, `registrationStatus: 'in-registration'`, `values` (10 campos com estados de informação), `document: {not-stored}`, `revision`, `startRequestId`, `created*`, `updated*`, `lastUpdateRequestId` | `workPlans/original` ou `v{n}` | `update` (por campo); metas, indicadores e financeiro (`procedure: 'registration'`); `finalize`; `start` (idempotente) | `correct` → `not-finalized`; incorporações → `not-finalized`; nova versão (base não finalizada; com v{n} pendente, `pending-version-exists`) | — |
| E3 | **Plano finalizado** [C] | E2 + `finalizedAt`, `finalizedBy`, `finalizationRequestId`; `componentReview {rule, goals, indicators, counts, componentsToken, declaration, reviewedAt, reviewedBy}` (somente desde DEV-02.4-C01) | Idem | `correct` (campos do Plano); `create-version` (se vigente); incorporações (se vigente e sem componentes do tipo); leitura | `update`, `start`, `finalize` → 409 `already-finalized`; metas e financeiro → `complementary-transcription-pending` / `financial-transcription-pending` (sem registros) ou `already-finalized` | Requisitos da finalização (2.2) |
| E4 | **Versão original** [C] | `id: 'original'`, `origin {kind: 'approved-plan-registration', formalVersion: false, sequence: 1, sourceWorkPlanId: null}`; `activation` ausente ou `{status: 'superseded', supersededAt, supersededByWorkPlanId}` | `workPlans/original` | Conforme E2 / E3 | `update-act` (sem ato formal) | É a origem de toda a cadeia |
| E5 | **Versões formais posteriores** [C] | `id: 'v{n}'`, `origin {kind: 'formal-alteration', formalVersion: true, sequence, sourceWorkPlanId: 'original', previousWorkPlanId, baseRevision}`, `formalAct {type, typeDescription, reference, actDate, description, effectiveDate, declaredBy, declaredAt, automatedVerification: false}`, `creationRequestId`, `activation` | `workPlans/v{n}` | Em cadastramento: `update`, `update-act`, componentes, `finalize` (que ativa) | Conforme E2 / E3; o cliente descarta v{n} sem ato formal válido | Base vigente e finalizada no momento da criação |
| E6 | **Versão vigente** [C] (derivada, não gravada) | Original finalizada sem `superseded`, **ou** a única v{n} finalizada com `activation.status: 'active'` (`rule`, `activatedAt`, `activatedBy`, `supersededWorkPlanId`, `finalizationRequestId`) | Derivada por `resolveCurrentVersion` | Base de `create-version`; alvo das incorporações; exibida na PAG-OSC08 | — | Depende de **finalização** e de `activation` |
| E7 | **Versão substituída** [C] | `activation.status: 'superseded'`, `supersededAt`, `supersededByWorkPlanId`; valores, `revision` e finalização intactos | Original ou v{n} | Leitura; comparação; **`correct` ainda admitida** (UXPT01-S12) | `update`, componentes, incorporações (`transcription-not-current`), base de nova versão (`base-not-current`) | E6 de outra versão |
| E8 | **Versão aguardando finalização (ativação)** [C] | `activation.status: 'awaiting-finalization'`, `registrationStatus: 'in-registration'` | v{n} | Conforme E2; `finalize` = finalização + ativação (DEC-PT-003) | Nova versão (`pending-version-exists`); incorporações na vigente (`pending-version-exists`) | Origem = vigente (`checkActivationChain`) |
| E9 | **Versão legada inconsistente** | (a) **`pending-decision`** [C] (DEV-02.3, `958ffc7`): v{n} criada antes da DEC-PT-003. Finalizada, aparece como "aguarda regularização"; em cadastramento, equivale a E8 e é ativada ao finalizar. (b) v{n} sem `activation.status` válido [C]: o cliente lê como `pending-decision`; o servidor (`summaryOf`), como `null`. (c) duas ativas, ativa não finalizada, ou original `superseded` sem sucessora [C, interpretação]; nenhum código atual os produz [A] | v{n} / cadeia | Leitura; correção material | (a) finalizada: nova versão → `legacy-version-pending`; nova finalização → `already-finalized` (sem ativação retroativa). (c): nova versão → `versions-inconsistent`; `applicableVersionOn` → indeterminada | Regularização administrativa ainda **não definida** |
| E10 | **Incorporação complementar aberta** [C] | `complementaryTranscription {status: 'open', revision: 1, rule: 'DEC-PT-006', openedAt, openedBy, openRequestId, openDeclaration}` | Documento da versão finalizada e vigente | Metas e indicadores (`procedure: 'complementary-transcription'`); encerramento com conferência | Financeiro (sem edição cruzada); nova versão (`transcription-open`); edição dos campos | E3 + E6 + sem metas/indicadores na abertura + sem versão pendente |
| E11 | **Incorporação complementar encerrada** [C] | E10 + `closedAt`, `closedBy`, `closeRequestId`, `review`, `counts`, `closeDeclaration`; `revision: 2` | Idem | Leitura; nova versão (desbloqueada) | Metas e indicadores → `transcription-closed`; reabertura → `transcription-closed` | E10 |
| E12 | **Incorporação financeira aberta** [C] | `financialTranscription {status: 'open', revision: 1, rule: 'DEC-PT-011', workPlanId, openedAt, openedBy, openRequestId, openDeclaration}` | Idem | Categorias e itens (`procedure: 'financial-transcription'`); encerramento (sem itens ativos sem valor) | Metas (sem edição cruzada); nova versão (`financial-transcription-open`) | E3 + E6 + instrumento com transferência + sem financeiro na abertura |
| E13 | **Incorporação financeira encerrada** [C] | E12 + `closedAt`, `closedBy`, `closeRequestId`, `financialToken`, `summary {categories, items, activeItems, plannedCents}`, `closeDeclaration` | Idem | Leitura; nova versão | Financeiro → `financial-transcription-closed`; reabertura | E12 |
| E14 | **Correções materiais** [C] | No documento: `values.*` corrigidos, `revision + 1`, `lastCorrectionAt`, `lastCorrectionBy`, `correctionCount`. No evento `correction_{uid}_{requestId}`: `corrections[{field, before, after}]`, `justification`, `declaration`, `fromRevision`, `toRevision` | Versão finalizada; `workPlanEvents` | Consulta pelo GET do histórico (`work-plan.view`) | Não abrange metas, indicadores nem financeiro; não pode deixar o Plano sem os requisitos (`breaks-finalization`) | E3 |
| E15 | **Eventos e revisões** [C] | `revision` técnica por documento (Plano, meta, indicador, categoria, item, incorporação). Eventos com `action` ∈ `start`, `update`, `formal-act-update`, `finalize`, `components-reviewed`, `version-created`, `version-activated`, `material-correction`, `complementary-transcription-opened/closed`, `financial-transcription-opened/closed`, `goal-/indicator-/financial-category-/financial-item-created/updated` | Documentos e `workPlanEvents` | Somente o servidor lê (histórico de correções) | Navegador não lê nem grava (UXPT01-R03) | O **formato** dos eventos variou (ver nota abaixo) |

**Nota sobre E15:** o formato dos eventos variou entre incrementos [C]. Eventos `finalize` da DEV-02.2 não têm `sequence` nem `requestId`. `version-created` só tem `copiedComponents` desde a DEV-02.4. Leitores futuros devem ser tolerantes.

#### Parte B — interpretação futura, risco e migração

| # | Interpretação no modelo UX-PT-02 | Risco | Migração |
| --- | --- | --- | --- |
| E1 | Ausência continua significando "não estruturado"; o **primeiro salvamento válido** cria o original (contrato A) | Baixo | Não |
| E2 | Plano **com salvamento contínuo**. O valor `in-registration` deve continuar aceito pelos leitores. Ver **P1** (seção 7) para a vigência de um original apenas salvo | **Alto:** hoje um original em cadastramento **não é vigente** (E6); a PAG-OSC08 e a futura execução não o enxergam | Não migrar documentos; mudar a **regra de leitura** (DEC-UXPT-02.1), com decisão em P1 |
| E3 | Plano estruturado; a marca de finalização fica como **fato histórico** (quem e quando concluiu a conferência) e deixa de bloquear a edição direta (DEC-UXPT-02.2) | Médio: os bloqueios estão espalhados em três APIs e na interface | Não. Os campos `finalized*` e `componentReview` são preservados, nunca removidos |
| E4 | Sem mudança | Baixo | Não |
| E5 | Continua sendo a versão documental de um ato administrativo. Nas novas alterações formais, o ato é informado **no salvamento** (contrato D) | Médio: o fluxo atual cria v{n} em cadastramento antes da edição | Não |
| E6 | **Configuração vigente**, determinada sem depender de finalização obrigatória (P1 e P2) | **Alto:** `resolveCurrentVersion` é usado no servidor, na PAG-OSC05, na PAG-OSC08 e em `applicableVersionOn` | Não migrar dados; versionar a regra de leitura |
| E7 | Configuração histórica preservada (DEC-UXPT-02.4) | Médio: a correção material ainda é admitida em substituída (E7; P4) | Não |
| E8 | Fluxo legado. Uma v{n} pendente criada antes da UX-PT-02 precisa de destino definido (P2) | **Alto:** bloqueia novas alterações formais enquanto existir | Depende da decisão P2; nunca automática sem autorização |
| E9 | Continua bloqueada até regularização (DEC-PT-003, sem retroatividade) | **Alto:** sem procedimento definido | Somente por procedimento administrativo autorizado (P3) |
| E10 | Procedimento excepcional superado pela edição direta com classificação (correção cadastral). Uma incorporação **aberta** em dados existentes precisa de destino (P5) | Alto: hoje bloqueia nova versão e libera só um componente | Não automática; P5 |
| E11 | Registro histórico; equivale a um conjunto de correções cadastrais iniciais | Baixo | Não |
| E12 | Idem E10 (P5) | Alto | Idem E10 |
| E13 | Idem E11 | Baixo | Não |
| E14 | É a **correção cadastral** da DEC-UXPT-02.2, generalizada para metas, indicadores e financeiro (contrato C). Os eventos `material-correction` continuam válidos no histórico | Médio: o histórico atual só lê esse `action` | Não; leitura aditiva |
| E15 | Mantidos. Novos `action` serão **aditivos**; nenhum evento é apagado ou reescrito | Baixo, se os leitores forem tolerantes | Não |

**Inventário do ambiente [A]:** só uma leitura administrativa autorizada no Firebase de testes pode dizer quais de E1–E15 existem em dados reais. Antes de DEV-UXPT-02, recomenda-se essa leitura, sem gravação (seção 8). Contar, por parceria:
- versões por `registrationStatus` e `activation.status`;
- versões sem `activation` (v{n});
- incorporações por `status`;
- eventos por `action`.

### 2.2 Matriz de dependências da finalização

A coluna "Incremento" é **proposta** e subordinada ao PTI-UXPT-01; esta seção não gera comandos para os incrementos seguintes.
- **UXPT-02:** salvamento contínuo e primeiro salvamento.
- **UXPT-03:** correção cadastral generalizada.
- **UXPT-04:** alteração formal e ativação.
- **UXPT-05:** subpáginas e históricos.
- **UXPT-06:** retirada da interface legada e regularização.

| # | Dependência | Arquivo e função | Comportamento atual | Razão | Efeito da remoção da finalização obrigatória | Estratégia recomendada | Incremento |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D01 | `registrationStatus` | `src/domain/workPlans.ts`, `decideWorkPlanOperation` (l. 254) | `start` / `update` / `finalize` só se não finalizado; `correct` só se finalizado | Separar cadastro de correção (DEC-038, DEC-PT-002) | Não haverá distinção cadastro × correção pela situação | Nova decisão por **classificação** informada no salvamento (contratos B / C / D), mantendo a função atual para o fluxo legado até a retirada | UXPT-02 / 03 |
| D02 | `registrationStatus` | `api/_lib/workPlansService.ts`, `registrationOf` (l. 250) / `run` | Resolve a situação de cada ação (start, update, correct, finalize) | Idem | Idem | Introduzir as ações novas **ao lado** das atuais (corpo estrito novo); não mudar o significado das atuais | UXPT-02 |
| D03 | `registrationStatus` + `complementaryTranscription` | `api/_lib/workPlanComponentsService.ts`, `run` (l. 138–146) | Finalizada: só com incorporação aberta; senão `already-finalized`, `complementary-transcription-pending` ou `transcription-closed` | Proteger o Plano aprovado finalizado (DEC-PT-006) | Metas e indicadores passam a ser editáveis com classificação | Nova operação classificada (contrato B / C) que **não** depende de incorporação; incorporações abertas tratadas conforme P5 | UXPT-03 |
| D04 | `registrationStatus` + `financialTranscription` | `api/_lib/workPlanFinancialService.ts`, `run` (l. 132–139) | Idem para o financeiro (DEC-PT-011) | Idem | Idem | Idem; preservar a aplicabilidade por instrumento antes do ciclo de vida | UXPT-03 |
| D05 | `finalize` (requisitos) | `src/domain/workPlans.ts`, `checkFinalization` (l. 208) | Impede finalizar sem datas obrigatórias, com período incoerente ou sem aprovação declarada na parceria | DEC-038 | Os requisitos deixam de ser uma porta única | **Validação contextual** (DEC-UXPT-02.1): coerência (fim ≥ início) **bloqueia** o salvamento; completude vira **pendência informativa**; nada é rejeitado por estar incompleto | UXPT-02 |
| D06 | `finalize` (ato formal) | `src/domain/workPlanVersions.ts`, `checkVersionFinalization` (l. 422) | Exige ato formal válido para finalizar v{n} | DEC-034; HF-G05 | O ato passa a ser exigido **no salvamento** da alteração formal | `validateFormalAct` reutilizado no contrato D | UXPT-04 |
| D07 | `finalize` + DEC-PT-007 | `workPlansService.ts`, ramo da finalização (l. 598–) + `checkComponentReview` | Exige conferência de metas e indicadores, `componentsToken` e declaração | Evitar finalizar sem conferir os componentes | Sem finalização, não há momento único de conferência | Ver **P6**: manter a declaração como **atestado opcional** por subpágina ou dispensá-la; o `componentsToken` continua útil como controle de concorrência | UXPT-03 / P6 |
| D08 | `finalize` + DEC-PT-013 | `workPlansService.ts` (finalização) e `close-financial-transcription` + `financialPending` | Item ativo sem valor previsto impede finalizar e encerrar | DEC-PT-013 | Sem finalização, a regra não tem ponto de aplicação | Ver **P7**: aplicar no salvamento do item ou tratar como pendência | UXPT-03 / P7 |
| D09 | `finalizedAt` / `finalizedBy` | `parsing.ts`, `parseWorkPlan`; `WorkPlanPage.tsx` ("Cadastro finalizado internamente em …") | Exibidos como fato | Rastreabilidade | Não serão mais produzidos nos novos Planos | Preservar e exibir como histórico quando existirem; nunca apagar | UXPT-05 |
| D10 | `finalizationRequestId` | `workPlansService.ts` (idempotência da finalização) | Reenvio devolve o estado confirmado | Idempotência | Sem efeito nos novos fluxos | Manter enquanto a ação `finalize` existir | UXPT-06 |
| D11 | `activation` (ativação) | `workPlansService.ts`, finalização (l. 598–690) + `checkActivationChain` (l. 383) | A finalização de v{n} ativa a versão e marca a anterior como `superseded` na mesma transação | DEC-PT-003 | **A ativação perde seu gatilho** | Ativação passa a ocorrer no **salvamento da alteração formal** (contrato D), na mesma transação que cria o snapshot; mesmos campos `activation.*`; `rule` com a nova decisão | UXPT-04 |
| D12 | `activation` (vigência) | `workPlanVersions.ts`, `resolveCurrentVersion` (l. 212) / `currentVersionId` (l. 223) | Vigente = única v{n} `active` finalizada; senão original **finalizada** não substituída | DEC-PT-003 / 004 | Original apenas salva nunca seria vigente | Regra versionada: original estruturada (existente) passa a contar (P1); demais regras de inconsistência mantidas | UXPT-02 |
| D13 | `activation` (situação) | `workPlanVersions.ts`, `activationStatusOf` (l. 228); `vigency.ts` | Rótulos `in-registration`, `legacy-pending` etc. | Comunicação de vigência | O rótulo "Em cadastramento: ainda não vigente" deixa de valer para o original | Rótulos novos aditivos; manter `legacy-pending` | UXPT-05 |
| D14 | `activation` (efeitos) | `workPlanVersions.ts`, `applicableVersionOn` (l. 303) / `currentReference` (l. 278) | Indeterminada sem versão finalizada, com legado pendente ou sem data de efeitos | DEC-PT-005 / 039 (base da DEV-03.x) | `no-finalized-version` precisa de novo critério | Mesmo critério de D12; preservar a indeterminação conservadora | UXPT-02 / 04 |
| D15 | `create-version` | `workPlanVersions.ts`, `decideVersionCreation` (l. 356) | Exige base vigente **finalizada**, nenhuma versão em cadastramento, nenhum legado pendente e nenhuma incorporação aberta | DEC-034, PT-004, PT-006, PT-011 | A alteração formal acontece por edição direta classificada | Contrato D substitui a criação em duas etapas; as negativas `versions-inconsistent` e `legacy-version-pending` são mantidas | UXPT-04 |
| D16 | `create-version` (cópia) | `workPlanComponentsCopy.ts`, `readComponentsForCopy` / `copyComponents` | Copia até 480 documentos numa transação (482 escritas) | Versão integral (DEC-034) | Se o contrato D também aplicar as mudanças na mesma transação, pode passar de 500 escritas | Snapshot e alteração na mesma transação **somente** se couberem no limite; caso contrário, recusar com erro explícito (sem estado parcial) | UXPT-04 |
| D17 | `correct` | `workPlans.ts`, `validateCorrection` (l. 326) | Só campos do Plano; exige justificativa, declaração e manter os requisitos (`breaks-finalization`) | DEC-PT-002 | `breaks-finalization` perde sentido; a correção se estende às três subpáginas | Contrato C: mesmas garantias (antes e depois, justificativa, declaração, evento determinístico); requisito substituído pela validação contextual | UXPT-03 |
| D18 | `correct` (versão-alvo) | `decideWorkPlanOperation('correct')` | Admite **qualquer** versão finalizada, inclusive substituída (UXPT01-S12) | Correção de transcrição histórica | Precisa ser decidido se a correção cadastral vale para configurações históricas | P4 | UXPT-03 |
| D19 | `correct` (histórico) | `workPlansService.ts`, `history` (l. 704) | Lista só eventos `material-correction` dos campos do Plano | DEC-PT-002 | O histórico por subpágina (DEC-UXPT-02.3) exige novos tipos | Contrato E; consulta **aditiva** por `action` | UXPT-05 |
| D20 | `complementaryTranscription` | `workPlansService.ts`, `open-/close-transcription` (l. 358) | Só versão vigente finalizada sem metas e indicadores e sem versão pendente | DEC-PT-006 | Procedimento torna-se desnecessário | Manter a ação até P5; não abrir novas após a UX-PT-02 (decisão a confirmar) | UXPT-06 |
| D21 | `financialTranscription` | `workPlansService.ts`, `open-/close-financial-transcription` (l. 419) | Idem, com aplicabilidade por instrumento | DEC-PT-011 | Idem | Idem | UXPT-06 |
| D22 | `registrationStatus` (leitura) | `parsing.ts`, `parseWorkPlan` | **Descarta** documento com situação diferente de `in-registration` / `finalized` (UXPT01-L05) | Falha fechada | Um novo valor gravado antes de o cliente ser atualizado faria o Plano "desaparecer" | **Não introduzir novos valores** de `registrationStatus`; se for indispensável, publicar o **leitor antes do escritor** | UXPT-02 |
| D23 | `registrationStatus` (interface) | `WorkPlanPage.tsx` (l. 220–245, 440–545, 635–675) | Decide editor, finalização, correção e incorporações por situação | Idem D01 | Interface substituída pelas três subpáginas | UXPT-05; esta etapa não altera a interface | UXPT-05 |
| D24 | `registrationStatus` (indicadores) | `IndicatorsPage.tsx`, efeito (l. 64–75) | Exibe somente a versão vigente (D12) | PAG-OSC08 | Sem vigente, nada é exibido | Segue D12 | UXPT-02 |
| D25 | `workPlan.approvalDeclared` (parceria) | `checkFinalization` | Pendência da finalização | Plano aprovado declarado no cadastro (DEC-PAR) | Sem finalização, deixa de impedir | Pendência contextual (aviso), sem bloquear o salvamento; ver P8 | UXPT-02 |
| D26 | Regras | `firestore.rules` | Leitura com `work-plan.view`; nenhuma escrita | DEC-PT-001 | **Nenhum** (as regras não dependem da finalização) | Manter (DEC-UXPT-02.5); UXPT01-R01..R03 | — |

---

## 3. Documento 2 — Matriz de compatibilidade

### 3.1 Princípios de transição

1. **Sem migração automática de documentos.** A compatibilidade é obtida pela **leitura** (regras de interpretação versionadas), nunca reescrevendo dados.
2. **Somente acréscimos.** Novos campos, ações e `action` de eventos são acrescentados; nada é renomeado, removido ou reinterpretado com outro significado.
3. **Leitura tolerante, gravação estrita.** Mantém o padrão atual (`storedValues`, `storedFinancial(…, 'read')`, `parseWorkPlan`).
4. **Leitor antes do escritor.** Qualquer novo valor persistido só é gravado depois que todos os leitores (cliente e servidor) o aceitam. Ver D22.
5. **Legado convive.** As ações atuais (`start`, `update`, `finalize`, `correct`, `create-version`, incorporações) continuam funcionando até a retirada explícita autorizada.
6. **Histórico imutável.** Versões, eventos, `finalized*`, `componentReview`, `activation.*` e registros das incorporações nunca são apagados (DEC-UXPT-02.4).
7. **Autorização inalterada** (DEC-UXPT-02.5): `partnerships.view`, `work-plan.view` e `work-plan.edit`; administrador sem privilégio implícito; isolamento por caminho e por transação.

### 3.2 Correspondência estado legado → modelo UX-PT-02

| Legado | Modelo UX-PT-02 | Subpágina afetada | Risco | Estratégia |
| --- | --- | --- | --- | --- |
| Não estruturado (E1) | Sem registro; o primeiro salvamento válido cria o original | Plano Aprovado (e as outras duas, se o primeiro salvamento ocorrer nelas: P9) | Baixo | Contrato A |
| Original em cadastramento (E2) | Plano em edição contínua; vigente conforme P1 | As três | **Alto** (vigência) | Regra D12 versionada; sem migração |
| Original finalizado (E3 / E4) | Plano estruturado; finalização como fato histórico | As três | Médio | Bloqueios D01–D04 substituídos pela classificação |
| v{n} finalizada e ativa (E5 / E6) | Configuração vigente após ato administrativo | As três | Baixo | Sem mudança de dados |
| v{n} ou original substituída (E7) | Configuração histórica, somente consulta (P4 para correções) | As três | Médio | Contrato E |
| v{n} em cadastramento, `awaiting-finalization` (E8) | Sem equivalente direto no modelo de edição direta | Plano Aprovado | **Alto** | P2; enquanto não decidido, o fluxo legado (`finalize`) continua disponível |
| v{n} legada `pending-decision` finalizada (E9a) | Pendência de regularização | Identificação (histórico de atos) | **Alto** | P3; sem ativação retroativa |
| Cadeia inconsistente (E9c) | Pendência de regularização | — | Alto | Recusa conservadora mantida |
| Incorporação aberta (E10 / E12) | Sem equivalente; substituída pela correção cadastral | Metas / Financeiro | Alto | P5 |
| Incorporação encerrada (E11 / E13) | Histórico de correções cadastrais iniciais | Metas / Financeiro | Baixo | Contrato E lê os eventos `*-transcription-*` e `procedure` |
| Correção material (E14) | Correção cadastral do Plano Aprovado | Plano Aprovado | Baixo | Contrato C, compatível com `material-correction` |
| Ato formal em v{n} (`formalAct`) | Ato administrativo no histórico da Identificação da Parceria (DEC-UXPT-02.3) | Identificação | Médio (permissões: P10) | Contrato E (atos) servido pelo servidor |
| Eventos (E15) | Mantidos; novos `action` aditivos | — | Baixo | Leitores tolerantes |

### 3.3 Riscos de incompatibilidade (síntese)

| ID | Risco | Probabilidade | Impacto | Mitigação |
| --- | --- | --- | --- | --- |
| R1 | Planos apenas salvos não serem considerados vigentes (PAG-OSC08, execução futura) | Alta | Alto | D12 + P1 antes de liberar o salvamento contínuo |
| R2 | Novo valor de `registrationStatus` descartar Planos no cliente antigo | Média | Alto | D22; não criar valores novos |
| R3 | v{n} pendente (E8) ou legada (E9) bloquear indefinidamente as alterações formais | Média [A] | Alto | P2 / P3; inventário do ambiente |
| R4 | Alteração formal com cópia integral passar de 500 escritas | Baixa (limites atuais) | Alto | D16: recusa explícita; contagem no domínio |
| R5 | Classificação errada (formal registrada como correção) | Média | Alto (jurídico) | Classificação obrigatória e explícita; declaração; auditoria com antes e depois; sem classificação presumida |
| R6 | Histórico de atos exigir leitura de `workPlans` por quem só tem `partnerships.view` | Alta | Médio | P10; servir pelo servidor; não alterar regras sem decisão |
| R7 | Incorporação aberta em dados reais sem destino | Desconhecida [A] | Médio | P5 |
| R8 | Testes legados (finalização) confundidos com regressão quando a UX-PT-02 os substituir | Alta | Médio | Marcação "LEGADO" e substituição explícita (seção 5) |
| R9 | Perda da conferência DEC-PT-007 e do valor obrigatório DEC-PT-013 por falta de ponto de aplicação | Alta | Médio | P6 / P7 antes de DEV-UXPT-03 |

---

## 4. Documento 3 — Contratos técnicos propostos

> **Propostas documentadas.** Nenhum endpoint, serviço ou tipo foi criado nesta etapa. Nomes de ação, campos e códigos são sugestões a confirmar na implementação. Todos herdam o padrão do item 1.2 e são **aditivos** às ações existentes.

**Elementos comuns:**
- **Autenticação:** token Bearer verificado; 401 `invalid-token` / `session-expired`.
- **Corpo:** estrito (chaves exatas), `requestId` `^[A-Za-z0-9_-]{8,64}$`, IDs `^[A-Za-z0-9_-]{1,128}$`, `workPlanId` por `VERSION_ID_PATTERN`; caso contrário, 400 `invalid-request`.
- **Autorização** (`evaluate` + domínio): `work-plan.edit` para gravar e `work-plan.view` para consultar, avaliada **antes** de revelar a parceria (403 com `reason`). Isolamento por caminho `oscs/{oscId}` e conferência de `oscId` / `partnershipId` nos documentos (404). Parceria arquivada: 403 `partnership-archived`. Suspensão comercial: 403 `commercial-suspension`. Administrador sem privilégio implícito.
- **Transação:** uma transação Firestore por pedido; todas as leituras antes das escritas; evento na mesma transação.
- **Respostas:**
  - 200 / 201 `{ok: true, …}`;
  - 409 `stale` com `revision` atual;
  - 409 `forbidden` com `reason` de estado;
  - 422 com `fields` / `pending`;
  - 500 `internal` sem detalhes;
  - 503 `not-configured`.
- **Datas:** `serverToday()` (Brasília) e `FieldValue.serverTimestamp()`.

### A. Primeiro salvamento

| Aspecto | Especificação |
| --- | --- |
| Operação | `PATCH /api/osc-work-plans` com `expectedRevision: 0` (ou ação `save` com `expectedRevision: 0`): "espero que o original não exista" |
| Entradas | `oscId`, `partnershipId`, `requestId`, `expectedRevision: 0`, `changes` (subconjunto de `FIELD_IDS` no formato de `parseFieldValue`) |
| Saídas | 201 `{ok, created: true, workPlan: {id: 'original', revision: 1}, pending: string[]}`. Se o original já existir com a mesma autoria e o mesmo pedido: 200 `{created: false}` |
| Pré-condições | Parceria existente da OSC; `workPlans/original` inexistente |
| Autorização | `work-plan.edit`; parceria não arquivada; sem suspensão comercial |
| Validações | `validateChanges` (formato, limites, período coerente); `changes` não vazio. Completude **não** é exigida (D05) |
| Garantias transacionais | `tx.create(original)` com os mesmos campos estruturais do `start` (`origin`, `document`, `schemaVersion`) **mais** os valores, e o evento, na mesma transação |
| Concorrência | ID fixo `original`: dois primeiros salvamentos simultâneos colidem; o perdedor relê e recebe 409 `stale` (`revision: 1`) |
| Idempotência | `startRequestId = requestId` e `lastUpdateRequestId = requestId`; o reenvio do mesmo pedido pelo mesmo usuário devolve o estado sem novo evento |
| Eventos | `start` (compatível) seguido de `update` com `fields`, ou um único `start` com `fields`; decidir na implementação mantendo a leitura dos eventos antigos |
| Erros | 409 `stale` (já existe com revisão > 0); 422 `invalid-values`; 404 parceria |
| Compatibilidade | `registrationStatus: 'in-registration'` (D22); `start` continua aceito; metas e financeiro antes do original: ver P9 |

### B. Salvamento contínuo

| Aspecto | Especificação |
| --- | --- |
| Operação | Campos do Plano: `PATCH /api/osc-work-plans` (`changes`), sem distinção por situação. Metas, indicadores e financeiro: as APIs atuais de componentes, com o mesmo contrato de `data` completo e `expectedRevision` |
| Entradas | Iguais às atuais, mais `classification` quando a versão-alvo for **estruturada** (ver C / D): `'registration'` (preenchimento de informação ainda não registrada), `'cadastral-correction'` ou `'formal-alteration'` |
| Saídas | 200 `{ok, changed, workPlan / component / record: {id, revision}, pending: string[]}`. `pending` = validação contextual: obrigatórios ausentes, aprovação não declarada, item sem valor (P7) |
| Pré-condições | Versão-alvo = configuração **vigente** ou em edição (nunca substituída, salvo P4) |
| Autorização | `work-plan.edit`; financeiro só em instrumento com transferência (`financial-not-applicable`) |
| Validações | As do domínio atual (`validateChanges`, `validateGoal`, `validateIndicator`, `validateFinancialItem(…, 'write')`, `linkIntegrity`, `financialIntegrity`, códigos únicos, limites). Só bloqueia **incoerência**, nunca **incompletude** |
| Garantias transacionais | Releitura de OSC, vínculo, parceria, versão e da subcoleção afetada; gravação e evento atômicos |
| Concorrência | `expectedRevision` por documento (409 `stale`); sem bloqueio global entre subpáginas (independência, DEC-UXPT-02.1) |
| Idempotência | Atual: `lastUpdateRequestId` / `creationRequestId` e IDs determinísticos `sha256(uid, requestId)` |
| Eventos | Atuais (`update`, `goal-*`, `financial-*`), com `procedure: 'registration'` e `classification` |
| Erros | Atuais + 422 `classification-required` quando a versão é estruturada e a classificação não foi informada |
| Compatibilidade | Ações e eventos atuais preservados; `procedure` antigo (`registration`, `complementary-transcription`, `financial-transcription`) continua lido |

### C. Correção cadastral

| Aspecto | Especificação |
| --- | --- |
| Operação | `classification: 'cadastral-correction'` no salvamento de qualquer subpágina; para os campos do Plano, equivale à ação `correct` atual, generalizada |
| Entradas | Alvo (campos do Plano, ou `componentKind` + `componentId`, ou `kind` + `id`), `expectedRevision`, novo conteúdo, `justification` (`cleanJustification`: 10 a 2000 caracteres significativos), `declaration: true` (texto equivalente a `CORRECTION_DECLARATION`, por subpágina) |
| Saídas | 200 `{ok, corrected: true, revision, warnings}`; reenvio: `{corrected: false, revision}` |
| Pré-condições | Configuração vigente (P4 define se as históricas admitem); ao menos um valor efetivamente diferente (`no-change`) |
| Autorização | `work-plan.edit` (DEC-PT-001 / DEC-UXPT-02.5) |
| Validações | Mesmas do salvamento; justificativa; declaração. **Não cria versão** e não altera `origin`, `activation`, `formalAct` nem os campos `finalized*` |
| Garantias transacionais | Atualiza só o documento indicado + evento; versões anteriores e eventos intactos (caracterizado em UXPT01-S07) |
| Concorrência | `expectedRevision` do documento corrigido |
| Idempotência | Evento com ID determinístico `correction_{uid}_{requestId}` (padrão atual), criado com `tx.create` |
| Eventos | `material-correction` (campos do Plano, compatível) e novos `goal-corrected`, `indicator-corrected`, `financial-category-corrected`, `financial-item-corrected` com `corrections[{field, before, after}]`, `justification`, `declaration`, `fromRevision`, `toRevision`, `workPlanId`, `sequence` |
| Erros | 422 `invalid-correction` (`no-change`, `justification-*`, `declaration-required`, campos); 409 `stale`; 403 |
| Compatibilidade | O histórico atual (GET) continua devolvendo `material-correction`; o contrato E acrescenta os novos tipos |

### D. Alteração formal

| Aspecto | Especificação |
| --- | --- |
| Operação | `classification: 'formal-alteration'` + `formalAct` no salvamento. Em **uma** transação: (1) preserva a configuração vigente como versão histórica (snapshot integral, como `create-version`); (2) cria `v{n+1}` com a nova configuração; (3) ativa `v{n+1}` e marca a anterior como `superseded` (D11) |
| Entradas | `baseWorkPlanId` (vigente), `baseRevision`, `componentsToken` + `financialToken` vistos (concorrência entre subcoleções), `formalAct` (`validateFormalAct`: tipo, data não futura, `typeDescription` em "outro ato", `effectiveDate` opcional), alterações (campos e/ou componentes), `declaration` |
| Saídas | 201 `{ok, created: true, workPlan: {id: 'v{n+1}', sequence, revision: 1, activationStatus: 'active', supersededWorkPlanId}, effects: 'future' / 'reached' / 'not-informed'}` |
| Pré-condições | Base = vigente (`resolveCurrentVersion` determinado); sem cadeia inconsistente; sem legado pendente (E9); sem v{n} em cadastramento (E8, até P2); sem incorporação aberta (até P5) |
| Autorização | `work-plan.edit`; não arquivada; sem suspensão comercial |
| Validações | Ato formal; alterações válidas pelo domínio; **ao menos uma alteração material** (`isMaterialDiff`); limite de escritas (D16) calculado antes de gravar |
| Garantias transacionais | Leitura de todas as versões e da base; `tx.create` determinístico de `v{n+1}`; cópia com `inheritedFrom`; `activation.*` só na anterior (valores, `revision` e finalização intactos, como hoje); nenhum estado parcial |
| Concorrência | `baseRevision` + `componentsToken` / `financialToken`; pedidos simultâneos colidem no mesmo `v{n+1}` |
| Idempotência | `creationRequestId` + `createdBy` (padrão atual de `create-version`) |
| Eventos | `version-created` (com `classification: 'formal-alteration'`, `actType`, `copiedComponents`, `changes`) e `version-activated` (com `rule` da nova decisão, `effectiveDate`, `effectsAtActivation`) |
| Erros | 422 `invalid-formal-act` / `no-material-change` / `too-many-writes`; 409 `base-not-current`, `versions-inconsistent`, `legacy-version-pending`, `pending-version-exists`, `stale`, `components-changed`, `financial-changed` |
| Compatibilidade | Mesma estrutura de v{n} (`origin`, `formalAct`, `activation`), lida pelo `parseWorkPlan` atual sem alteração; `registrationStatus` gravado como `'finalized'` (D22) para que a regra atual de vigência continue válida, **ou** conforme decisão P1 |

### E. Consulta histórica

| Aspecto | Especificação |
| --- | --- |
| Operação | `GET /api/osc-work-plans?oscId&partnershipId&kind=acts / corrections / versions[&workPlanId][&subpage=plan / goals / financial]` (estende o GET atual, que permanece com a mesma resposta quando `kind` é omitido) |
| Entradas | Parâmetros estritos (chaves conhecidas, sem repetição) |
| Saídas | `acts`: `[{workPlanId, sequence, type, typeDescription, reference, actDate, effectiveDate, effects, activatedAt, supersededAt, status}]` a partir de `workPlans/v{n}`. `corrections`: eventos `material-correction` e `*-corrected`, mais os eventos de incorporação (`procedure`) como "transcrição inicial". `versions`: o que o cliente já lê pelas regras |
| Pré-condições | Parceria da OSC |
| Autorização | `corrections` e `versions`: `work-plan.view` (atual). `acts` na Identificação da Parceria: **P10** (`partnerships.view` ou `work-plan.view`) |
| Validações | Filtros por `oscId`, `partnershipId`, `isVersionId`; limite de resultados (padrão atual: 200) |
| Garantias transacionais | Leitura sem transação (consistência eventual aceitável para consulta), como hoje |
| Concorrência | Não se aplica |
| Idempotência | Leitura pura |
| Eventos | Nenhum |
| Erros | 400, 401, 403, 404, 500 (padrão atual) |
| Compatibilidade | Lê eventos de todos os formatos históricos (E15); autor apresentado como "você" ou pela competência, sem e-mails (padrão atual) |

---

## 5. Documento 4 — Plano de testes e transição

### 5.1 Testes existentes que protegem o comportamento atual

| Suíte | Comando | Escopo relevante |
| --- | --- | --- |
| Domínio | `npm run test:unit` | `workPlans.test.ts`, `workPlanVersions.test.ts`, `workPlanComponents.test.ts`, `workPlanFinancial.test.ts`, `authorization.test.ts`, `partnerships.test.ts` |
| Interface | `npm run test:ui` | `WorkPlan.test.tsx` (PAG-OSC05, PAG-OSC08, finalização, correção, versões, incorporações, financeiro) |
| Servidor (emuladores) | `npm run test:server` | `workPlans`, `workPlanVersions`, `workPlanComponents`, `workPlanTranscription`, `workPlanFinancial`, `workPlanFinancialTranscription` |
| Regras (emulador) | `npm run test:rules` | `partnerships.rules.test.ts` (Plano, metas, financeiro, incorporações) |
| E2E | Fora do repositório (`scratchpad/e2e`) | Não versionados; ver lacuna L4 |

### 5.2 Testes de caracterização adicionados (DEV-UXPT-01)

| Arquivo | IDs | O que registram |
| --- | --- | --- |
| `src/domain/workPlanLegacy.characterization.test.ts` | C01–C10 | Matriz de operações por situação (**LEGADO**); arquivada / suspensa / encerrada; permissões individuais, administrador e isolamento; vigência dependente da finalização (**LEGADO**); inconsistências; rótulos incluindo `pending-decision` (**LEGADO**); cadeia de ativação (**LEGADO**); versão aplicável por data; criação de versão (**LEGADO**); aplicabilidade financeira |
| `src/services/workPlans/legacyParsing.characterization.test.ts` | L01–L07 | Leitura de original em cadastramento e finalizado (inclusive sem `componentReview`); original substituída; v{n} sem ativação lida como `pending-decision` (**LEGADO**); descarte de documentos fora do contrato, **inclusive `registrationStatus` desconhecido** (D22); valores inválidos; incorporações abertas e encerradas |
| `tests/server/workPlanLegacy.characterization.server.test.ts` | S01–S18 | Não estruturado (nenhuma criação implícita); `start` idempotente; salvamento com revisão, idempotência e `stale`; `procedure: 'registration'`; bloqueios após finalização (**LEGADO**); correção material com campos históricos preservados e evento determinístico; ativação só na finalização (**LEGADO**); v{n} pendente; legado `pending-decision`; cadeia inconsistente; versão substituída ainda corrigível (**LEGADO**); incorporações abertas e encerradas (**LEGADO**); isolamento nas três APIs; permissões; aplicabilidade e arquivamento |
| `tests/rules/workPlanLegacy.rules.test.ts` | R01–R03 | Leitura de todos os estados legados com `work-plan.view`; nenhuma desfinalização, ativação, reabertura ou exclusão pelo navegador; auditoria ilegível e imutável |

**Regra de manutenção.** Quando DEV-UXPT-02+ mudar um comportamento marcado **LEGADO**:
- o teste correspondente é **substituído** no mesmo commit por outro que especifique o novo contrato;
- a mensagem do commit cita o ID (por exemplo, "substitui UXPT01-S05");
- nunca enfraquecer asserções nem marcar `skip`.

Testes **não** marcados LEGADO (isolamento, permissões, idempotência, revisões, preservação de campos históricos, aplicabilidade, regras) devem continuar **verdes sem modificação**.

### 5.3 Lacunas de cobertura

| ID | Lacuna | Recomendação |
| --- | --- | --- |
| L1 | Não há inventário dos estados em dados reais [A] | Leitura administrativa autorizada no Firebase de testes (somente contagens) antes de DEV-UXPT-02 |
| L2 | Concorrência real entre transações (dois salvamentos simultâneos) só é coberta indiretamente (ID determinístico, `revision`) | Teste de servidor com pedidos paralelos ao implementar o contrato A |
| L3 | Limite de 500 escritas na alteração formal com alterações | Teste de limite ao implementar o contrato D |
| L4 | Suítes E2E fora do repositório | Versionar em `tests/e2e` (decisão pendente desde a DEV-02.5) |
| L5 | Leitura tolerante de eventos de formatos antigos (E15) não é exercitada por nenhum leitor atual além de `material-correction` | Testes ao implementar o contrato E |
| L6 | Interface: nenhum teste de caracterização novo (a interface será substituída na UXPT-05) | `WorkPlan.test.tsx` permanece como proteção da página atual |

### 5.4 Transição recomendada (ordem, sem comandos)

1. Decisões P1–P10 e inventário do ambiente (L1).
2. Leitores tolerantes: regra de vigência versionada (D12 / D14) e histórico aditivo (contrato E), sem mudar a gravação.
3. Salvamento contínuo e primeiro salvamento (contratos A e B), com validação contextual. As ações legadas continuam ativas.
4. Correção cadastral generalizada (contrato C).
5. Alteração formal por edição direta com ativação no salvamento (contrato D).
6. Três subpáginas e históricos (UX-PT-01); retirada da finalização na interface.
7. Retirada controlada das ações legadas e regularização dos estados E8 a E10 e E12, somente com autorização.

---

## 6. Defeitos e observações registrados (não corrigidos)

| ID | Observação | Classificação | Evidência |
| --- | --- | --- | --- |
| O1 | Correção material é admitida em versão **substituída** (`decideWorkPlanOperation('correct')` só exige "finalizado") | Comportamento não especificado explicitamente; **não é defeito** comprovado | UXPT01-S12; decisão P4 |
| O2 | Em versão substituída sem metas, o servidor de componentes responde `complementary-transcription-pending` (sugere incorporação), mas a abertura é recusada com `transcription-not-current` | Mensagem potencialmente enganosa (UX) | `workPlanComponentsService.ts` l. 145; UXPT01-S12 |
| O3 | Servidor (`summaryOf`) e cliente (`parseWorkPlan`) interpretam v{n} sem `activation.status` de forma diferente (`null` × `pending-decision`); ambos levam a "não vigente" e "legado pendente", portanto **sem divergência de efeito** | Assimetria a manter coerente | `workPlansService.ts` l. 258; `parsing.ts`; UXPT01-L04 |
| O4 | O servidor de componentes aceita `permission.reason === 'partnership-archived'` na pré-checagem e reavalia depois (sem efeito, porque a decisão seguinte recusa) | Código redundante, sem defeito | `workPlanComponentsService.ts` l. 118 |

Nenhum defeito exige correção funcional nesta etapa.

## 7. Pendências que exigem decisão funcional

| ID | Pergunta | Por que bloqueia |
| --- | --- | --- |
| P1 | Sem finalização, quando o **original** passa a ser a configuração vigente: ao primeiro salvamento, ao atingir os campos obrigatórios, ou por outra marca? E os originais legados em cadastramento (E2)? | D12, D14, D24; R1 |
| P2 | Destino das v{n} legadas **em cadastramento** (E8): concluir pelo fluxo legado, converter em alteração formal no próximo salvamento, ou regularização administrativa? | Bloqueia o contrato D (`pending-version-exists`) |
| P3 | Procedimento de regularização das v{n} finalizadas sem ativação (`pending-decision`, E9a) e de cadeias inconsistentes | Bloqueio permanente de alterações formais nessas parcerias |
| P4 | A correção cadastral se aplica a configurações **históricas** (substituídas) ou só à vigente? | Contrato C; O1 |
| P5 | Destino das incorporações **abertas** (E10 / E12) existentes: encerramento pelo usuário, encerramento administrativo, ou conversão em correção cadastral? E a abertura de novas após a UX-PT-02? | Bloqueiam o contrato D; D20 / D21 |
| P6 | A conferência de metas e indicadores com declaração (DEC-PT-007) é mantida como atestado por subpágina, transferida para a alteração formal, ou dispensada? | D07 |
| P7 | O valor previsto obrigatório para itens ativos (DEC-PT-013) passa a ser exigido **no salvamento do item** ou vira pendência contextual? | D08; mudança de comportamento perceptível |
| P8 | A falta de declaração de aprovação do Plano na parceria (`workPlan.approvalDeclared`) deve impedir o primeiro salvamento ou apenas gerar pendência? | D25 |
| P9 | Metas, indicadores ou financeiro podem ser salvos **antes** de existir o original (subpáginas independentes)? Se sim, o primeiro salvamento em qualquer subpágina cria o original? | Contrato A; hoje responde 404 (UXPT01-S01) |
| P10 | Qual permissão autoriza consultar o **histórico de atos administrativos** na Identificação da Parceria: `partnerships.view` (página) ou `work-plan.view` (dados de `workPlans`)? | DEC-UXPT-02.3 × DEC-UXPT-02.5; R6 |

## 8. Critérios para iniciar DEV-UXPT-02

1. DEV-UXPT-01 homologado pelo responsável do projeto.
2. Decisões **P1, P8 e P9** registradas, pois afetam diretamente os contratos A e B. As demais (P2–P7, P10) podem ser decididas antes dos incrementos que as usam, mas não podem ser presumidas.
3. Inventário do ambiente (L1) realizado por leitura autorizada, ou dispensa expressa.
4. Suítes verdes em `develop`: `typecheck`, `lint`, `test:unit`, `test:ui`, `test:server`, `test:rules`, `test:auth`, `build`, incluindo as caracterizações UXPT01.
5. Compromisso de implementação: contratos A e B **aditivos**, sem novo valor de `registrationStatus` (D22), sem alteração das Security Rules e das permissões, sem migração de documentos.
