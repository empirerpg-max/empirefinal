import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

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
    try {
      const rows = await googleSheetsService.principal.readValues("Jogadores", "A:M");

      for (let index = 1; index < rows.length; index += 1) {
        const row = rows[index] ?? [];
        const artistName = normalizeText(row[0]); // Coluna A: Nome (Artista)
        const rowTelegramId = normalizeText(row[1]); // Coluna B: Telegram_ID
        const playerName = normalizeText(row[2]); // Coluna C: Nome do OFF/Jogador
        const associatedArtistsCell = normalizeText(row[12]); // Coluna M: Lista de Artistas

        if (rowTelegramId && rowTelegramId === normalizedTelegramId) {
          const extraArtists = parseArtistList(associatedArtistsCell);
          const associatedArtists = Array.from(
            new Set([artistName, ...extraArtists].filter(Boolean)),
          );

          return {
            artistName: artistName || "Artista Independente",
            telegramId: rowTelegramId,
            playerName: playerName || "Jogador",
            associatedArtists:
              associatedArtists.length > 0
                ? associatedArtists
                : [artistName || "Artista Independente"],
            sourceSheet: "Jogadores",
            rowNumber: index + 1,
          };
        }
      }
    } catch (err) {
      console.warn("[getUserProfile] Erro ao ler Jogadores:", err);
    }
  }

  // Fallback perfil padrão para usuários convidados ou IDs não cadastrados
  return {
    artistName: "Artista Independente",
    telegramId: normalizedTelegramId || "guest",
    playerName: "Jogador",
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
