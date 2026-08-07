import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Disc3, Search } from "lucide-react";
import { api, driveImg, type AlbumPayload } from "@/lib/api";

export const Route = createFileRoute("/albuns")({
  component: AlbunsPage,
  head: () => ({
    meta: [
      { title: "Álbuns • Empire Hub" },
      { name: "description", content: "Todos os álbuns lançados no Empire." },
    ],
  }),
});

function AlbunsPage() {
  const [list, setList] = useState<AlbumPayload[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    api.listarAlbuns().then(setList);
  }, []);

  const filtered = (list || []).filter((a) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return a.titulo.toLowerCase().includes(s) || a.artista.toLowerCase().includes(s);
  });

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-12">
      <header className="mb-8">
        <p className="text-[10px] uppercase tracking-[0.2em] text-primary/70 font-black mb-1">
          Produção Fonográfica
        </p>
        <h1 className="text-xl font-black tracking-tight">Empire Albums</h1>
      </header>
      
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/50" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar obras primas..."
          className="w-full bg-white/[0.03] border border-white/5 rounded-2xl pl-11 pr-4 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-inner"
        />
      </div>

      {list === null ? (
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-2xl bg-card animate-pulse border border-white/5" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-16 italic">Nenhum registro encontrado nesta era.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {filtered.map((a) => (
            <Link key={a.id} to="/album/$id" params={{ id: a.id! }} className="group">
              <div className="aspect-square rounded-2xl overflow-hidden bg-secondary border border-white/10 charcoal-sketch shadow-xl transition-transform group-active:scale-95">
                {a.capa_url ? (
                  <img
                    src={driveImg(a.capa_url, 400)}
                    alt={a.titulo}
                    className="w-full h-full object-cover grayscale opacity-80 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-500"
                    loading="lazy"
                   decoding="async"/>
                ) : (
                  <div className="w-full h-full grid place-items-center bg-card">
                    <Disc3 className="size-10 text-muted-foreground/30" />
                  </div>
                )}
              </div>
              <div className="mt-3 px-1">
                <p className="font-bold text-sm truncate tracking-tight">{a.titulo}</p>
                <p className="text-[10px] font-black text-primary uppercase tracking-widest mt-0.5">{a.artista}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
