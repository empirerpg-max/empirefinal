import {
  googleSheetsService,
  normalizeText,
  normalizeHeader,
  normalizeComparison,
  dedupeHeaders,
} from "../services/googleSheetsService";
import { resolveNomeOficial } from "./forumController";

/**
 * Lê os artistas do jogador direto da aba ARTISTAS da planilha "Usuários"
 * (fonte de verdade nova — coluna "ID Usuário" = telegram_id). Substitui a
 * coluna M "Lista de Artistas" da aba Jogadores, que tinha dados
 * desatualizados/errados (ex: artista de outro jogador aparecendo como
 * "meu").
 */
async function getArtistsFromArtistasSheet(telegramId: string): Promise<string[]> {
  const rawRows = await googleSheetsService.usuarios.readValues("ARTISTAS").catch(() => []);
  if (!rawRows || rawRows.length < 2) return [];
  const headers = dedupeHeaders(
    "ARTISTAS",
    rawRows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );
  const artCol = headers.indexOf("nome");
  const ownerCol = headers.indexOf("id_usuario");
  if (artCol === -1 || ownerCol === -1) return [];
  const normId = normalizeComparison(telegramId);
  const nomes = rawRows
    .slice(1)
    .filter((r) => normalizeComparison(r[ownerCol]) === normId)
    .map((r) => normalizeText(r[artCol]))
    .filter(Boolean);
  return Array.from(new Set(nomes));
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface UserProfile {
  artistName: string;
  telegramId: string;
  playerName: string;
  associatedArtists: string[];
  sourceSheet: string;
  rowNumber: number;
}

function parseArtistList(cellValue: string | null | undefined): string[] {
  if (!cellValue) return [];

  return Array.from(
    new Set(
      cellValue
        .split(/\r?\n|,|;|\|/g)
        .map((item) => item.replace(/^[-*•]\s*/, "").trim())
        .filter(Boolean),
    ),
  );
}

export async function getUserProfile(telegramId: string): Promise<UserProfile> {
  const normalizedTelegramId = normalizeText(telegramId);

  if (normalizedTelegramId) {
    // Fonte de verdade nova (aba ARTISTAS da planilha "Usuários") — se tiver
    // qualquer artista lá pra esse ID, usa ela, ignorando a coluna "Lista de
    // Artistas" desatualizada da aba Jogadores.
    const artistasNovos = await getArtistsFromArtistasSheet(normalizedTelegramId).catch(() => []);

    try {
      const rows = await googleSheetsService.principal.readValues("Jogadores", "A:M");

      // BUG REAL confirmado em produção (2026-11-11, jogador Justino: "Editar
      // Lançamentos" só mostrava o álbum "Chronicles" — na verdade um álbum
      // de um dos OUTROS artistas dele que nunca aparecia na lista): um
      // mesmo Telegram_ID pode ter VÁRIAS linhas em "Jogadores" (uma por
      // artista que ele gerencia — Justino tinha 3: "Samantha Cooper",
      // "Kendall" e "Luna", cada linha com sua própria Coluna M de artistas
      // extras). A versão antiga daqui dava `return` assim que achava a
      // PRIMEIRA linha com esse Telegram_ID, descartando todas as outras —
      // associatedArtists saía só com o artista (+ extras) da primeira
      // linha, escondendo os outros 2 artistas (e os álbuns deles) de toda
      // tela que usa esse perfil (Editar Lançamentos, Lançar Faixa de
      // Álbum, Pre-save etc). Agora acumula o artista + extras de TODAS as
      // linhas que batem com esse Telegram_ID antes de montar o perfil.
      let primeiraLinhaEncontrada: { artistName: string; playerName: string; rowIndex: number } | null = null;
      const todosArtistas: string[] = [];
      for (let index = 1; index < rows.length; index += 1) {
        const row = rows[index] ?? [];
        const artistName = normalizeText(row[0]); // Coluna A: Nome (Artista)
        const rowTelegramId = normalizeText(row[1]); // Coluna B: Telegram_ID
        const playerName = normalizeText(row[2]); // Coluna C: Nome do OFF/Jogador
        const associatedArtistsCell = normalizeText(row[12]); // Coluna M: Lista de Artistas

        if (rowTelegramId && rowTelegramId === normalizedTelegramId) {
          if (!primeiraLinhaEncontrada) {
            primeiraLinhaEncontrada = { artistName, playerName, rowIndex: index + 1 };
          }
          const extraArtistsDaLinha = parseArtistList(associatedArtistsCell);
          todosArtistas.push(artistName, ...extraArtistsDaLinha);
        }
      }

      if (primeiraLinhaEncontrada) {
        const extraArtists = artistasNovos.length > 0 ? artistasNovos : todosArtistas;
        const associatedArtists = Array.from(
          new Set([primeiraLinhaEncontrada.artistName, ...extraArtists].filter(Boolean)),
        );

        // "Jogador" genérico só quando NADA foi achado — antes, uma linha
        // de "Jogadores" com a Coluna C (Nome do OFF) vazia (comum pra
        // quem só existe hoje via a aba ARTISTAS mais nova) fazia o
        // Fórum mostrar "Jogador" pra sempre em vez do nome real, mesmo
        // ele existindo na aba "Usuários" (mesma fonte que comentário/
        // audit log já usam via resolveNomeOficial).
        return {
          artistName: primeiraLinhaEncontrada.artistName || "Artista Independente",
          telegramId: normalizedTelegramId,
          playerName:
            primeiraLinhaEncontrada.playerName ||
            (await resolveNomeOficial(normalizedTelegramId, "Jogador")),
          associatedArtists:
            associatedArtists.length > 0
              ? associatedArtists
              : [primeiraLinhaEncontrada.artistName || "Artista Independente"],
          sourceSheet: "Jogadores",
          rowNumber: primeiraLinhaEncontrada.rowIndex,
        };
      }
    } catch (err) {
      console.warn("[getUserProfile] Erro ao ler Jogadores:", err);
    }

    if (artistasNovos.length > 0) {
      return {
        artistName: artistasNovos[0],
        telegramId: normalizedTelegramId,
        playerName: await resolveNomeOficial(normalizedTelegramId, "Jogador"),
        associatedArtists: artistasNovos,
        sourceSheet: "ARTISTAS",
        rowNumber: 0,
      };
    }
  }

  // Fallback perfil padrão pra usuários convidados ou IDs não cadastrados em
  // nenhuma das duas fontes acima — ainda tenta achar o nome real na aba
  // "Usuários" antes de desistir e usar "Jogador" (evita mostrar genérico
  // pra alguém que existe na planilha mas não tem linha em Jogadores/ARTISTAS).
  return {
    artistName: "Artista Independente",
    telegramId: normalizedTelegramId || "guest",
    playerName: normalizedTelegramId ? await resolveNomeOficial(normalizedTelegramId, "Jogador") : "Jogador",
    associatedArtists: ["Artista Independente"],
    sourceSheet: "Jogadores",
    rowNumber: 0,
  };
}

export async function getUserMeController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("telegram_id") || url.searchParams.get("tgId");
  const fromHeader = request.headers.get("x-telegram-id");
  const telegramId = String(fromQuery || fromHeader || "").trim();

  try {
    const profile = await getUserProfile(telegramId);
    return new Response(
      JSON.stringify({
        success: true,
        data: profile,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao consultar perfil do jogador.";
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          artistName: "Artista Independente",
          telegramId: telegramId || "guest",
          playerName: "Jogador",
          associatedArtists: ["Artista Independente"],
          sourceSheet: "Jogadores",
          rowNumber: 0,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}
