import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { lerPerfilArtista } from "@/lib/api";

type Pendencia = { nome: string; faltando: string[] };

// Aviso na Gestão do jogador: para cada artista dele sem nacionalidade ou sem
// estilo principal no espelho D1, "Complete o perfil de {artista}: …" com
// atalho para a aba Gestão do perfil do artista (/artistas/{nome}?aba=gestao).
export function AvisoPerfilArtistas({ artistas }: { artistas: string[] }) {
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);
  const chave = artistas.join("\u0000");

  useEffect(() => {
    let ativo = true;
    const nomes = [...new Set(artistas.map((a) => a.trim()).filter(Boolean))];
    if (!nomes.length) {
      setPendencias([]);
      return;
    }
    Promise.all(
      nomes.map((nome) =>
        lerPerfilArtista(nome)
          .then((p): Pendencia | null => {
            // Fora do espelho (ainda não importado): sem aviso.
            if (!p) return null;
            const faltando = [!p.pais?.trim() && "nacionalidade", !p.generoPrincipal?.trim() && "estilo"].filter(
              (x): x is string => !!x,
            );
            return faltando.length ? { nome: p.nome || nome, faltando } : null;
          })
          .catch(() => null),
      ),
    ).then((r) => {
      if (ativo) setPendencias(r.filter((x): x is Pendencia => !!x));
    });
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  if (!pendencias.length) return null;

  return (
    <div className="space-y-2">
      {pendencias.map((p) => (
        <div
          key={p.nome}
          className="flex items-center gap-3 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/25 min-w-0"
        >
          <AlertTriangle className="size-4 text-amber-400 shrink-0" />
          <p className="flex-1 min-w-0 text-[12px] font-bold text-amber-100 break-words">
            Complete o perfil de {p.nome}: {p.faltando.join(" / ")}
          </p>
          <Link
            to="/artistas/$nome"
            params={{ nome: p.nome }}
            search={{ aba: "gestao" }}
            className="shrink-0 max-w-[45%] min-w-0 inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-amber-500 text-black text-[11px] font-black active:scale-95 transition"
          >
            <span className="truncate">Completar</span>
            <ChevronRight className="size-3.5 shrink-0" />
          </Link>
        </div>
      ))}
    </div>
  );
}
