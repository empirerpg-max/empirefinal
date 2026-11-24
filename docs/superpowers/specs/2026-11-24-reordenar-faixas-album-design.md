# Reordenar faixas de álbum — gravar na tracklist (Albuns!M)

## Por quê

O dono do álbum precisa poder mudar a ordem das faixas sempre. Hoje, em todo
álbum com tracklist própria (Albuns!M, gravada em todo álbum publicado desde
12/11), a reordenação "parece funcionar" na tela mas não fica:

- `reordenarAlbumFaixasController` grava só em Musicas!U;
- a tela de edição (`getAlbumFaixasController`) e a página pública
  (`empirePlayController`) leem a ordem de Albuns!M, que nunca muda;
- o front não confere a resposta do servidor, então nada avisa.

Caso real: Johny Slaver — Utopia (`EMPALBM097`, Albuns linha 108). Além do
problema acima, a tracklist dele tem entradas DUPLICADAS (Toast Pop, Fame Can
Swallow You (Album Version) e It Kills Me Inside aparecem duas vezes, com
ordens diferentes), causadas pelo "adicionar faixas"
(`substituirAlbumController`), que concatena as novas entradas na tracklist
sem checar se o título já existe. Resultado: duas faixas na posição 1, duas
na 2. Há também uma entrada ("Immobilier Vous") sem música correspondente em
Musicas.

## Objetivos

- Reordenar (setas e campo numérico) passa a gravar a ordem em Albuns!M e
  persiste: ao reabrir a edição e na página pública aparece a ordem nova.
- O "adicionar faixas" não cria mais entrada duplicada na tracklist.
- Falha ao salvar a ordem aparece pro jogador.

## Fora do escopo

- Mover faixa entre discos (o Utopia tem um disco só; UI de disco fica pra
  depois).
- Script de limpeza separado pras tracklists já duplicadas: a primeira
  reordenação do álbum já regrava a tracklist limpa.

## Anti-objetivos

- Nunca apagar silenciosamente entrada da tracklist que não tem música
  correspondente (ex.: "Immobilier Vous").
- Nunca voltar a usar Musicas!U como fonte da ordem de álbum com tracklist
  (quebraria a mesma faixa em dois álbuns).

## Abordagens consideradas

- **A (escolhida):** reordenar regrava a tracklist inteira de Albuns!M na
  ordem da tela (+ mantém U em sincronia, espelha Musicas no D1); "adicionar
  faixas" passa a deduplicar por título; front confere a resposta.
- B: só trocar o número `ordem` das entradas existentes por título — menor,
  mas não resolve duplicatas (o Utopia continuaria embaralhado).
- C: voltar a ler só Musicas!U — descartada, U é única por música.

## Design

**Backend — `reordenarAlbumFaixasController`**
- Payload ganha `topicId` (ID do tópico do álbum, Albuns!B), além de
  `ordens`.
- Continua gravando Musicas!U de cada faixa e passa a chamar
  `mirrorMusicaRowParaD1` em cada linha.
- Com `topicId`: acha a linha do álbum, lê a tracklist atual e grava uma nova
  em Albuns!M: as faixas da tela, na ordem recebida, título lido de
  Musicas!H pela `musicaRowIndex`, `disco` mantido da entrada existente
  (padrão 1), `ordem` recomeçando em 1 dentro de cada disco. Entradas antigas
  cujo título não corresponde a nenhuma faixa da tela vão pro fim, preservadas
  (com ordem seguinte). Títulos repetidos aparecem uma vez só.
- Álbum sem tracklist (antigo): cria a tracklist a partir dessa ordem — a
  leitura passa a usá-la, o que é o comportamento desejado.
- A escrita em Albuns já é espelhada no D1 automaticamente
  (`espelharNoD1SeAplicavel`).

**Backend — `substituirAlbumController` (adicionar faixas)**
- Na mescla da tracklist: se o título da faixa nova já existe, não duplica;
  se é novo, entra no fim do seu disco (`ordem` = maior do disco + 1).

**Front — `EditModal.tsx`**
- `handleMoveFaixa`/`handleSetOrdem` mandam `topicId`
  (`editingItem.fields.topicId`), checam `res.ok && json.success`; se falhar,
  mostram o erro (`setErrorMsg`) e recarregam as faixas do servidor
  (`fetchAlbumFaixas`) pra tela não mentir.
- Numeração da tracklist na tela continua sequencial; com mais de um disco a
  ordem já reinicia por disco no servidor.

## Decisões minhas (pra conferir)

- Regravar U junto, mesmo não sendo mais a fonte, pra manter álbuns antigos
  e qualquer leitor legado coerentes.
- Faixa nova adicionada vai pro fim do disco, ignorando o `num` do payload
  quando colidiria.
- Sem script de limpeza: a reordenação já conserta o Utopia.

## Fica pro implementador

- Teste do builder da tracklist (dedupe, preservação de órfãs, reinício por
  disco) como função pura.
