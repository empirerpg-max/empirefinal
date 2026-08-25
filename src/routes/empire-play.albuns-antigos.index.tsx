import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Disc3 } from "lucide-react";
import { api, driveImg } from "@/lib/api";

export const Route = createFileRoute("/empire-play/albuns-antigos/")({
  component: AlbunsAntigosPage,
});

function AlbunsAntigosPage() {
  const [albuns, setAlbuns] = useState<
    Awaited<ReturnType<typeof api.listarAlbunsAntigos>> | null
  >(null);
  // Sem o .catch, uma falha na chamada deixava `albuns` null pra sempre —
  // o skeleton de carregamento ficava girando indefinidamente em vez de
  // cair pra um estado vazio/erro.
  const [erro, setErro] = useState(false);

  useEffect(() => {
    api
      .listarAlbunsAntigos()
      .then(setAlbuns)
      .catch(() => setErro(true));
  }, []);

  return (
    <div>
      <Link to="/empire-play/albuns" className="inline-flex items-center gap-1 text-neutral-400 mb-4">
        <ChevronLeft className="size-4" /> Voltar
      </Link>

      <header className="mb-6 flex items-center gap-3">
        <Disc3 className="size-7 text-emerald-500" />
        <div>
          <p className="text-[10px] uppercase tracking-widest text-neutral-500 font-black">Catálogo</p>
          <h1 className="text-xl font-black text-white">Álbuns legados</h1>
        </div>
      </header>

      {erro ? (
        <div className="text-center py-12 text-neutral-500 text-xs italic">
          Falha ao carregar os álbuns legados. Tente novamente em instantes.
        </div>
      ) : albuns === null ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-2xl bg-neutral-900/60 animate-pulse border border-white/5" />
          ))}
        </div>
      ) : albuns.length === 0 ? (
        <div className="text-center py-12 text-neutral-500 text-xs italic">
          Nenhum álbum antigo cadastrado ainda.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {albuns.map((a) => (
            <Link
              key={a.id}
              to="/empire-play/albuns-antigos/$id"
              params={{ id: a.id }}
              className="group"
            >
              <div className="aspect-square rounded-2xl bg-neutral-900 overflow-hidden border border-white/10 group-hover:border-emerald-500/40 transition-colors">
                {a.capa_url ? (
                  <img
                    src={driveImg(a.capa_url, 300)}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-neutral-700">
                    <Disc3 className="size-8" />
                  </div>
                )}
              </div>
              <p className="mt-2 text-sm font-bold text-white truncate group-hover:text-emerald-400">{a.titulo}</p>
              <p className="text-xs text-neutral-500 truncate">
                {a.artista} • {a.totalFaixas} faixas
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
