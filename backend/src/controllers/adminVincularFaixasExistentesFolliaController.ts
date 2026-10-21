import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";
import { mirrorMusicaRowParaD1 } from "./gestaoController";

// Fecha o último ponto do incidente FOLLIA: as 2 faixas "já existentes"
// da campanha (num 2 = "Follia", já lançada como single antes do
// pre-save; num 8 = "Fuori Rotta", idem) deveriam ter sido VINCULADAS
// ao álbum (igual ao fluxo normal — ver vincularFaixaExistenteAoAlbum,
// gestaoController.ts), nunca relançadas/recriadas. O bug em
// lancarCampanhaPreSave (já corrigido) excluía essas faixas do payload
// inteiramente; quando finalmente processadas (fix retroativo), a busca
// por "Max Gorghan - Follia" exato não achou o single real (título
// pouco diferente no catálogo) e caiu no fallback que CRIA uma linha
// pendente nova — duplicando em vez de vincular. "Fuori Rotta" nem
// chegou a criar nada (tentativa falhou de vez).
//
// Esse endpoint: acha o single real de cada faixa por busca aproximada
// (contém "Follia"/"Fuori Rotta" no título, artista Max Gorghan,
// EXCLUINDO o próprio álbum FOLLIA), vincula (K=álbum, U=ordem) só
// quando achar exatamente 1 candidato, e esvazia a linha pendente
// duplicada criada por engano (se existir).
//
// ?dryRun=1 só mostra o plano.
// GET /api/empire-play/admin/vincular-faixas-existentes-follia?dryRun=1
export async function adminVincularFaixasExistentesFolliaController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const ALBUM_TITULO = "Max Gorghan - FOLLIA";
  const ALVOS = [
    { termo: "follia", ordem: 2, excluirAlbum: true }, // single "Follia", não o álbum
    { termo: "fuori rotta", ordem: 8, excluirAlbum: false },
  ];

  const rows = await googleSheetsService.principal.readValues("Musicas", "A1:AE2000").catch(() => []);

  const achados: {
    termo: string;
    ordem: number;
    candidatos: { linha: number; titulo: string; album: string }[];
    linhaPendenteDuplicada: number | null;
  }[] = [];

  for (const alvo of ALVOS) {
    const candidatos: { linha: number; titulo: string; album: string }[] = [];
    let linhaPendenteDuplicada: number | null = null;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const titulo = normalizeText(row[7]);
      const artista = normalizeText(row[13]);
      const album = normalizeText(row[10]);
      if (normalizeComparison(artista) !== "max gorghan") continue;
      if (!normalizeComparison(titulo).includes(alvo.termo)) continue;
      if (alvo.excluirAlbum && normalizeComparison(titulo) === normalizeComparison(ALBUM_TITULO)) continue;
      // A linha pendente duplicada criada por engano: já tem o ÁLBUM
      // igual a "Max Gorghan - FOLLIA" mas título IDÊNTICO ao álbum
      // (sinal de que foi criada pelo fallback, não é o single de
      // verdade) e sem mídia nenhuma.
      if (normalizeComparison(album) === normalizeComparison(ALBUM_TITULO) && !normalizeText(row[2])) {
        linhaPendenteDuplicada = i + 1;
        continue;
      }
      // BUG REAL confirmado: busca por substring pegava falso positivo —
      // "Abbiso di Follia" (uma das 9 faixas novas, contém "follia") e
      // os remixes de "Fuori Rotta [Remixes]" (contêm "fuori rotta") —
      // nenhum é o single de verdade. O single real nunca foi vinculado
      // a NENHUM álbum ainda (campo ALBUM vazio) — é o único filtro que
      // separa o single de verdade de qualquer faixa que só cite o
      // termo no título.
      if (album) {
        continue;
      }
      candidatos.push({ linha: i + 1, titulo, album });
    }
    achados.push({ termo: alvo.termo, ordem: alvo.ordem, candidatos, linhaPendenteDuplicada });
  }

  if (dryRun) {
    return new Response(JSON.stringify({ success: true, dryRun: true, achados }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const resultado: { termo: string; acao: string; linha?: number }[] = [];
  for (let idx = 0; idx < ALVOS.length; idx++) {
    const alvo = ALVOS[idx];
    const achado = achados[idx];

    if (achado.candidatos.length !== 1) {
      resultado.push({
        termo: alvo.termo,
        acao: `abortado: ${achado.candidatos.length} candidato(s) encontrado(s), esperado exatamente 1 — não vinculei por segurança.`,
      });
      continue;
    }

    const candidato = achado.candidatos[0];
    await googleSheetsService.principal.updateValues("Musicas", `K${candidato.linha}`, [[ALBUM_TITULO]]);
    await googleSheetsService.principal.updateValues("Musicas", `U${candidato.linha}`, [[String(alvo.ordem)]]);
    await mirrorMusicaRowParaD1(candidato.linha).catch(() => {});
    resultado.push({ termo: alvo.termo, acao: "vinculado", linha: candidato.linha });

    if (achado.linhaPendenteDuplicada) {
      const vazio = Array(24).fill("");
      await googleSheetsService.principal
        .updateValues("Musicas", `A${achado.linhaPendenteDuplicada}:X${achado.linhaPendenteDuplicada}`, [vazio])
        .catch(() => {});
      resultado.push({ termo: alvo.termo, acao: "linha pendente duplicada esvaziada", linha: achado.linhaPendenteDuplicada });
    }
  }

  return new Response(JSON.stringify({ success: true, dryRun: false, resultado }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
