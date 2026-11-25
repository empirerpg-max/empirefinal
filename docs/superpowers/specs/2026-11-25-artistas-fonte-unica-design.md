# Artistas: fonte única (aba ARTISTAS → D1) e edição pelo jogador — design

Data: 2026-11-25 · Status: aguardando aprovação

## Intenção e porquê

Hoje os dados de um artista vivem em dois lugares que podem discordar:

- aba **ARTISTAS** (planilha de usuários `1lFw9l76…`, `googleSheetsService.usuarios`):
  Nome, Foto, Gravadora, Fortunas, **ID Usuário** (dono), ID_unico,
  **BIOGRAFIA**, **FOTO**, **GÊNERO PRINCIPAL**, **PAÍS**, CAPA PERFIL, ANO EM
  QUE INICIOU A CARREIRA, GÊNERO (sexo), ARTISTA BASE;
- aba **INFOS ACTS** (planilha `registrosCharts`): foto exibida no perfil,
  biografia ("ESCREVA SOBRE O SEU ARTISTA"), nacionalidade (col. N, usada nos
  charts por país via `artista_info` no D1, alimentada pelo `EnvioD1.gs`).

O usuário quer **a ARTISTAS como fonte única** de dados de artista em todo o
app, **aposentar a leitura da INFOS ACTS**, e dar autonomia ao jogador dono:

- **Nacionalidade (PAÍS):** preencher se vazia; **depois de salva, travada**
  (só admin troca) — ela pesa nos charts por país.
- **Estilo principal (GÊNERO PRINCIPAL):** preencher e editar quando quiser.
- **Foto:** trocar quando quiser.
- **Biografia:** editar quando quiser.

## Objetivos

- Tabela D1 `artistas` (espelho da aba ARTISTAS) como **fonte de leitura** de
  todo o app para: nome, dono, foto, capa de perfil, biografia, gênero
  principal, país, gravadora (e demais colunas usadas hoje, ver "Leitores").
- Edição pelo dono grava **primeiro no D1** e manda cópia para a aba ARTISTAS
  em segundo plano (mesmo padrão "D1 primeiro, planilha como backup" do
  catálogo).
- **Importação única** na estreia: ARTISTAS → D1; onde a ARTISTAS estiver
  **vazia** e a INFOS ACTS tiver o dado (país/nacionalidade, foto,
  biografia), usa o da INFOS ACTS — ninguém perde nada. O que veio da INFOS
  ACTS também é escrito na aba ARTISTAS (para a planilha ficar completa).
- Depois da estreia, **nenhum código do app lê a INFOS ACTS**.
- Charts por país passam a usar a nacionalidade da tabela `artistas`.

## Não-objetivos

- Mudar fortuna, contratos, gravadora, fadiga (continuam como estão hoje,
  só passam a ser lidos do espelho quando já eram lidos da ARTISTAS).
- Criar artista novo (fluxo atual continua; só passa a gravar também no D1).
- Editar a aba INFOS ACTS (fica como está; o app só deixa de ler).

## Anti-objetivos

- Perder país/foto/biografia que só existiam na INFOS ACTS.
- Jogador trocando a nacionalidade depois de salva.
- Jogador editando artista de outro jogador.
- Mais leituras de planilha (hoje perfil/prêmios/charts leem planilha).
- Foto/bio editada que demora a aparecer (cache velho).

## Abordagens

- **A) Espelho no D1 como fonte de leitura (escolhida).** Rápido, sem gastar
  cota do Google, edição vale na hora; mais trabalho (mexe em todos os
  leitores).
- B) Ler a aba ARTISTAS direto, com cache. Descartada: continua no limite do
  Google, que já derrubou o app; edição demora a aparecer.
- C) Manter a INFOS ACTS copiando da ARTISTAS. Descartada: vai contra
  aposentar a INFOS ACTS e as duas continuariam divergindo.

## Design

### Dados

Tabela D1 `artistas` (banco `CATALOGO_DB`), uma linha por artista:
`id_unico` (PK, coluna ID_unico; se vazia, `nome`+`id_usuario`), `nome`,
`nome_upper` (busca sem acento/caixa), `id_usuario` (dono), `gravadora`,
`foto_url`, `capa_perfil_url`, `biografia`, `genero_principal`, `pais`,
`pais_definido_em`, `ano_inicio`, `sexo` (coluna "GÊNERO"), `artista_base`,
`linha_planilha` (para a cópia de volta), `atualizado_em`. Colunas de
fortuna/contrato ficam no espelho só se algum leitor migrado precisar delas
(construtor decide a lista exata pelo que os leitores usam).

Foto: a aba tem duas colunas ("Foto" col. B e "FOTO" col. S); no espelho
`foto_url` = FOTO (S), senão Foto (B). Na edição, grava nas duas.

### Sincronização

- **Planilha → D1:** importação única (rota admin, como as de backfill que
  já existem) + reconciliação periódica no cron que já roda. A reconciliação
  **cria** artistas que estão na planilha e ainda não no D1 e **atualiza só
  as colunas que o jogador não edita** (gravadora, dono, fortunas, contrato).
  Os campos editáveis pelo jogador (foto, biografia, gênero principal, país)
  têm o D1 como dono depois da importação: a planilha nunca sobrescreve a
  edição do jogador. *Call meu.*
- **D1 → planilha:** cada edição do jogador grava a(s) célula(s) da linha do
  artista na ARTISTAS em segundo plano (`ctx.waitUntil`), com nova tentativa
  se o Google recusar; falha não desfaz a edição no D1.

### Edição pelo jogador (perfil do artista, aba "Gestão")

A tela do artista (`src/routes/artistas.$nome.index.tsx`) já tem, para o
dono, a aba Gestão com modais de **foto**, **biografia** e **capa**. Eles
passam a gravar no D1 (via API nova) e ganham:

- **Nacionalidade:** campo com a lista de países de `pais_peso` (a mesma do
  foco do lançamento). Se vazio, o dono escolhe e confirma ("Depois de
  salva, só a administração pode alterar."). Se preenchido, só leitura; admin
  vê o campo liberado.
- **Estilo principal:** lista com os gêneros já usados na ARTISTAS + catálogo
  (ex.: POP, R&B, ALTERNATIVE/ROCK, RAP, FUNK…), editável sempre. *Call meu:*
  lista fechada para manter os filtros de gênero consistentes; admin pode
  incluir gêneros (decisão do construtor: constante no código ou config).
- **Foto e biografia:** como hoje (upload de foto pelo fluxo de upload que
  já existe; biografia em texto), gravando no D1.
- Só o **dono** (ID Usuário do artista = usuário logado, conferido no
  servidor pela sessão) ou **admin** grava. Regras de botões do `CLAUDE.md`;
  voltar = tela anterior (regra do `CLAUDE.md`).
- Atalho: na Gestão do jogador (`Gestao.tsx`), um aviso "Complete o perfil de
  {artista}: nacionalidade / estilo" quando faltar, levando à aba Gestão do
  artista. *Call meu.*

### API

- `GET /api/artistas/:nome/perfil` → dados do espelho (público).
- `POST /api/artistas/:nome/perfil` → `{ foto_url?, biografia?, genero_principal?, pais? }`;
  dono/admin; `pais` recusado com 409 se já preenchido e não admin
  ("A nacionalidade já foi definida. Peça à administração para alterar.").
  Limpa os caches de artista e de charts (nacionalidade muda o recorte da
  semana em andamento).

### Leitores a migrar (INFOS ACTS → `artistas`)

- `artistasController.ts` (`getArtistInfoController`: foto, biografia;
  `garantirLinhaInfosActs` na criação → passa a criar a linha no D1).
- `awardsController.ts` (foto/dados com fallback INFOS ACTS).
- `votacaoController.ts`, `indicacoesController.ts` (fotos/dados de artista).
- Charts: `artista_info` (nacionalidade, foto, gênero) → ler de `artistas`.
  O `EnvioD1.gs` pode continuar mandando artistas (ignorado) — *call meu:* o
  app para de usar `artista_info`; o script não precisa mudar.
- Demais leitores da aba ARTISTAS na planilha (`userController`,
  `artistasController` dono/gravadora, `fortunaChartsController` leitura)
  passam a ler o espelho quando for só leitura. Escritas de fortuna/contrato
  continuam como estão (fora de escopo), mas também atualizam o espelho.
- Rotas `adminDiag*`/`adminFix*` de INFOS ACTS: ficam (são ferramentas
  manuais), sem uso pelo app.

### Respostas da revisão

- **Chave:** a coluna ID_unico está preenchida em todas as ~136 linhas e é
  única; os nomes também são únicos. PK = `id_unico`; a API usa o nome (busca
  por `nome_upper`). Atenção: há linha com nome e ID_unico de nomes
  diferentes (ex.: "Sebastian" / "Tyler Strand…", artista renomeado) — o
  ID_unico é a identidade, o nome é o atual.
- **Ordem:** a reconciliação só roda depois que a importação única terminar
  (marca em `chart_config`/config, como `charts_d1_ativo`). Valores da INFOS
  ACTS entram **uma vez só**, na importação.
- **Charts e histórico:** os charts por país já leem a nacionalidade atual na
  hora da leitura (decidido no design dos charts); como a nacionalidade fica
  travada depois de salva, o histórico só muda quando um país vazio é
  preenchido ou o admin corrige — aceito.
- **Fortuna/contrato:** **fora do espelho.** Quem lê/escreve fortuna e
  contrato continua na planilha como hoje. O espelho guarda só identidade e
  perfil (nome, dono, gravadora, foto, capa, bio, gênero principal, país,
  ano, sexo, artista base).
- **Outros leitores:** Apps Script e ferramentas manuais seguem lendo a aba
  ARTISTAS, que continua atualizada pela cópia das edições. O teste "ninguém
  lê INFOS ACTS" ignora `adminDiag*`/`adminFix*`/`adminBackfill*`.
- **Foto:** o `FotoModal` atual já usa o upload para o Drive que existe
  (`/api/gestao/upload`); só muda onde grava o link.

## Custo

- Leituras: perfil, prêmios, votação, charts passam a ler do D1 (cache curto
  por isolate) em vez da planilha → **menos** leituras do Google.
- Escritas: 1 por edição do jogador (+ cópia na planilha). Importação única ≈
  nº de artistas (centenas).

## Testes esperados

- Importação: ARTISTAS vazia + INFOS ACTS com dado → espelho com o dado;
  ARTISTAS preenchida vence.
- Edição: dono grava bio/foto/gênero; segunda gravação de país pelo dono →
  409; admin troca país; não-dono → 403.
- Charts por país usam a nacionalidade do espelho (mesmo resultado da semana
  já gravada quando o país não mudou).
- Nenhum leitor do app chama a aba INFOS ACTS (teste/grep no CI do plano).

## Calls meus (conferir)

- Reconciliação planilha→D1 não sobrescreve foto/bio/gênero/país (o D1 é
  dono desses campos depois da importação).
- Gênero principal = lista fechada.
- Aviso de "complete o perfil" na Gestão.
- `artista_info` deixa de ser usado; `EnvioD1.gs` não muda.
