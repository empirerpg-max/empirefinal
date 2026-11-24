// Funções PURAS da tracklist de um álbum (Albuns!M — JSON de
// { titulo, disco, ordem }, ver TracklistEntry em gestaoController). Ficam
// num arquivo próprio, sem dependência de planilha, pra poderem ser
// testadas isoladas (scripts/album-tracklist.test.ts).
//
// Motivo (2026-11-24): reordenar faixas na Gestão gravava só Musicas!U,
// mas a tela e a página pública leem a ordem de Albuns!M — a ordem nova
// nunca aparecia. E o "adicionar faixas" concatenava entradas sem checar
// título, deixando a tracklist com a mesma faixa duas vezes (caso Johny
// Slaver — Utopia).
import type { TracklistEntry } from "./gestaoController";

const chave = (titulo: string) => titulo.trim().toLowerCase();
const discoValido = (disco: number | undefined) => (disco && disco > 0 ? disco : 1);

// Renumera `ordem` 1..n dentro de cada disco, na sequência recebida, e
// devolve agrupado por disco crescente (estável dentro do disco).
function numerarPorDisco(entradas: { titulo: string; disco: number }[]): TracklistEntry[] {
  const discos = [...new Set(entradas.map((x) => x.disco))].sort((a, b) => a - b);
  return discos.flatMap((disco) =>
    entradas
      .filter((x) => x.disco === disco)
      .map((x, i) => ({ titulo: x.titulo, disco, ordem: i + 1 })),
  );
}

// Regrava a tracklist na ordem em que as faixas aparecem na tela.
// - Cada título aparece uma vez só (duplicatas da tracklist antiga somem;
//   vale o disco da ÚLTIMA ocorrência, igual ao Map de leitura em
//   getAlbumFaixasController — o mesmo disco que a tela já mostrava).
// - Faixa mantém o disco que já tinha (padrão 1 se não estava na tracklist).
// - Entrada antiga sem faixa correspondente na tela (ex.: título que não
//   existe mais em Musicas) NUNCA é apagada: vai pro fim do seu disco.
export function reordenarTracklist(
  atual: TracklistEntry[],
  titulosNaOrdem: string[],
): TracklistEntry[] {
  const discoPorTitulo = new Map<string, number>();
  for (const entrada of atual) discoPorTitulo.set(chave(entrada.titulo), discoValido(entrada.disco));

  const vistos = new Set<string>();
  const sequencia: { titulo: string; disco: number }[] = [];
  for (const titulo of titulosNaOrdem) {
    const k = chave(titulo);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    sequencia.push({ titulo: titulo.trim(), disco: discoPorTitulo.get(k) ?? 1 });
  }
  for (const entrada of atual) {
    const k = chave(entrada.titulo);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    sequencia.push({ titulo: entrada.titulo.trim(), disco: discoPorTitulo.get(k) ?? 1 });
  }
  return numerarPorDisco(sequencia);
}

// Junta faixas novas à tracklist existente sem duplicar: título que já
// está lá é ignorado; título novo entra no FIM do seu disco (maior ordem
// do disco + 1), independente da ordem que veio no payload — evita duas
// faixas na mesma posição.
export function mesclarTracklist(
  atual: TracklistEntry[],
  novas: TracklistEntry[],
): TracklistEntry[] {
  const resultado = atual.map((x) => ({ ...x }));
  const existentes = new Set(resultado.map((x) => chave(x.titulo)));
  for (const nova of novas) {
    const k = chave(nova.titulo);
    if (!k || existentes.has(k)) continue;
    existentes.add(k);
    const disco = discoValido(nova.disco);
    const maiorOrdem = resultado
      .filter((x) => discoValido(x.disco) === disco)
      .reduce((max, x) => Math.max(max, x.ordem || 0), 0);
    resultado.push({ titulo: nova.titulo, disco, ordem: maiorOrdem + 1 });
  }
  return resultado;
}
