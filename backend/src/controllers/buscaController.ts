// Busca rápida do cabeçalho (2026-11-14): GET /api/busca?q=&grupo=&limite=
// Índice compacto montado das MESMAS fontes do catálogo (D1) — pendentes
// fora, igual ao catálogo — reaproveitado por 60 s na memória do Worker.
// Spec: docs/superpowers/specs/2026-11-14-busca-rapida-design.md
import { type SheetRecord } from "../services/googleSheetsService";
import { buscarNoIndice, termosDeBusca, TERMO_MINIMO, ORDEM_GRUPOS, type GrupoBusca, type ItemBusca } from "../services/buscaRapida";
import {
  buildCleanItem,
  lerAlbunsComoObjetos,
  lerMusicVideosComoObjetos,
  readMusicasFromD1,
  type EmpirePlayCleanItem,
} from "./empirePlayController";
import { getAllArtistasController } from "./artistasController";

type ItemFonte = Pick<EmpirePlayCleanItem, "id" | "title" | "artist" | "featArtists" | "coverUrl" | "telegramTopicId" | "releaseDateIso">;
export interface FonteItem {
  item: ItemFonte;
  pendente: boolean;
}
export interface FontesBusca {
  musicas: FonteItem[] | null;
  videos: FonteItem[] | null;
  albuns: FonteItem[] | null;
  artistas: { nome: string; foto?: string }[] | null;
}

const TAB: Record<Exclude<GrupoBusca, "artistas">, string> = { musicas: "musicas", videos: "videos", albuns: "albuns" };

export function montarIndiceDeFontes(fontes: FontesBusca): ItemBusca[] {
  const out: ItemBusca[] = [];
  for (const grupo of ["musicas", "videos", "albuns"] as const) {
    for (const { item, pendente } of fontes[grupo] || []) {
      if (pendente || !item.title) continue;
      const artistas = [item.artist, ...(item.featArtists || [])].filter(Boolean);
      const idTopico = item.telegramTopicId || item.id;
      out.push({
        grupo,
        id: idTopico,
        titulo: item.title,
        subtitulo: artistas.join(", "),
        capa: item.coverUrl || undefined,
        link: `/empire-play/forum?tab=${TAB[grupo]}&id=${encodeURIComponent(idTopico)}`,
        dataIso: item.releaseDateIso || undefined,
        termos: termosDeBusca(item.title, ...artistas),
      });
    }
  }
  for (const a of fontes.artistas || []) {
    if (!a.nome) continue;
    out.push({
      grupo: "artistas",
      id: a.nome,
      titulo: a.nome,
      subtitulo: "",
      capa: a.foto || undefined,
      link: `/artistas/${encodeURIComponent(a.nome)}`,
      termos: termosDeBusca(a.nome),
    });
  }
  return out;
}

const ehPendente = (rec: SheetRecord) => String(rec["pendente"] ?? "").trim().toLowerCase() === "sim";
const comoFonte = (rotulo: string, recs: SheetRecord[]): FonteItem[] =>
  recs.map((rec, idx) => ({ item: buildCleanItem(rotulo, rec, idx), pendente: ehPendente(rec) }));

let cache: { indice: ItemBusca[]; ate: number } | null = null;

export async function obterIndiceBusca(): Promise<ItemBusca[]> {
  if (cache && cache.ate > Date.now()) return cache.indice;
  const [m, v, a, ar] = await Promise.allSettled([
    readMusicasFromD1(),
    lerMusicVideosComoObjetos(),
    lerAlbunsComoObjetos(),
    getAllArtistasController().then((r) => r.json() as Promise<{ data?: { nome: string; foto?: string }[] }>),
  ]);
  const val = <T>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);
  const musicas = val(m);
  const indice = montarIndiceDeFontes({
    musicas: musicas ? comoFonte("Musicas", musicas) : null,
    videos: val(v) ? comoFonte("Videos", val(v)!) : null,
    albuns: val(a) ? comoFonte("Album", val(a)!) : null,
    artistas: val(ar)?.data || null,
  });
  cache = { indice, ate: Date.now() + 60_000 };
  return indice;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export async function buscaController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const grupoParam = url.searchParams.get("grupo") || "";
  const grupo = (ORDEM_GRUPOS as string[]).includes(grupoParam) ? (grupoParam as GrupoBusca) : undefined;
  const limite = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limite") || "5", 10) || 5));
  if (q.trim().length < TERMO_MINIMO) return json({ success: true, q, grupos: [] });
  try {
    const { grupos } = buscarNoIndice(await obterIndiceBusca(), q, { limitePorGrupo: limite, grupo });
    return json({ success: true, q, grupos });
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
}
