import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BackButton } from "@/components/BackButton";
import { getStoredLogin, isAdminLogin } from "@/components/LoginScreen";
import { useTelegramUser } from "@/lib/telegram";
import { api } from "@/lib/api";
import { kickChannelFromUrl } from "@/lib/tvEmbed";

// Página de TESTE do som da Kick no celular — escondida (sem link no app) e
// só para admin. Não altera nada da Empire TV: só mostra o player da Kick com
// parâmetros diferentes, um de cada vez, pra comparar no iPhone e no Android
// quantos toques são precisos pra ouvir o som.
// Acesso: /tv-teste-som (opcional ?canal=nome-do-canal).
export const Route = createFileRoute("/tv-teste-som")({
  head: () => ({ meta: [{ title: "Teste de som — Empire TV" }] }),
  component: TesteSomPage,
});

type Variante = { id: string; titulo: string; params: string; explica: string };

const VARIANTES: Variante[] = [
  {
    id: "hoje",
    titulo: "A · Como é hoje",
    params: "autoplay=true&muted=false",
    explica:
      "Começa sozinho. No celular o navegador costuma forçar o mudo — conte quantos toques precisa pra ouvir.",
  },
  {
    id: "toque",
    titulo: "B · Toque no play da Kick",
    params: "autoplay=false&muted=false",
    explica:
      "Abre parado. Toque UMA vez no play do próprio player. A ideia é que já comece com som.",
  },
  {
    id: "mudo",
    titulo: "C · Começa mudo (referência)",
    params: "autoplay=true&muted=true",
    explica: "Começa sozinho e mudo. Serve só de comparação.",
  },
];

function TesteSomPage() {
  const { user } = useTelegramUser();
  const login = getStoredLogin();
  const tgId = user?.id?.toString() || login?.id || "";
  // Mesmo critério de admin do resto do app (LoginScreen.isAdminLogin).
  const isAdmin = isAdminLogin(login, tgId);

  const [canal, setCanal] = useState("");
  const [variante, setVariante] = useState<string>("hoje");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const doLink = new URLSearchParams(window.location.search).get("canal");
    if (doLink) {
      setCanal(doLink);
      return;
    }
    // Sem canal no link: usa o primeiro canal da Kick cadastrado na programação.
    api
      .listarProgramasTV()
      .then((lista) => {
        const slug = (lista || []).map((p) => kickChannelFromUrl(p.stream_url)).find(Boolean);
        if (slug) setCanal((c) => c || slug);
      })
      .catch(() => {});
  }, []);

  if (!isAdmin) {
    return (
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-20">
        <BackButton />
        <p className="text-muted-foreground mt-6">Página não encontrada.</p>
      </main>
    );
  }

  const v = VARIANTES.find((x) => x.id === variante)!;
  const src = canal ? `https://player.kick.com/${encodeURIComponent(canal.trim())}?${v.params}` : "";

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-20">
      <BackButton />
      <h1 className="text-2xl font-black mt-4">Teste de som da Kick</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Só admin vê esta página. Teste com um canal que esteja ao vivo, no iPhone e no Android. Para
        cada opção, toque em "Recarregar" e anote quantos toques foram precisos para ouvir o som.
      </p>

      <label className="block mt-5 text-xs font-semibold text-muted-foreground">Canal da Kick</label>
      <input
        value={canal}
        onChange={(e) => setCanal(e.target.value)}
        placeholder="nome-do-canal"
        className="mt-1 w-full rounded-lg bg-card border border-border px-3 py-2 text-sm"
      />

      <div className="mt-4 flex flex-col gap-2">
        {VARIANTES.map((x) => (
          <button
            key={x.id}
            onClick={() => {
              setVariante(x.id);
              setNonce((n) => n + 1);
            }}
            className={`min-w-0 text-left rounded-lg border px-3 py-2 ${
              variante === x.id ? "border-primary bg-primary/10" : "border-border bg-card"
            }`}
          >
            <span className="block truncate text-sm font-bold">{x.titulo}</span>
            <span className="block text-xs text-muted-foreground">{x.explica}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => setNonce((n) => n + 1)}
          className="shrink-0 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-bold"
        >
          Recarregar
        </button>
        <code className="min-w-0 truncate text-[11px] text-muted-foreground">{v.params}</code>
      </div>

      <div className="mt-4 aspect-video w-full overflow-hidden rounded-xl bg-black">
        {src ? (
          <iframe
            key={`${variante}-${nonce}`}
            src={src}
            className="h-full w-full"
            allow="autoplay; camera; microphone; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            title="Teste de som"
          />
        ) : (
          <div className="grid h-full place-items-center text-sm text-white/60">Digite o canal</div>
        )}
      </div>
    </main>
  );
}
