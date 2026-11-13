// Leitura do catálogo/Fórum de vídeos a partir do D1 — fase 3 da migração
// (2026-11-13). Em vez de reescrever as telas, reconstrói a partir do D1 as
// MESMAS linhas que a planilha devolveria ("Music Videos"/"Comentarios_MV",
// cada uma na sua posição original via linha_planilha) e entrega pro
// MESMO código que já transforma linha em objeto. Resultado: o app mostra
// exatamente o que mostrava, só que lendo do D1.
//
// Segurança:
//   - chave liga/desliga no KV FLAGS ("videos:leitura-d1" = "on"), sem
//     deploy: desligada (padrão), tudo continua lendo da planilha;
//   - qualquer falha do D1, ou tabela vazia, cai pra planilha sozinho;
//   - antes de ligar, /admin/comparar-leitura-videos-d1 prova em produção
//     que os objetos montados das duas fontes são idênticos.
import { getCatalogoDb } from "./catalogoDbService";
import { googleSheetsService } from "./googleSheetsService";
import { VIDEOS_COLUNAS, videoD1ParaCelulas } from "./videosDbService";
import { COMENTARIOS_VIDEOS_COLUNAS, comentarioVideoD1ParaCelulas } from "./comentariosVideosDbService";
import { ABA_COMENTARIOS_VIDEOS, ABA_VIDEOS } from "./videosD1Sync";

export const FLAG_LEITURA_VIDEOS_D1 = "videos:leitura-d1";

interface FlagsKvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}
function flagsKv(): FlagsKvLike | undefined {
  return (globalThis as Record<string, unknown>).__FLAGS_KV__ as FlagsKvLike | undefined;
}

let cacheFlag: { ativa: boolean; ate: number } | null = null;

export async function leituraVideosD1Ativa(): Promise<boolean> {
  if (cacheFlag && cacheFlag.ate > Date.now()) return cacheFlag.ativa;
  const kv = flagsKv();
  const ativa = kv ? (await kv.get(FLAG_LEITURA_VIDEOS_D1).catch(() => null)) === "on" : false;
  cacheFlag = { ativa, ate: Date.now() + 30_000 };
  return ativa;
}

export async function definirLeituraVideosD1(ativa: boolean): Promise<boolean> {
  const kv = flagsKv();
  if (!kv) return false;
  await kv.put(FLAG_LEITURA_VIDEOS_D1, ativa ? "on" : "off");
  cacheFlag = { ativa, ate: Date.now() + 30_000 };
  return true;
}

/** Coloca as colunas extras (guardadas como [[índice, cabeçalho, valor]]) de volta no lugar. */
function aplicarExtras(celulas: string[], extrasJson: string | null, header: string[]): string[] {
  if (!extrasJson) return celulas;
  try {
    for (const [idx, nome, valor] of JSON.parse(extrasJson) as [number, string, string][]) {
      while (celulas.length <= idx) celulas.push("");
      celulas[idx] = valor;
      while (header.length <= idx) header.push("");
      if (!header[idx]) header[idx] = nome;
    }
  } catch {
    /* extras ilegíveis: ignora só as extras, nunca a linha */
  }
  return celulas;
}

/** Remonta a "aba" como a API do Sheets devolveria: linha 1 = cabeçalho, cada registro na sua linha. */
function montarAba(
  headerBase: string[],
  registros: { linha: number; celulas: string[]; extras: string | null }[],
): string[][] {
  const header = [...headerBase];
  const out: string[][] = [header];
  for (const r of registros) {
    if (!Number.isInteger(r.linha) || r.linha < 2) continue;
    while (out.length < r.linha) out.push([]);
    out[r.linha - 1] = aplicarExtras([...r.celulas], r.extras, header);
  }
  return out;
}

export async function linhasVideosD1(): Promise<string[][] | null> {
  const db = getCatalogoDb();
  if (!db) return null;
  const rows = (await db.prepare("SELECT * FROM videos ORDER BY linha_planilha").all<Record<string, unknown>>()).results || [];
  if (rows.length === 0) return null;
  return montarAba(
    VIDEOS_COLUNAS.map((c) => c.header),
    rows.map((r) => ({ linha: Number(r.linha_planilha), ...videoD1ParaCelulas(r) })),
  );
}

export async function linhasComentariosVideosD1(): Promise<string[][] | null> {
  const db = getCatalogoDb();
  if (!db) return null;
  const rows =
    (await db.prepare("SELECT * FROM comentarios_videos ORDER BY linha_planilha").all<Record<string, unknown>>()).results || [];
  if (rows.length === 0) return null;
  // Cabeçalho de G (ID do comentário-pai) é vazio na planilha — e o código
  // de leitura depende disso (chave "coluna_7").
  return montarAba(
    COMENTARIOS_VIDEOS_COLUNAS.map((c) => c.header ?? ""),
    rows.map((r) => ({ linha: Number(r.linha_planilha), ...comentarioVideoD1ParaCelulas(r) })),
  );
}

/**
 * Linhas da aba — do D1 quando a chave está ligada e o D1 responde, senão
 * da planilha (mesma leitura de sempre). Só "Music Videos"/"Comentarios_MV".
 */
export async function linhasDaAbaDeVideo(aba: string): Promise<string[][]> {
  if ((aba === ABA_VIDEOS || aba === ABA_COMENTARIOS_VIDEOS) && (await leituraVideosD1Ativa())) {
    try {
      const d1 = aba === ABA_VIDEOS ? await linhasVideosD1() : await linhasComentariosVideosD1();
      if (d1 && d1.length > 1) return d1;
    } catch (err) {
      console.warn(`[videosD1Leitura] D1 falhou lendo "${aba}", caindo pra planilha:`, err);
    }
  }
  return googleSheetsService.principal.readValues(aba);
}
