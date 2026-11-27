import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { BackButton } from "@/components/BackButton";
import { getStoredLogin, isAdminLogin } from "@/components/LoginScreen";
import { useTelegramUser } from "@/lib/telegram";
import { api, authHeaders } from "@/lib/api";
import { kickChannelFromUrl } from "@/lib/tvEmbed";

// Página de TESTE (escondida, só admin): tenta tocar a transmissão da Kick no
// player do PRÓPRIO app (HLS), para o botão "Ativar som" daqui funcionar com um
// toque — coisa que o player embutido da Kick não deixa. Não muda a sala.
// Acesso: /tv-teste-hls (opcional ?canal=nome-do-canal).
export const Route = createFileRoute("/tv-teste-hls")({
  head: () => ({ meta: [{ title: "Teste do player próprio — Empire TV" }] }),
  component: TesteHlsPage,
});

type Passo = { ok: boolean | null; texto: string };

function TesteHlsPage() {
  const { user } = useTelegramUser();
  const login = getStoredLogin();
  const tgId = user?.id?.toString() || login?.id || "";
  const isAdmin = isAdminLogin(login, tgId);

  const [canal, setCanal] = useState("");
  const [linkManual, setLinkManual] = useState("");
  const [passos, setPassos] = useState<Passo[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [mudo, setMudo] = useState(true);
  const [tocando, setTocando] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);

  useEffect(() => {
    const doLink = new URLSearchParams(window.location.search).get("canal");
    if (doLink) {
      setCanal(doLink);
      return;
    }
    api
      .listarProgramasTV()
      .then((lista) => {
        const slug = (lista || []).map((p) => kickChannelFromUrl(p.stream_url)).find(Boolean);
        if (slug) setCanal((c) => c || slug);
      })
      .catch(() => {});
  }, []);

  useEffect(() => () => hlsRef.current?.destroy(), []);

  const anotar = (p: Passo) => setPassos((l) => [...l, p]);

  // 1º tenta pelo navegador (direto na Kick), 2º pelo servidor do app.
  const buscarLink = async (slug: string): Promise<string | null> => {
    try {
      const r = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, { headers: { Accept: "application/json" } });
      const j = await r.json();
      if (typeof j?.playback_url === "string" && j.playback_url) {
        anotar({ ok: true, texto: "Link do vídeo obtido pelo navegador." });
        return j.playback_url;
      }
      anotar({ ok: false, texto: `Navegador: a Kick respondeu ${r.status} sem link (canal fora do ar?).` });
    } catch {
      anotar({ ok: false, texto: "Navegador: a Kick bloqueou o pedido direto." });
    }
    try {
      const r = await fetch(`/api/tv/kick-hls?canal=${encodeURIComponent(slug)}`, { headers: { ...authHeaders() } });
      const j = await r.json().catch(() => null);
      if (j?.ok && j.playback_url) {
        anotar({ ok: true, texto: "Link do vídeo obtido pelo servidor do app." });
        return j.playback_url as string;
      }
      anotar({ ok: false, texto: `Servidor: ${j?.erro || `erro ${r.status}`} (Kick: ${j?.status_kick ?? "?"})` });
    } catch {
      anotar({ ok: false, texto: "Servidor: sem conexão." });
    }
    return null;
  };

  const carregar = async () => {
    if (carregando) return;
    setCarregando(true);
    setPassos([]);
    setTocando(false);
    setMudo(true);
    hlsRef.current?.destroy();
    hlsRef.current = null;
    try {
      const link = linkManual.trim() || (canal.trim() ? await buscarLink(canal.trim().toLowerCase()) : null);
      if (!link) {
        anotar({ ok: false, texto: "Sem link do vídeo — não dá pra testar o player próprio." });
        return;
      }
      const v = videoRef.current;
      if (!v) return;
      anotar({ ok: null, texto: `Link: ${link.replace(/\?.*$/, "")}` });
      // Diagnóstico: o link do vídeo responde daqui? (sem isso nenhum player toca)
      try {
        const r = await fetch(link);
        const corpo = await r.text();
        const ehLista = corpo.startsWith("#EXTM3U");
        anotar({
          ok: r.ok && ehLista,
          texto: `Lista do vídeo: HTTP ${r.status}${ehLista ? " (lista válida)" : ` — ${corpo.slice(0, 80)}`}`,
        });
      } catch {
        anotar({ ok: false, texto: "Lista do vídeo: bloqueada pelo navegador (CORS) ou sem conexão." });
      }
      v.muted = true;
      // 1º o hls.js (no iPhone com iOS 17.1+ ele também funciona); se não
      // houver suporte, o HLS nativo do Safari.
      const { default: Hls } = await import("hls.js");
      const tocar = async (modo: string) => {
        try {
          await v.play();
          setTocando(true);
          anotar({ ok: true, texto: `Vídeo tocando (mudo) com ${modo}. Agora toque em "Ativar som".` });
          return true;
        } catch (e: any) {
          anotar({ ok: false, texto: `${modo}: não começou a tocar — ${e?.message || e}` });
          return false;
        }
      };
      if (Hls.isSupported()) {
        const hls = new Hls({ lowLatencyMode: true });
        hls.on(Hls.Events.ERROR, (_e, d) => {
          if (d.fatal) anotar({ ok: false, texto: `hls.js: erro ${d.type} / ${d.details}${d.response?.code ? ` (HTTP ${d.response.code})` : ""}` });
        });
        hlsRef.current = hls;
        const pronto = await new Promise<boolean>((res) => {
          const t = setTimeout(() => res(false), 15_000);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            clearTimeout(t);
            res(true);
          });
          hls.on(Hls.Events.ERROR, (_e, d) => {
            if (d.fatal) {
              clearTimeout(t);
              res(false);
            }
          });
          hls.loadSource(link);
          hls.attachMedia(v);
        });
        if (pronto && (await tocar("hls.js"))) return;
        hls.destroy();
        hlsRef.current = null;
      } else {
        anotar({ ok: null, texto: "hls.js sem suporte neste aparelho." });
      }
      if (v.canPlayType("application/vnd.apple.mpegurl")) {
        v.src = link;
        v.load();
        await tocar("HLS nativo");
      } else {
        anotar({ ok: false, texto: "Este navegador não toca HLS." });
      }
    } finally {
      setCarregando(false);
    }
  };

  // O toque NESTE botão é o que o navegador exige para liberar o som.
  const alternarSom = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMudo(v.muted);
    if (!v.muted) {
      v.volume = 1;
      void v.play().then(
        () => anotar({ ok: true, texto: "Som ativado com um toque. ✔" }),
        (e) => anotar({ ok: false, texto: `O navegador barrou o som: ${e?.message || e}` }),
      );
    }
  };

  if (!isAdmin) {
    return (
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-20">
        <BackButton />
        <p className="text-muted-foreground mt-6">Página não encontrada.</p>
      </main>
    );
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-20">
      <BackButton />
      <h1 className="text-2xl font-black mt-4">Teste do player próprio</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Só admin vê esta página. Com o canal AO VIVO, toque em "Carregar", depois em "Ativar som", e me diga se ouviu o
        som — no iPhone e no Android.
      </p>

      <label className="block mt-5 text-xs font-semibold text-muted-foreground">Canal da Kick</label>
      <input
        value={canal}
        onChange={(e) => setCanal(e.target.value)}
        placeholder="nome-do-canal"
        className="mt-1 w-full rounded-lg bg-card border border-border px-3 py-2 text-sm"
      />
      <label className="block mt-3 text-xs font-semibold text-muted-foreground">Link .m3u8 (opcional, só se eu pedir)</label>
      <input
        value={linkManual}
        onChange={(e) => setLinkManual(e.target.value)}
        placeholder="https://…m3u8"
        className="mt-1 w-full rounded-lg bg-card border border-border px-3 py-2 text-sm"
      />

      <div className="mt-4 flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={() => void carregar()}
          disabled={carregando}
          className="min-w-0 shrink-0 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-bold disabled:opacity-50"
        >
          <span className="truncate">{carregando ? "Carregando…" : "Carregar"}</span>
        </button>
        <button
          type="button"
          onClick={alternarSom}
          disabled={!tocando}
          className="min-w-0 shrink-0 rounded-lg border border-border bg-card px-4 py-2 text-sm font-bold disabled:opacity-40"
        >
          <span className="truncate">{mudo ? "🔊 Ativar som" : "🔇 Mutar"}</span>
        </button>
      </div>

      <div className="mt-4 aspect-video w-full overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} className="h-full w-full" playsInline muted controls={false} />
      </div>

      <ol className="mt-4 space-y-1 text-xs">
        {passos.map((p, i) => (
          <li key={i} className={p.ok === false ? "text-red-400" : p.ok ? "text-emerald-400" : "text-muted-foreground"}>
            {p.ok === false ? "✗ " : p.ok ? "✓ " : "• "}
            {p.texto}
          </li>
        ))}
      </ol>
    </main>
  );
}
