import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Play } from "lucide-react";
import { SmartImg } from "@/components/SmartImg";
import { DynamicCoverCard, type CoverPlatform } from "@/components/EmpirePlay/DynamicCoverCard";
import { StickyScrollArrowLeft, StickyScrollArrowRight } from "@/components/StickyScrollArrows";
import { useDragScroll } from "@/hooks/useDragScroll";
import { haptic } from "@/lib/telegram";
import {
  getIndicePlaylists,
  indiceVazio,
  plataformaDoId,
  type CartaoPlaylist,
  type DestaquePlaylists,
  type IndicePlaylists,
  type PlataformaPlaylist,
} from "@/lib/playlistsEmpirePlay";

const ATUALIZAR_MS = 30_000;
const FONTE_TITULO = "'Fjalla One', 'Arial Narrow', sans-serif";

/**
 * Tela inicial do catálogo do Empire Play: destaque "Mais quente agora"
 * (modelo C do mockup) + prateleiras que rolam para o lado (modelo A).
 * Títulos SEMPRE completos: quebram linha e a fonte encolhe (clamp), nunca "…".
 */
export function PlaylistsInicio({
  onAbrir,
  pausado = false,
}: {
  onAbrir: (id: string) => void;
  /** true enquanto uma playlist está aberta por cima: o índice não recarrega. */
  pausado?: boolean;
}) {
  const [indice, setIndice] = useState<IndicePlaylists | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [plataformaPais, setPlataformaPais] = useState<PlataformaPlaylist>("spotify");

  const pausadoRef = useRef(pausado);
  pausadoRef.current = pausado;
  const montadoRef = useRef(true);

  // Só a resposta do pedido mais recente vale: uma resposta lenta não
  // sobrescreve outra mais nova.
  const seqRef = useRef(0);
  const carregar = useCallback(() => {
    const seq = ++seqRef.current;
    getIndicePlaylists()
      .then((i) => {
        if (montadoRef.current && seq === seqRef.current) setIndice(i);
      })
      .catch((err) => console.warn("[PlaylistsInicio] índice:", err))
      .finally(() => {
        if (montadoRef.current) setCarregando(false);
      });
  }, []);

  // Carrega já e recarrega a cada 30 s, só com a tela visível e nenhuma
  // playlist aberta; volta a carregar ao reaparecer a aba.
  useEffect(() => {
    montadoRef.current = true;
    carregar();
    const podeAtualizar = () => document.visibilityState === "visible" && !pausadoRef.current;
    const t = window.setInterval(() => {
      if (podeAtualizar()) carregar();
    }, ATUALIZAR_MS);
    const onVis = () => {
      if (podeAtualizar()) carregar();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      montadoRef.current = false;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [carregar]);

  // Fechou a playlist: atualiza na hora (o intervalo ficou parado).
  const estavaPausado = useRef(pausado);
  useEffect(() => {
    if (estavaPausado.current && !pausado) carregar();
    estavaPausado.current = pausado;
  }, [pausado, carregar]);

  const abrir = (id: string) => {
    haptic.selection();
    onAbrir(id);
  };

  if (carregando && !indice) return <Esqueleto />;
  if (indiceVazio(indice)) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] px-4 py-16 text-center text-sm font-bold text-neutral-400">
        Sem dados agora.
      </div>
    );
  }
  const i = indice!;
  const paises = i.paises?.[plataformaPais] ?? [];
  const temPaises = !!(
    i.paises?.spotify?.length ||
    i.paises?.apple?.length ||
    i.paises?.youtube?.length
  );

  return (
    <div className="space-y-7">
      {i.destaque && <Destaque destaque={i.destaque} onAbrir={abrir} />}

      {i.globais.length > 0 && (
        <Prateleira titulo="Charts globais" legenda="ao vivo" cartoes={i.globais} onAbrir={abrir} />
      )}

      {temPaises && (
        <Prateleira
          titulo="Top 50 por país"
          acoes={<PillsPlataforma valor={plataformaPais} onTrocar={setPlataformaPais} />}
          cartoes={paises}
          onAbrir={abrir}
        />
      )}

      {i.paradas.length > 0 && (
        <Prateleira
          titulo="Paradas oficiais"
          legenda="semanal"
          cartoes={i.paradas}
          onAbrir={abrir}
        />
      )}

      {i.generos.length > 0 && (
        <Prateleira titulo="Por gênero" legenda="Global 100" cartoes={i.generos} onAbrir={abrir} />
      )}
    </div>
  );
}

// ---- Destaque "Mais quente agora" ----

function Destaque({
  destaque,
  onAbrir,
}: {
  destaque: DestaquePlaylists;
  onAbrir: (id: string) => void;
}) {
  const d = destaque;
  const linha =
    d.subiu > 0
      ? `${d.musica} subiu ${d.subiu} ${d.subiu === 1 ? "posição" : "posições"} desde o último chart · ${d.valor}`
      : `Ao vivo agora · ${d.valor}`;
  return (
    <button
      type="button"
      onClick={() => onAbrir(d.id)}
      className="group relative block w-full overflow-hidden rounded-3xl border border-white/10 bg-neutral-900 text-left active:scale-[0.99] transition-transform"
    >
      {/* Fundo: a capa da #1, escurecida para leitura. */}
      <div className="absolute inset-0 sm:scale-110 sm:blur-2xl sm:opacity-80">
        <CapaPlaylist id={d.id} capaUrl={d.capa_url} tamanho={900} />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/55 to-black/15" />
      <div className="absolute inset-0 hidden sm:block bg-gradient-to-r from-black/70 via-black/30 to-transparent" />

      <div className="relative flex min-h-[250px] items-end gap-6 p-5 sm:min-h-[280px] sm:p-8">
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-white">
            <span className="size-2 shrink-0 rounded-full bg-red-500 animate-pulse motion-reduce:animate-none" />
            Mais quente agora
          </span>
          <span
            role="heading"
            aria-level={2}
            className="mt-1.5 block uppercase text-white leading-[0.95] break-words [overflow-wrap:anywhere]"
            style={{ fontFamily: FONTE_TITULO, fontSize: "clamp(30px, 8.5vw, 60px)" }}
          >
            {d.titulo}
          </span>
          <p className="mt-2.5 max-w-2xl text-[13px] sm:text-sm font-semibold leading-snug text-white/85 break-words [overflow-wrap:anywhere]">
            {linha}
          </p>
          <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[11px] font-black uppercase tracking-wide text-black">
            <Play className="size-3.5 shrink-0 fill-black" />
            <span>Ouvir playlist</span>
          </span>
        </div>
        {/* No desktop, a capa nítida ao lado (o fundo largo fica desfocado). */}
        <div className="relative hidden sm:block size-44 lg:size-56 shrink-0 overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/15">
          <CapaPlaylist id={d.id} capaUrl={d.capa_url} tamanho={600} />
        </div>
      </div>
    </button>
  );
}

// ---- Prateleira (fileira rolável) ----

function Prateleira({
  titulo,
  legenda,
  acoes,
  cartoes,
  onAbrir,
}: {
  titulo: string;
  legenda?: string;
  acoes?: ReactNode;
  cartoes: CartaoPlaylist[];
  onAbrir: (id: string) => void;
}) {
  const fileira = useDragScroll<HTMLDivElement>();
  return (
    <section>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-base sm:text-lg font-black tracking-tight text-white">{titulo}</h2>
        {legenda && <span className="text-[11px] font-semibold text-neutral-400">{legenda}</span>}
        {acoes}
      </div>
      {cartoes.length === 0 ? (
        <p className="py-6 text-center text-xs font-bold text-neutral-500">Sem dados agora.</p>
      ) : (
        <div
          ref={fileira.ref}
          className="flex gap-3 overflow-x-auto scrollbar-hide pb-1 cursor-grab active:cursor-grabbing select-none"
        >
          <StickyScrollArrowLeft
            show={fileira.canScrollLeft}
            onClick={() => fileira.scrollByAmount(-1)}
          />
          <StickyScrollArrowRight
            show={fileira.canScrollRight}
            onClick={() => fileira.scrollByAmount(1)}
          />
          {cartoes.map((c) => (
            <CartaoCapa key={c.id} cartao={c} onAbrir={onAbrir} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Tamanho do título por cima da capa: a maior palavra precisa caber numa
 * linha (Fjalla One em caixa alta ≈ 0,58 em por letra), então a fonte é
 * proporcional à largura do card (cqw) e encolhe para palavras longas.
 * Títulos compridos têm teto menor para não cobrir a capa inteira.
 */
function fonteDoTitulo(titulo: string): string {
  const maiorPalavra = Math.max(1, ...titulo.split(/\s+/).map((p) => p.length));
  const letras = Math.max(maiorPalavra * 0.58, 5.5);
  const teto = titulo.length > 20 ? 17 : 20;
  return `clamp(12px, calc((100cqw - 20px) / ${letras.toFixed(2)}), ${teto}px)`;
}

function CartaoCapa({
  cartao,
  onAbrir,
}: {
  cartao: CartaoPlaylist;
  onAbrir: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onAbrir(cartao.id)}
      className="group flex w-[136px] sm:w-[156px] lg:w-[172px] shrink-0 flex-col gap-1.5 text-left"
    >
      {/* Capa quadrada que CRESCE se o título não couber: o título fica no
          fluxo (não absoluto) e o recorte arredondado mora numa camada de
          fundo — com overflow visível, aspect-ratio vira altura mínima. */}
      <div
        className="relative flex aspect-square w-full flex-col rounded-2xl border border-white/10 bg-neutral-900 p-2.5 transition group-hover:border-white/30 group-active:scale-[0.98]"
        style={{ containerType: "inline-size" }}
      >
        <div className="absolute inset-0 overflow-hidden rounded-2xl">
          <CapaPlaylist id={cartao.id} capaUrl={cartao.capa_url} tamanho={400} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-black/5" />
        </div>
        {cartao.aoVivo && (
          <span className="relative -ml-0.5 -mt-0.5 inline-flex self-start items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-white backdrop-blur-sm">
            <span className="size-1.5 shrink-0 rounded-full bg-red-500 animate-pulse motion-reduce:animate-none" />
            Ao vivo
          </span>
        )}
        <span
          role="heading"
          aria-level={3}
          className="relative mt-auto block pt-2 uppercase text-white leading-[1.02] break-words [overflow-wrap:anywhere]"
          style={{
            fontFamily: FONTE_TITULO,
            fontSize: fonteDoTitulo(cartao.titulo),
            textShadow: "0 2px 10px rgba(0,0,0,.6)",
          }}
        >
          {cartao.titulo}
        </span>
      </div>
      {cartao.subtitulo && (
        <p className="px-0.5 text-[11px] leading-snug text-neutral-400 break-words">
          {cartao.subtitulo}
        </p>
      )}
    </button>
  );
}

// ---- Capa: material (#1 da playlist), senão capa dinâmica da plataforma ----

const GRADIENTE_SEMANA: Record<string, string> = {
  global100: "from-amber-400 to-amber-900",
  parada: "from-blue-600 to-red-800",
  genero: "from-fuchsia-500 to-violet-900",
};

function plataformaDaCapa(id: string): CoverPlatform | null {
  if (id === "semana:hot") return "hot";
  return plataformaDoId(id);
}

function CapaReserva({ id }: { id: string }) {
  const plat = plataformaDaCapa(id);
  if (plat) return <DynamicCoverCard platform={plat} className="absolute inset-0" />;
  const tipo = id.split(":")[1] ?? "";
  return (
    <div
      className={`absolute inset-0 bg-gradient-to-br ${GRADIENTE_SEMANA[tipo] ?? "from-neutral-600 to-neutral-900"}`}
    />
  );
}

function CapaPlaylist({
  id,
  capaUrl,
  tamanho,
}: {
  id: string;
  capaUrl: string | null;
  tamanho: number;
}) {
  if (!capaUrl) return <CapaReserva id={id} />;
  return (
    <SmartImg
      src={capaUrl}
      size={tamanho}
      alt=""
      className="absolute inset-0 size-full object-cover"
      fallback={<CapaReserva id={id} />}
    />
  );
}

// ---- Pills de plataforma (Top 50 por país) ----

const PLATAFORMAS: { id: PlataformaPlaylist; label: string; ativo: string }[] = [
  { id: "spotify", label: "Spotify", ativo: "bg-emerald-500 text-black border-emerald-500" },
  { id: "apple", label: "Apple Music", ativo: "bg-rose-500 text-white border-rose-500" },
  { id: "youtube", label: "YouTube", ativo: "bg-red-600 text-white border-red-600" },
];

function PillsPlataforma({
  valor,
  onTrocar,
}: {
  valor: PlataformaPlaylist;
  onTrocar: (p: PlataformaPlaylist) => void;
}) {
  const fileira = useDragScroll<HTMLDivElement>();
  return (
    <div
      ref={fileira.ref}
      className="flex min-w-0 max-w-full gap-1.5 overflow-x-auto scrollbar-hide cursor-grab active:cursor-grabbing select-none"
    >
      <StickyScrollArrowLeft
        show={fileira.canScrollLeft}
        onClick={() => fileira.scrollByAmount(-1)}
      />
      <StickyScrollArrowRight
        show={fileira.canScrollRight}
        onClick={() => fileira.scrollByAmount(1)}
      />
      {PLATAFORMAS.map((p) => {
        const ativo = p.id === valor;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              haptic.selection();
              onTrocar(p.id);
            }}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-black transition active:scale-95 ${
              ativo
                ? p.ativo
                : "border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/[0.08] hover:text-white"
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- Carregando ----

function Esqueleto() {
  return (
    <div className="space-y-7 animate-pulse" aria-busy="true">
      <div className="h-[250px] sm:h-[280px] rounded-3xl bg-white/[0.06]" />
      {[0, 1].map((k) => (
        <div key={k}>
          <div className="mb-2.5 h-5 w-40 rounded bg-white/[0.06]" />
          <div className="flex gap-3 overflow-hidden">
            {[0, 1, 2, 3, 4].map((j) => (
              <div
                key={j}
                className="aspect-square w-[136px] sm:w-[156px] lg:w-[172px] shrink-0 rounded-2xl bg-white/[0.06]"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
