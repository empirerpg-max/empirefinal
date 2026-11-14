// Busca rápida do cabeçalho (2026-11-14): lupa ao lado do sininho que abre
// uma janela com resultados agrupados (Músicas, Vídeos, Álbuns, Artistas).
// A filtragem é do servidor (GET /api/busca) — o cmdk aqui só exibe.
// Spec: docs/superpowers/specs/2026-11-14-busca-rapida-design.md
import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Search, Loader2, Music, Clapperboard, Disc3, User, ChevronDown } from "lucide-react";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { api, driveImg, type GrupoBusca, type GrupoResultadoBusca, type ItemResultadoBusca } from "@/lib/api";
import { haptic } from "@/lib/telegram";

const ROTULO: Record<GrupoBusca, string> = {
  musicas: "Músicas",
  videos: "Vídeos",
  albuns: "Álbuns",
  artistas: "Artistas",
};
const ICONE: Record<GrupoBusca, typeof Music> = { musicas: Music, videos: Clapperboard, albuns: Disc3, artistas: User };
const TERMO_MINIMO = 2;

export function BuscaRapida() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState("");
  const [grupos, setGrupos] = useState<GrupoResultadoBusca[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [buscado, setBuscado] = useState("");
  const controle = useRef<AbortController | null>(null);

  // Debounce 250 ms + cancela a busca anterior: só o último termo vale.
  useEffect(() => {
    const q = termo.trim();
    controle.current?.abort();
    if (q.length < TERMO_MINIMO) {
      setGrupos([]);
      setCarregando(false);
      setBuscado("");
      return;
    }
    setCarregando(true);
    const ctrl = new AbortController();
    controle.current = ctrl;
    const t = setTimeout(() => {
      api
        .buscar(q, { signal: ctrl.signal })
        .then((r) => {
          if (ctrl.signal.aborted) return;
          setGrupos(r.grupos);
          setBuscado(q);
          setCarregando(false);
        })
        .catch(() => {
          /* abortada: a próxima busca assume */
        });
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [termo]);

  const verTodos = async (grupo: GrupoBusca) => {
    const q = buscado;
    const r = await api.buscar(q, { grupo, limite: 50 });
    if (q !== termo.trim()) return;
    const novo = r.grupos.find((g) => g.grupo === grupo);
    if (novo) setGrupos((gs) => gs.map((g) => (g.grupo === grupo ? novo : g)));
  };

  const abrirItem = (item: ItemResultadoBusca) => {
    haptic.light();
    setAberto(false);
    setTermo("");
    router.navigate({ href: item.link });
  };

  const q = termo.trim();
  return (
    <>
      <button
        onClick={() => {
          haptic.light();
          setAberto(true);
        }}
        aria-label="Pesquisar"
        className="relative size-9 sm:size-11 shrink-0 grid place-items-center rounded-full border border-white/10 bg-white/[0.04] text-foreground active:scale-95 transition-all hover:bg-white/[0.08] hover:border-primary/30"
      >
        <Search className="size-[18px]" aria-hidden="true" />
      </button>
      <Dialog
        open={aberto}
        onOpenChange={(v) => {
          setAberto(v);
          if (!v) setTermo("");
        }}
      >
        <DialogContent className="overflow-hidden p-0 top-[12%] translate-y-0 w-[calc(100%-2rem)] max-w-lg rounded-2xl">
          <DialogTitle className="sr-only">Pesquisar</DialogTitle>
          <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-input]]:h-12">
            <CommandInput
              value={termo}
              onValueChange={setTermo}
              placeholder="Buscar músicas, vídeos, álbuns, artistas…"
            />
            <CommandList className="max-h-[60vh]">
              {q.length < TERMO_MINIMO ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">Digite pelo menos 2 letras</p>
              ) : carregando && !grupos.length ? (
                <p className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                  <span className="truncate">Buscando…</span>
                </p>
              ) : !grupos.length ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground break-words">
                  Nada encontrado para “{q}”
                </p>
              ) : (
                grupos.map((g) => {
                  const Icone = ICONE[g.grupo];
                  return (
                    <CommandGroup key={g.grupo} heading={ROTULO[g.grupo]}>
                      {g.itens.map((item) => (
                        <CommandItem
                          key={`${g.grupo}:${item.id}`}
                          value={`${g.grupo}:${item.id}`}
                          onSelect={() => abrirItem(item)}
                          className="flex min-w-0 items-center gap-3 px-2 py-2"
                        >
                          {item.capa ? (
                            <img
                              src={driveImg(item.capa, 120)}
                              alt=""
                              loading="lazy"
                              className={`size-10 shrink-0 object-cover ${g.grupo === "artistas" ? "rounded-full" : "rounded-md"}`}
                            />
                          ) : (
                            <span className="size-10 shrink-0 grid place-items-center rounded-md bg-white/[0.06]">
                              <Icone className="size-4 text-muted-foreground" aria-hidden="true" />
                            </span>
                          )}
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-semibold">{item.titulo}</span>
                            {item.subtitulo && (
                              <span className="truncate text-xs text-muted-foreground">{item.subtitulo}</span>
                            )}
                          </span>
                        </CommandItem>
                      ))}
                      {g.total > g.itens.length && (
                        <CommandItem
                          value={`${g.grupo}:__ver_todos`}
                          onSelect={() => verTodos(g.grupo)}
                          className="flex min-w-0 items-center justify-center gap-1 px-2 py-2 text-xs font-bold text-primary"
                        >
                          <span className="truncate">Ver todos ({g.total})</span>
                          <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
                        </CommandItem>
                      )}
                    </CommandGroup>
                  );
                })
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
