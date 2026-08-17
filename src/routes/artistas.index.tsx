import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Library } from "lucide-react";
import { useTelegramUser } from "@/lib/telegram";
import { api, fmtEC, fmtMoney, driveImg, type Artist } from "@/lib/api";

export const Route = createFileRoute("/artistas/")({
  component: ArtistasList,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      // Padrão agora é "all" — exibe todos os artistas do império
      filter: (search.filter as string) || "all",
    };
  },
});

function ArtistasList() {
  const { user, ready } = useTelegramUser();
  const { filter } = Route.useSearch();
  const [artists, setArtists] = useState<Artist[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!ready) return;
    if (filter === "all") {
      api.listarTodos().then(setArtists);
    } else {
      if (!user || user.id === "guest") { setArtists([]); return; }
      api.meusArtistas(user.id).then(setArtists);
    }
  }, [ready, user, filter]);

  const filtered = artists
    ? artists.filter((a) => a.nome.toLowerCase().includes(query.toLowerCase()))
    : null;

  // Países e gêneros únicos para futuros filtros (disponíveis)
  const countries = artists ? [...new Set(artists.map((a) => a.pais).filter(Boolean))].sort() : [];

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-8">
      <header className="mb-5 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-primary/70 font-black mb-1">A Indústria</p>
          <h1 className="text-xl font-black tracking-tighter uppercase italic">Empire Artists</h1>
        </div>
        {user && user.id !== "guest" && (
          <Link
            to="/artistas"
            search={{ filter: filter === "mine" ? "all" : "mine" }}
            className="px-4 py-2.5 rounded-2xl bg-white/5 border border-white/10 text-muted-foreground font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all hover:bg-white/10"
          >
            {filter === "mine" ? "Todos os artistas" : "Meus artistas"}
          </Link>
        )}
      </header>

      {/* Barra de busca */}
      <div className="relative mb-5">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/50" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar artista..."
          className="w-full h-11 bg-white/5 border border-white/10 rounded-2xl pl-10 pr-4 text-sm font-bold outline-none focus:border-primary/40 transition-colors"
        />
      </div>

      {filtered === null ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 rounded-[28px] bg-card animate-pulse border border-white/5" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
          <div className="size-20 rounded-full bg-white/5 grid place-items-center">
            <Library className="size-10 text-muted-foreground/20" />
          </div>
          <p className="text-sm font-bold text-muted-foreground italic">
            {query ? `Nenhum artista encontrado para "${query}"` : "Nenhuma lenda registrada no império."}
          </p>
        </div>
      ) : (
        <>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/30 mb-4 px-1">
            {filtered.length} artista{filtered.length !== 1 ? "s" : ""}
          </p>
          <ul className="space-y-4">
            {[...filtered]
              .sort((a, b) => a.nome.localeCompare(b.nome))
              .map((a) => {
                // A fonte de dados (Apps Script legado) às vezes devolve uma
                // data crua nesse campo em vez do gênero de verdade.
                const generoRaw = (a.genero || "").trim();
                const generoVal = generoRaw && !/^\w{3}\s\w{3}\s\d{1,2}\s\d{4}.*GMT/i.test(generoRaw) ? generoRaw : null;
                const paisVal = a.pais && a.pais.trim() !== "" ? a.pais : null;
                const cleanDescription = (a.descricao || "").trim();
                // A fonte de dados (Apps Script legado) às vezes devolve uma
                // data crua (ex: "Wed May 13 2026 00:00:00 GMT-0300...") no
                // campo de descrição — nunca é um texto que faça sentido
                // mostrar, então trata como se estivesse vazio.
                const looksLikeRawDate = /^\w{3}\s\w{3}\s\d{1,2}\s\d{4}.*GMT/i.test(cleanDescription);
                const hasDescription =
                  cleanDescription.length > 3 &&
                  !looksLikeRawDate &&
                  !["sim", "não", "vazio", "n/a"].includes(cleanDescription.toLowerCase());

                return (
                  <li key={a.nome}>
                    {/* Card clicável → perfil do artista */}
                    <Link
                      to="/artistas/$nome"
                      params={{ nome: a.nome }}
                      className="block p-4 rounded-[28px] bg-card/50 border border-white/5 shadow-2xl relative overflow-hidden group backdrop-blur-sm hover:border-primary/20 transition-all active:scale-[0.98]"
                    >
                      <div className="absolute top-0 right-0 size-40 bg-primary/5 blur-[50px] -translate-y-1/2 translate-x-1/2 opacity-50 group-hover:opacity-100 transition-opacity duration-700" />

                      <div className="flex gap-4 relative z-10">
                        <div className="size-20 shrink-0 rounded-2xl overflow-hidden border-2 border-white/10 bg-slate-900 shadow-xl self-start">
                          <img
                            src={driveImg(a.foto)}
                            alt={a.nome}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover object-top transition-transform duration-700 group-hover:scale-110"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                "https://images.unsplash.com/photo-1514525253361-bee8718a300c?w=400&h=400&fit=crop";
                            }}
                          />
                        </div>

                        <div className="flex-1 min-w-0 flex flex-col pt-1">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            {generoVal && (
                              <span className="text-[11px] font-black uppercase tracking-widest bg-primary/20 text-primary px-2 py-0.5 rounded border border-primary/30 shadow-sm">
                                {generoVal}
                              </span>
                            )}
                            {paisVal && (
                              <span className="text-[11px] font-bold text-white/90 uppercase tracking-tight bg-white/10 px-2 py-0.5 rounded border border-white/10 shadow-sm backdrop-blur-md flex items-center gap-1">
                                <span className="opacity-50">📍</span> {paisVal}
                              </span>
                            )}
                          </div>

                          <h3 className="text-base font-black italic uppercase tracking-tighter leading-tight text-white mb-1 group-hover:text-primary transition-colors truncate">
                            {a.nome}
                          </h3>

                          {/* Stats rápidos: fortuna + prestígio */}
                          <div className="flex items-center gap-4 mb-2">
                            <div className="flex flex-col min-w-0">
                              <span className="text-[10px] text-muted-foreground uppercase font-black tracking-wider">Fortuna</span>
                              <span className="text-xs font-black text-emerald-400 truncate">{fmtMoney(a.fortuna_total)}</span>
                            </div>
                            <div className="w-[1px] h-6 bg-white/10" />
                            <div className="flex flex-col min-w-0">
                              <span className="text-[10px] text-muted-foreground uppercase font-black tracking-wider">Seguidores</span>
                              <span className="text-xs font-black text-amber-400 truncate">{a.seguidores.toLocaleString("pt-BR")}</span>
                            </div>
                            <div className="w-[1px] h-6 bg-white/10" />
                            <div className="flex flex-col min-w-0">
                              <span className="text-[10px] text-muted-foreground uppercase font-black tracking-wider">E$C</span>
                              <span className="text-xs font-black text-primary truncate">{fmtEC(a.saldo)}</span>
                            </div>
                          </div>

                          {hasDescription && (
                            <p className="text-xs text-muted-foreground/90 leading-relaxed italic line-clamp-2 border-t border-white/10 pt-2">
                              {a.descricao}
                            </p>
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </>
      )}
    </main>
  );
}
