import { useEffect, useState } from "react";
import { Image as ImageIcon, Link2, Trash2, Loader2, GripVertical, Search } from "lucide-react";
import { driveImg, authHeaders } from "@/lib/api";

interface BannerRow {
  id: string;
  imagem_url: string;
  link_destino?: string;
  legenda?: string;
  ordem: number;
}

type DestinoTipo = "musica" | "video" | "album" | "artista" | "tv" | "manual";

interface DestinoItem {
  id: string;
  titulo: string;
  subtitulo?: string;
}

const DESTINO_TIPOS: { value: DestinoTipo; label: string }[] = [
  { value: "musica", label: "Uma Música" },
  { value: "video", label: "Um Vídeo" },
  { value: "album", label: "Um Álbum" },
  { value: "artista", label: "Um Artista" },
  { value: "tv", label: "Empire TV" },
  { value: "manual", label: "Link manual" },
];

// Cada tipo de destino busca numa fonte diferente e monta um link interno
// diferente — assim o admin escolhe "uma música" e seleciona ela pelo nome,
// em vez de precisar saber/montar a URL na mão.
async function buscarDestinos(tipo: DestinoTipo): Promise<DestinoItem[]> {
  if (tipo === "musica" || tipo === "video" || tipo === "album") {
    const endpoint =
      tipo === "musica" ? "/api/empire-play/musicas" : tipo === "video" ? "/api/empire-play/videos" : "/api/empire-play/albuns";
    const res = await fetch(endpoint);
    const data = await res.json().catch(() => null);
    const list: any[] = data?.success && Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
    return list
      .map((item) => ({
        id: String(item.id || item.title || item.titulo || ""),
        titulo: item.title || item.titulo || item.nome_da_musica || item.nome_do_video || "Sem título",
        subtitulo: item.artist || item.artista || item.act_principal || undefined,
      }))
      .filter((d) => d.id);
  }
  if (tipo === "artista") {
    const res = await fetch("/api/artistas/listar-todos");
    const data = await res.json().catch(() => null);
    const list: any[] = data?.success && Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
    return list.filter((a) => a.nome).map((a) => ({ id: a.nome, titulo: a.nome, subtitulo: a.gravadora }));
  }
  return [];
}

function montarLink(tipo: DestinoTipo, id: string): string {
  if (tipo === "musica") return `/empire-play/forum?tab=musicas&id=${encodeURIComponent(id)}`;
  if (tipo === "video") return `/empire-play/forum?tab=videos&id=${encodeURIComponent(id)}`;
  if (tipo === "album") return `/empire-play/forum?tab=albuns&id=${encodeURIComponent(id)}`;
  if (tipo === "artista") return `/artistas/${encodeURIComponent(id)}`;
  if (tipo === "tv") return "/tv";
  return "";
}

async function uploadBannerImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("fileName", `BANNER_${Date.now()}_${file.name}`);
  formData.append("folderType", "socialPosts");

  const res = await fetch("/api/gestao/upload", { method: "POST", body: formData });
  const data = await res.json().catch(() => null);
  if (res.ok && data?.success && data?.data?.fileUrl) return data.data.fileUrl;
  throw new Error("Falha ao enviar a imagem do banner.");
}

// Cadastro dos banners promocionais que rodam no carrossel do topo do
// Catálogo (ver BannerCarousel.tsx). Sem imagem não existe banner — por
// isso o upload é obrigatório antes de conseguir salvar.
export function BannersManager({ tgId }: { tgId: string }) {
  const [banners, setBanners] = useState<BannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [destinoTipo, setDestinoTipo] = useState<DestinoTipo>("musica");
  const [destinoItens, setDestinoItens] = useState<DestinoItem[]>([]);
  const [destinoLoading, setDestinoLoading] = useState(false);
  const [destinoBusca, setDestinoBusca] = useState("");
  const [destinoSelecionado, setDestinoSelecionado] = useState<DestinoItem | null>(null);
  const [linkManual, setLinkManual] = useState("");
  const [legenda, setLegenda] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const carregar = () => {
    setLoading(true);
    fetch("/api/social/banners")
      .then((res) => res.json())
      .then((data) => setBanners(Array.isArray(data) ? data : []))
      .catch(() => setBanners([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    carregar();
  }, []);

  useEffect(() => {
    setDestinoSelecionado(null);
    setDestinoBusca("");
    if (destinoTipo === "tv" || destinoTipo === "manual") {
      setDestinoItens([]);
      return;
    }
    setDestinoLoading(true);
    buscarDestinos(destinoTipo)
      .then(setDestinoItens)
      .catch(() => setDestinoItens([]))
      .finally(() => setDestinoLoading(false));
  }, [destinoTipo]);

  const destinoFiltrado = destinoItens.filter((d) =>
    d.titulo.toLowerCase().includes(destinoBusca.trim().toLowerCase()),
  );

  const handleSalvar = async () => {
    if (!imageFile) {
      setErrorMsg("Escolha uma imagem para o banner.");
      return;
    }
    const link_destino =
      destinoTipo === "tv"
        ? montarLink("tv", "")
        : destinoTipo === "manual"
          ? linkManual.trim()
          : destinoSelecionado
            ? montarLink(destinoTipo, destinoSelecionado.id)
            : "";

    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const imagem_url = await uploadBannerImage(imageFile);
      const res = await fetch("/api/social/banners", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          imagem_url,
          link_destino: link_destino || undefined,
          legenda: legenda.trim() || undefined,
          ordem: banners.length,
          tgId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Erro ao salvar banner.");

      setSuccessMsg("Banner publicado!");
      setImageFile(null);
      setImagePreview(null);
      setDestinoSelecionado(null);
      setDestinoBusca("");
      setLinkManual("");
      setLegenda("");
      carregar();
    } catch (err: any) {
      setErrorMsg(err.message || "Erro inesperado ao salvar o banner.");
    } finally {
      setSaving(false);
    }
  };

  const handleApagar = async (id: string) => {
    await fetch("/api/social/banners/deletar", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ id }),
    });
    setBanners((prev) => prev.filter((b) => b.id !== id));
  };

  return (
    <div className="space-y-6 text-white max-w-5xl mx-auto">
      {successMsg && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-bold">
          {errorMsg}
        </div>
      )}

      <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6 sm:p-8 space-y-6 backdrop-blur-2xl shadow-2xl shadow-black/40">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
            <ImageIcon className="size-4 text-emerald-400" />
            Imagem do banner
          </label>
          <label className="block border-2 border-dashed border-white/15 rounded-2xl p-5 text-center cursor-pointer hover:border-white/25 transition">
            {imagePreview ? (
              <img src={imagePreview} alt="" className="w-full aspect-[16/6] object-cover rounded-xl" />
            ) : (
              <>
                <p className="text-sm font-bold text-neutral-300">Toque para enviar a imagem</p>
                <p className="text-[11px] text-neutral-500 mt-1">Recomendado 1200×450px (proporção 16:6)</p>
              </>
            )}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setImageFile(file);
                setImagePreview(URL.createObjectURL(file));
              }}
            />
          </label>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
            <Link2 className="size-4 text-emerald-400" />
            Ao clicar, leva para...
          </label>

          <div className="grid grid-cols-3 gap-1.5 bg-black/25 p-1.5 rounded-xl border border-white/10">
            {DESTINO_TIPOS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setDestinoTipo(t.value)}
                className={`py-2 px-2 rounded-lg text-[10.5px] font-bold uppercase tracking-wide transition ${
                  destinoTipo === t.value
                    ? "bg-emerald-500 text-black"
                    : "text-neutral-400 hover:text-white hover:bg-white/5"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {destinoTipo === "tv" && (
            <p className="text-[11px] text-neutral-500 px-1">Leva direto pro menu da Empire TV.</p>
          )}

          {destinoTipo === "manual" && (
            <input
              type="text"
              value={linkManual}
              onChange={(e) => setLinkManual(e.target.value)}
              placeholder="/empire-play/... ou https://..."
              className="w-full bg-black/25 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none backdrop-blur-sm"
            />
          )}

          {(destinoTipo === "musica" || destinoTipo === "video" || destinoTipo === "album" || destinoTipo === "artista") && (
            <div className="space-y-2">
              {destinoSelecionado ? (
                <div className="flex items-center justify-between gap-2 bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">{destinoSelecionado.titulo}</p>
                    {destinoSelecionado.subtitulo && (
                      <p className="text-[10px] text-neutral-400 truncate">{destinoSelecionado.subtitulo}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDestinoSelecionado(null)}
                    className="shrink-0 text-[10px] font-bold text-neutral-400 hover:text-white uppercase"
                  >
                    Trocar
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-neutral-500" />
                    <input
                      type="text"
                      value={destinoBusca}
                      onChange={(e) => setDestinoBusca(e.target.value)}
                      placeholder="Buscar pelo nome..."
                      className="w-full bg-black/25 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none backdrop-blur-sm"
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-white/10 bg-black/20 divide-y divide-white/5">
                    {destinoLoading && (
                      <p className="text-[11px] text-neutral-500 p-3">Carregando...</p>
                    )}
                    {!destinoLoading && destinoFiltrado.length === 0 && (
                      <p className="text-[11px] text-neutral-500 p-3">Nada encontrado.</p>
                    )}
                    {!destinoLoading &&
                      destinoFiltrado.slice(0, 30).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setDestinoSelecionado(item)}
                          className="w-full text-left px-3 py-2 hover:bg-white/5 transition"
                        >
                          <p className="text-xs font-bold text-white truncate">{item.titulo}</p>
                          {item.subtitulo && (
                            <p className="text-[10px] text-neutral-500 truncate">{item.subtitulo}</p>
                          )}
                        </button>
                      ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
            Legenda curta (opcional)
          </label>
          <input
            type="text"
            value={legenda}
            onChange={(e) => setLegenda(e.target.value.slice(0, 60))}
            placeholder='Ex: Single "Luz Baixa" já disponível'
            className="w-full bg-black/25 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none backdrop-blur-sm"
          />
          <p className="text-[11px] text-neutral-500">Aparece como um pill discreto abaixo da imagem, não por cima.</p>
        </div>

        <button
          onClick={handleSalvar}
          disabled={saving}
          className="w-full py-3.5 rounded-2xl bg-emerald-500 text-black font-black text-xs uppercase tracking-wider disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          Publicar Banner
        </button>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-wider text-neutral-400">
          Banners ativos ({loading ? "…" : banners.length})
        </p>
        {banners.map((b) => (
          <div
            key={b.id}
            className="flex items-center gap-3 bg-white/[0.03] border border-white/10 rounded-2xl p-3 backdrop-blur-xl"
          >
            <GripVertical className="size-4 text-neutral-600 shrink-0" />
            <img src={driveImg(b.imagem_url, 200)} alt="" className="w-20 aspect-[16/6] object-cover rounded-lg shrink-0" />
            <div className="min-w-0 flex-1">
              {b.legenda && <p className="text-xs font-bold text-white truncate">{b.legenda}</p>}
              {b.link_destino && <p className="text-[10px] text-neutral-500 truncate">{b.link_destino}</p>}
            </div>
            <button
              onClick={() => handleApagar(b.id)}
              className="size-8 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 grid place-items-center shrink-0"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        {!loading && banners.length === 0 && (
          <p className="text-xs text-neutral-500">Nenhum banner ativo ainda.</p>
        )}
      </div>
    </div>
  );
}
