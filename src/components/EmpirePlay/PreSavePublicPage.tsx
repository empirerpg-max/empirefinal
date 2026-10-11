import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Rocket, Lock, ListMusic, Disc3, Maximize2 } from "lucide-react";
import { driveImgWide, formatarDataBR } from "@/lib/api";
import { EncarteViewer } from "./EncarteViewer";

interface FaixaPublica {
  num: number;
  titulo: string;
  revelada: boolean;
  jaLancada: boolean;
}

interface CampanhaPublica {
  id: string;
  artista: string;
  albumTituloFull: string;
  capaUrl: string;
  tipoAlbum: string;
  duracaoDias: number;
  modo: "missao" | "contagem";
  dataLancamento: string;
  status: "ativa" | "lancada" | "cancelada";
  albumTopicId: string;
  faixas: FaixaPublica[];
  acumuladoAtual: number;
}

// Página pública de acompanhamento de pre-save — acessível a qualquer
// jogador (não só o criador). Era a lacuna crítica reportada: o banner e
// os cards de campanha levavam pra lugar nenhum porque essa tela nunca
// tinha sido construída. Mostra: contagem regressiva, tracklist (nome
// real/"Track N" conforme a escolha do criador) e o contador de pre-save
// ao vivo — NUNCA o teto (o endpoint público já nunca devolve isso).
export function PreSavePublicPage({ campanhaId }: { campanhaId: string }) {
  const navigate = useNavigate();
  const [campanha, setCampanha] = useState<CampanhaPublica | null | undefined>(undefined);
  const [capaExpandida, setCapaExpandida] = useState(false);

  useEffect(() => {
    fetch(`/api/presave/contador-publico?id=${encodeURIComponent(campanhaId)}`)
      .then((r) => r.json())
      .then((res) => setCampanha(res?.success ? res.data : null))
      .catch(() => setCampanha(null));
  }, [campanhaId]);

  // Já lançado de verdade: a página de destino passa a ser o tópico real
  // do álbum no fórum (onde o contador também aparece, ver
  // PreSaveCounterBadge.tsx, e os comentários já estão liberados).
  useEffect(() => {
    if (campanha?.status === "lancada" && campanha.albumTopicId) {
      navigate({ to: "/empire-play/forum", search: { tab: "albuns", id: campanha.albumTopicId } });
    }
  }, [campanha, navigate]);

  if (campanha === undefined) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10 text-center text-neutral-500 text-sm">
        Carregando...
      </div>
    );
  }
  if (!campanha) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10 text-center text-neutral-500 text-sm">
        Campanha de pre-save não encontrada (ou já foi cancelada).
      </div>
    );
  }

  const diasFaltando = Math.max(
    0,
    Math.ceil((new Date(`${campanha.dataLancamento}T00:00:00`).getTime() - Date.now()) / 86400000),
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-28 space-y-6 min-w-0">
      <button
        onClick={() => navigate({ to: "/empire-play" })}
        className="flex items-center gap-1 text-xs font-bold text-neutral-400 hover:text-white"
      >
        <ChevronLeft className="size-4 shrink-0" />
        Voltar
      </button>

      <div className="flex items-center gap-4">
        {campanha.capaUrl ? (
          <button
            type="button"
            onClick={() => setCapaExpandida(true)}
            title="Ver capa em tela cheia"
            className="relative size-20 sm:size-24 rounded-2xl overflow-hidden shrink-0 group"
          >
            <img
              src={driveImgWide(campanha.capaUrl, 400)}
              alt=""
              className="w-full h-full object-cover group-hover:scale-105 transition"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center">
              <Maximize2 className="size-4 text-white opacity-0 group-hover:opacity-100 transition" />
            </div>
          </button>
        ) : (
          <div className="size-20 sm:size-24 rounded-2xl bg-neutral-800 shrink-0 flex items-center justify-center">
            <Disc3 className="size-8 text-neutral-600" />
          </div>
        )}
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-fuchsia-300 bg-fuchsia-500/10 border border-fuchsia-400/30 px-2 py-0.5 rounded-full">
            <Rocket className="size-2.5 shrink-0" />
            Pre-save
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-white leading-tight mt-1 truncate">
            {campanha.albumTituloFull}
          </h1>
          <p className="text-xs text-neutral-400 truncate">{campanha.tipoAlbum}</p>
        </div>
      </div>

      <div className="rounded-2xl bg-fuchsia-500/10 border border-fuchsia-400/30 p-4 text-center">
        <div className="text-3xl font-black text-white">{diasFaltando}</div>
        <div className="text-[11px] font-bold text-fuchsia-300 uppercase tracking-wider mt-0.5">
          dia{diasFaltando === 1 ? "" : "s"} pro lançamento (
          {formatarDataBR(campanha.dataLancamento)})
        </div>
      </div>

      <div className="rounded-2xl bg-neutral-800/40 border border-white/10 p-4">
        <div className="text-[10px] font-black uppercase tracking-wider text-neutral-400">
          Pre-saves acumulados
        </div>
        <div className="text-2xl font-black text-white mt-0.5">
          {campanha.acumuladoAtual.toLocaleString("pt-BR")}
        </div>
      </div>

      <div>
        <h2 className="text-xs font-black uppercase tracking-wider text-neutral-400 mb-2 flex items-center gap-2">
          <ListMusic className="size-3.5 shrink-0" />
          Faixas
        </h2>
        <div className="space-y-1">
          {campanha.faixas.map((f) => (
            <div
              key={f.num}
              className="flex items-center gap-3 px-3 py-2 rounded-xl bg-neutral-800/40 border border-white/5 min-w-0"
            >
              <span className="text-[11px] font-black text-neutral-500 w-5 shrink-0">{f.num}</span>
              <span
                className={`text-sm truncate flex-1 min-w-0 ${f.revelada ? "text-white font-bold" : "text-neutral-500 italic"}`}
              >
                {f.titulo}
              </span>
              {f.jaLancada && (
                <span className="text-[9px] font-black uppercase text-emerald-400 shrink-0">
                  já lançada
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-neutral-800/40 border border-white/10 p-4 flex items-center gap-3">
        <Lock className="size-4 text-neutral-500 shrink-0" />
        <p className="text-xs text-neutral-400">
          Comentários desse álbum ficam travados até o lançamento (
          {formatarDataBR(campanha.dataLancamento)}) — depois disso, o tópico abre pra comentar
          normalmente no Fórum.
        </p>
      </div>

      {capaExpandida && (
        <EncarteViewer
          paginas={[campanha.capaUrl]}
          indiceInicial={0}
          onClose={() => setCapaExpandida(false)}
        />
      )}
    </div>
  );
}
