import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  Disc3,
  Loader2,
  Plus,
  Trash2,
  Image as ImageIcon,
  Save,
  AlertCircle,
} from "lucide-react";
import { api, type AlbumFaixa, type AlbumPayload } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";
import { Field, Input, ResultBanner } from "./acoes.tour";

export const Route = createFileRoute("/album/$id/editar")({
  component: AlbumEditor,
});

function AlbumEditor() {
  const { id } = Route.useParams();
  const { user } = useTelegramUser();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [album, setAlbum] = useState<AlbumPayload | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  // Form states
  const [titulo, setTitulo] = useState("");
  const [genero, setGenero] = useState("Pop");
  const [data, setData] = useState("");
  const [descricao, setDescricao] = useState("");
  const [capa, setCapa] = useState("");
  const [contracapa, setContracapa] = useState("");
  const [encarte, setEncarte] = useState<string[]>([]);
  const [faixas, setFaixas] = useState<AlbumFaixa[]>([]);

  useEffect(() => {
    api.getAlbum(id).then((a) => {
      if (!a) {
        setLoading(false);
        return;
      }

      // Permission check using local ID from login
      const localId = typeof window !== "undefined" ? localStorage.getItem("empire_tg_id") : null;
      if (
        a.telegram_id &&
        localId &&
        localId !== "810141686" &&
        String(a.telegram_id) !== String(localId)
      ) {
        setUnauthorized(true);
        setLoading(false);
        return;
      }

      setAlbum(a);
      setTitulo(a.titulo);
      setGenero(a.genero);
      setData(a.data);
      setDescricao(a.descricao || "");
      setCapa(a.capa_url);
      setContracapa(a.contracapa_url || "");
      setEncarte(a.encarte || []);
      setFaixas(a.faixas || []);
      setLoading(false);
    });
  }, [id, user]);

  function addFaixa() {
    setFaixas((f) => [
      ...f,
      {
        numero: f.length + 1,
        titulo: "",
        artistas: album?.artista || "",
        drive_url: "",
        duracao: "",
      },
    ]);
  }
  function rmFaixa(i: number) {
    setFaixas((f) => f.filter((_, idx) => idx !== i).map((x, idx) => ({ ...x, numero: idx + 1 })));
  }
  function updFaixa(i: number, patch: Partial<AlbumFaixa>) {
    setFaixas((f) => f.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function addEncarteSlot() {
    setEncarte((e) => [...e, ""]);
  }
  function updEncarte(i: number, v: string) {
    setEncarte((e) => e.map((x, idx) => (idx === i ? v : x)));
  }
  function rmEncarte(i: number) {
    setEncarte((e) => e.filter((_, idx) => idx !== i));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo || !data || !capa || faixas.some((f) => !f.titulo || !f.drive_url)) {
      setResult("Preencha título, data, capa e todas as faixas (título + link Drive).");
      return;
    }
    setSubmitting(true);
    setResult(null);

    const localTgId = typeof window !== "undefined" ? localStorage.getItem("empire_tg_id") : null;
    const r = await api.editarAlbum({
      id,
      artista: album?.artista || "",
      titulo,
      genero,
      data,
      descricao,
      capa_url: capa,
      contracapa_url: contracapa || undefined,
      encarte: encarte.filter(Boolean),
      faixas,
      telegram_id: localTgId || user?.id,
    });

    setSubmitting(false);
    if (r?.ok) {
      navigate({ to: "/album/$id", params: { id } });
    } else {
      setResult(r?.message || "Erro ao salvar alterações.");
    }
  }

  if (loading) {
    return (
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-40 text-center">
        <Loader2 className="size-10 animate-spin mx-auto text-primary" />
        <p className="mt-4 text-muted-foreground">Carregando dados do álbum...</p>
      </main>
    );
  }

  if (unauthorized) {
    return (
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-20 text-center">
        <div className="size-20 rounded-full bg-destructive/10 text-destructive grid place-items-center mx-auto mb-6">
          <AlertCircle className="size-10" />
        </div>
        <h1 className="text-2xl font-bold">Acesso Negado</h1>
        <p className="mt-2 text-muted-foreground">
          Apenas o artista que lançou este álbum pode editá-lo.
        </p>
        <Link
          to="/album/$id"
          params={{ id }}
          className="mt-6 inline-flex text-primary font-bold hover:underline"
        >
          Voltar para o álbum
        </Link>
      </main>
    );
  }

  if (!album) {
    return (
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-20 text-center">
        <p className="text-muted-foreground">Álbum não encontrado.</p>
        <Link to="/" className="mt-4 inline-flex text-primary font-bold hover:underline">
          Voltar para Home
        </Link>
      </main>
    );
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-20">
      <Link
        to="/album/$id"
        params={{ id }}
        className="inline-flex items-center gap-1 text-muted-foreground mb-4"
      >
        <ChevronLeft className="size-4" /> Voltar
      </Link>
      <header className="mb-6 flex items-center gap-3">
        <div className="size-12 rounded-xl bg-primary/15 text-primary grid place-items-center text-center">
          <Disc3 className="size-6" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold">
            {album.artista}
          </p>
          <h1 className="text-2xl font-extrabold">Editar Álbum</h1>
          <p className="text-xs text-muted-foreground mt-1">
            ID: {id} • Atualize as informações do seu lançamento.
          </p>
        </div>
      </header>

      <form onSubmit={submit} className="space-y-6">
        <div className="flex gap-4">
          <div className="size-32 rounded-xl overflow-hidden bg-card grid place-items-center shrink-0">
            {capa ? (
              <img src={driveImgPreview(capa)} alt="capa" className="w-full h-full object-cover"  loading="lazy" decoding="async"/>
            ) : (
              <ImageIcon className="size-8 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 space-y-3">
            <Field label="Título do álbum">
              <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Gênero">
                <select
                  value={genero}
                  onChange={(e) => setGenero(e.target.value)}
                  className="w-full bg-card border border-border rounded-xl px-3 py-3 text-sm"
                >
                  {[
                    "Pop",
                    "Rock",
                    "Hip-Hop",
                    "R&B",
                    "Eletrônica",
                    "Country",
                    "Latina",
                    "Sertanejo",
                    "Funk",
                    "Indie",
                    "Jazz",
                  ].map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </Field>
              <Field label="Data">
                <Input
                  type="date"
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                  required
                />
              </Field>
            </div>
          </div>
        </div>

        <Field label="Capa (link Drive público)">
          <Input
            value={capa}
            onChange={(e) => setCapa(e.target.value)}
            placeholder="https://drive.google.com/file/d/..."
            required
          />
        </Field>
        <Field label="Contracapa (opcional)">
          <Input
            value={contracapa}
            onChange={(e) => setContracapa(e.target.value)}
            placeholder="https://drive.google.com/file/d/..."
          />
        </Field>

        <Field label="Descrição (opcional)">
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={2}
            className="w-full bg-card border border-border rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-primary"
          />
        </Field>

        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs uppercase tracking-widest font-bold text-muted-foreground">
              Encarte ({encarte.length})
            </h3>
            <button
              type="button"
              onClick={addEncarteSlot}
              className="text-xs font-bold text-primary inline-flex items-center gap-1"
            >
              <Plus className="size-3.5" /> Adicionar imagem
            </button>
          </div>
          <div className="space-y-2">
            {encarte.map((url, i) => (
              <div key={i} className="flex gap-2 items-center">
                <div className="size-12 rounded-lg bg-card overflow-hidden shrink-0">
                  {url && (
                    <img src={driveImgPreview(url)} alt="" className="w-full h-full object-cover"  loading="lazy" decoding="async"/>
                  )}
                </div>
                <Input
                  value={url}
                  onChange={(e) => updEncarte(i, e.target.value)}
                  placeholder="Link Drive da imagem"
                />
                <button
                  type="button"
                  onClick={() => rmEncarte(i)}
                  className="size-9 rounded-lg bg-card grid place-items-center shrink-0 text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs uppercase tracking-widest font-bold text-muted-foreground">
              Tracklist ({faixas.length})
            </h3>
            <button
              type="button"
              onClick={addFaixa}
              className="text-xs font-bold text-primary inline-flex items-center gap-1"
            >
              <Plus className="size-3.5" /> Nova faixa
            </button>
          </div>
          <div className="space-y-3">
            {faixas.map((f, i) => (
              <div key={i} className="p-3 rounded-xl bg-card border border-border space-y-2">
                <div className="flex items-center gap-2">
                  <span className="size-7 rounded-md bg-primary/15 text-primary grid place-items-center font-black text-sm">
                    {f.numero}
                  </span>
                  <Input
                    value={f.titulo}
                    onChange={(e) => updFaixa(i, { titulo: e.target.value })}
                    placeholder="Título da faixa"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => rmFaixa(i)}
                    className="size-9 rounded-lg bg-secondary grid place-items-center shrink-0 text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={f.artistas}
                    onChange={(e) => updFaixa(i, { artistas: e.target.value })}
                    placeholder="Artistas"
                  />
                  <Input
                    value={f.duracao || ""}
                    onChange={(e) => updFaixa(i, { duracao: e.target.value })}
                    placeholder="Duração"
                  />
                </div>
                <Input
                  value={f.drive_url}
                  onChange={(e) => updFaixa(i, { drive_url: e.target.value })}
                  placeholder="Link Drive do mp3"
                  required
                />
                <textarea
                  value={f.letra || ""}
                  onChange={(e) => updFaixa(i, { letra: e.target.value })}
                  rows={2}
                  placeholder="Letra (opcional)"
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-primary"
                />
              </div>
            ))}
          </div>
        </section>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 py-3.5 rounded-full bg-primary text-primary-foreground font-extrabold uppercase tracking-wider text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Salvar Alterações
          </button>
        </div>

        {result && <ResultBanner text={result} />}
      </form>
    </main>
  );
}

function driveImgPreview(url: string | undefined | null) {
  if (!url) return undefined;
  const m = String(url).match(/[-\w]{25,}/);
  return m ? `https://lh3.googleusercontent.com/d/${m[0]}=w200-h200` : (url as string);
}
