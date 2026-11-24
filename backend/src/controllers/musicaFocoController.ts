// Foco (país-alvo) do lançamento de cada música: leitura, lista de países e gravação com trava.
import { getCatalogoDb } from "../services/catalogoDbService";
import { requestProvesAdmin } from "../services/sessionService";
import { FOCO_SCHEMA, carregarFocos } from "../services/chartsD1/foco";
import { semAcentoMaiusculo } from "../services/chartsD1/artistas";
import { limparCacheCharts } from "./chartsController";

type FocoAtual = { pais: string; desde: string };
export type ResultadoValidacao = { ok: true } | { ok: false; status: 400 | 403 | 409; erro: string };

/** Regras puras da gravação: país válido, trava após definido (só admin troca) e sem repetir o atual. */
export function validarGravacaoFoco(
  atual: FocoAtual[],
  novoPais: string,
  paisesValidos: Set<string>,
  ehAdmin: boolean,
): ResultadoValidacao {
  if (novoPais !== "GLOBAL" && !paisesValidos.has(novoPais)) {
    return { ok: false, status: 400, erro: "País inválido." };
  }
  if (atual.length > 0 && !ehAdmin) {
    return { ok: false, status: 409, erro: "O foco deste lançamento já foi definido. Peça à administração para alterar." };
  }
  if (atual.length > 0 && atual[atual.length - 1].pais === novoPais) {
    return { ok: false, status: 409, erro: "Esse já é o foco atual." };
  }
  return { ok: true };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

const hojeIso = () => new Date().toISOString().slice(0, 10);

/** Países distintos de pais_peso (grafia original), alfabéticos, sem duplicata por acento. */
async function listarPaises(db: NonNullable<ReturnType<typeof getCatalogoDb>>): Promise<string[]> {
  const r = await db.prepare("SELECT DISTINCT pais FROM pais_peso").all<{ pais: string }>();
  const porChave = new Map<string, string>();
  for (const { pais } of r.results) {
    const k = semAcentoMaiusculo(pais);
    if (k && !porChave.has(k)) porChave.set(k, pais);
  }
  return [...porChave.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export async function musicaFocoController(request: Request, subPath: "" | "paises"): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) return json({ success: false, error: "Banco indisponível." }, 503);
  try {
    for (const sql of FOCO_SCHEMA) await db.prepare(sql).run();

    if (subPath === "paises") {
      if (request.method !== "GET") return json({ success: false, error: "Use GET." }, 405);
      return json({ success: true, paises: await listarPaises(db) });
    }

    if (request.method === "GET") {
      const codigo = (new URL(request.url).searchParams.get("codigo") ?? "").trim();
      if (!codigo) return json({ success: false, error: "Código obrigatório." }, 400);
      const lista = (await carregarFocos(db)).get(codigo) ?? [];
      const foco = lista.length ? lista[lista.length - 1] : null;
      return json({ success: true, foco, travado: foco !== null });
    }

    if (request.method !== "POST") return json({ success: false, error: "Use GET ou POST." }, 405);
    const body = (await request.json().catch(() => null)) as { codigo?: unknown; pais?: unknown } | null;
    const codigo = typeof body?.codigo === "string" ? body.codigo.trim() : "";
    const paisIn = typeof body?.pais === "string" ? body.pais : "";
    if (!codigo || !paisIn.trim()) return json({ success: false, error: "Código e país são obrigatórios." }, 400);

    // Normaliza a entrada (caixa/acento) para a grafia de pais_peso.
    const paises = await listarPaises(db);
    const chaveParaGrafia = new Map(paises.map((p) => [semAcentoMaiusculo(p), p]));
    const chave = semAcentoMaiusculo(paisIn);
    const pais = chave === "GLOBAL" ? "GLOBAL" : chaveParaGrafia.get(chave) ?? chave;

    const ehAdmin = await requestProvesAdmin(request);
    const atual = (await carregarFocos(db)).get(codigo) ?? [];
    const v = validarGravacaoFoco(atual, pais, new Set(paises), ehAdmin);
    if (!v.ok) return json({ success: false, error: v.erro }, v.status);

    const desde = hojeIso();
    // Admin trocando duas vezes no mesmo dia: atualiza a linha do dia (PK = codigo+desde).
    await db
      .prepare(
        "INSERT INTO musica_foco (codigo_unico, pais, desde, por_admin) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(codigo_unico, desde) DO UPDATE SET pais = excluded.pais, por_admin = excluded.por_admin",
      )
      .bind(codigo, pais, desde, ehAdmin ? 1 : 0)
      .run();
    limparCacheCharts();
    return json({ success: true, foco: { pais, desde } });
  } catch (e) {
    console.warn("[musica-foco] falha:", e);
    return json({ success: false, error: "Falha ao processar o foco." }, 500);
  }
}
