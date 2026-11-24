// Foco (país-alvo) do lançamento de uma música — cliente dos endpoints
// /api/musica-foco. Depois de salvo, só a administração pode trocar (o
// backend reconhece o admin pelo Authorization: Bearer de authHeaders()).
import { authHeaders } from "@/lib/api";

export type FocoAtual = { pais: string; desde: string };

// Cache em memória do módulo: a lista de países quase nunca muda, então
// todos os selects da sessão reaproveitam a mesma requisição.
let paisesCache: Promise<string[]> | null = null;

export function listarPaisesFoco(): Promise<string[]> {
  if (!paisesCache) {
    paisesCache = fetch("/api/musica-foco/paises")
      .then((res) => res.json())
      .then((data: { success?: boolean; paises?: unknown }) => {
        if (!data?.success || !Array.isArray(data.paises))
          throw new Error("Lista de países indisponível.");
        return data.paises.filter((p): p is string => typeof p === "string");
      })
      .catch((err) => {
        // Falhou: limpa o cache pra próxima abertura tentar de novo.
        paisesCache = null;
        throw err;
      });
  }
  return paisesCache;
}

export async function lerFoco(
  codigo: string,
): Promise<{ foco: FocoAtual | null; travado: boolean }> {
  const res = await fetch(`/api/musica-foco?codigo=${encodeURIComponent(codigo)}`);
  const data = (await res.json().catch(() => null)) as {
    success?: boolean;
    foco?: FocoAtual | null;
    travado?: boolean;
    error?: string;
  } | null;
  if (!res.ok || !data?.success) throw new Error(data?.error || "Não foi possível ler o foco.");
  return { foco: data.foco ?? null, travado: !!data.travado };
}

export async function salvarFoco(codigo: string, pais: string): Promise<void> {
  const res = await fetch("/api/musica-foco", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ codigo, pais }),
  });
  const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
  if (!res.ok || !data?.success) throw new Error(data?.error || "Não foi possível salvar o foco.");
}

/** Rótulo amigável do valor salvo ("GLOBAL" vira texto legível). */
export function rotuloFoco(pais: string): string {
  return pais === "GLOBAL" ? "Global / sem foco" : pais;
}
