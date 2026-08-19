import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Archive,
  BookOpen,
  MessageSquareText,
  Plus,
  X,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Trash2,
} from "lucide-react";
import { api, resolveImg } from "@/lib/api";
import { useTelegramUser, haptic } from "@/lib/telegram";

export const Route = createFileRoute("/acervo")({
  component: AcervoPage,
});

type Revista = {
  id: string;
  artista: string;
  titulo: string;
  capa?: string;
  paginas: string[];
  data: string;
  telegram_id?: string;
};

type Pergunta = { pergunta: string; resposta: string };

type Entrevista = {
  id: string;
  artista: string;
  titulo: string;
  capa?: string;
  perguntas: Pergunta[];
  data: string;
  telegram_id?: string;
};

async function uploadToDrive(file: File): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("fileName", file.name);
    formData.append("folderType", "acervo");
    const res = await fetch("/api/gestao/upload", { method: "POST", body: formData });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success && data?.data?.fileUrl) return data.data.fileUrl as string;
  } catch (err) {
    console.error("Erro no upload:", err);
  }
  return null;
}

function AcervoPage() {
  const { user } = useTelegramUser();
  const [tab, setTab] = useState<"revistas" | "entrevistas">("revistas");
  const [revistas, setRevistas] = useState<Revista[]>([]);
  const [entrevistas, setEntrevistas] = useState<Entrevista[]>([]);
  const [loading, setLoading] = useState(true);
  const [myArtists, setMyArtists] = useState<any[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedRevista, setSelectedRevista] = useState<Revista | null>(null);
  const [selectedEntrevista, setSelectedEntrevista] = useState<Entrevista | null>(null);

  const card = "rounded-[1.75rem] bg-white/5 border border-white/10 transition-all";
  const inputCls =
    "w-full bg-white/5 border border-white/10 rounded-2xl p-3.5 text-base font-medium focus:outline-none focus:border-primary/50 transition-colors placeholder:text-muted-foreground/60";

  async function loadAll() {
    setLoading(true);
    const [r, e] = await Promise.all([api.listarRevistasAcervo(), api.listarEntrevistasAcervo()]);
    setRevistas(r);
    setEntrevistas(e);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    const tgId = user?.id || "";
    if (!tgId || tgId === "guest") return;
    api.meusArtistas(tgId).then(setMyArtists).catch(() => setMyArtists([]));
  }, [user?.id]);

  return (
    <div className="flex-1 bg-background min-h-dvh pb-32">
      <div className="px-4 pt-6 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <Archive className="size-5 text-primary" />
          <h1 className="text-xl font-black uppercase tracking-tight">Acervo</h1>
        </div>
        <p className="text-xs text-muted-foreground font-medium">
          Entrevistas e edições de revista dos artistas do Empire.
        </p>
      </div>

      <div className="px-4 flex gap-2 mb-5">
        <button
          onClick={() => {
            haptic.selection();
            setTab("revistas");
          }}
          className={`flex-1 py-2.5 rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-1.5 transition-all ${
            tab === "revistas" ? "bg-primary text-primary-foreground" : "bg-white/5 text-muted-foreground border border-white/10"
          }`}
        >
          <BookOpen className="size-3.5" /> Revistas
        </button>
        <button
          onClick={() => {
            haptic.selection();
            setTab("entrevistas");
          }}
          className={`flex-1 py-2.5 rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-1.5 transition-all ${
            tab === "entrevistas" ? "bg-primary text-primary-foreground" : "bg-white/5 text-muted-foreground border border-white/10"
          }`}
        >
          <MessageSquareText className="size-3.5" /> Entrevistas
        </button>
      </div>

      <div className="px-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-20 gap-4">
            <Loader2 className="size-8 text-primary animate-spin" />
          </div>
        ) : tab === "revistas" ? (
          revistas.length === 0 ? (
            <EmptyState text="Nenhuma revista publicada ainda." />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {revistas.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    haptic.selection();
                    setSelectedRevista(r);
                  }}
                  className={`${card} overflow-hidden text-left active:scale-95`}
                >
                  <div className="aspect-[3/4] bg-secondary">
                    {r.capa && (
                      <img
                        src={resolveImg(r.capa)}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                      />
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="text-[10px] font-black uppercase text-primary truncate">{r.artista}</p>
                    <p className="text-xs font-bold leading-snug line-clamp-2">{r.titulo}</p>
                    <p className="text-[10px] text-muted-foreground font-medium mt-1">{r.paginas.length} páginas</p>
                  </div>
                </button>
              ))}
            </div>
          )
        ) : entrevistas.length === 0 ? (
          <EmptyState text="Nenhuma entrevista publicada ainda." />
        ) : (
          <div className="grid gap-3">
            {entrevistas.map((e) => (
              <button
                key={e.id}
                onClick={() => {
                  haptic.selection();
                  setSelectedEntrevista(e);
                }}
                className={`${card} p-3.5 flex items-center gap-3 text-left active:scale-95`}
              >
                <div className="size-14 shrink-0 rounded-xl overflow-hidden bg-secondary">
                  {e.capa && (
                    <img src={resolveImg(e.capa)} className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black uppercase text-primary truncate">{e.artista}</p>
                  <p className="text-sm font-bold leading-snug line-clamp-2">{e.titulo}</p>
                  <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
                    {e.perguntas.length} pergunta{e.perguntas.length === 1 ? "" : "s"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={() => {
          haptic.light();
          setIsCreateOpen(true);
        }}
        className="fixed bottom-24 right-5 size-14 rounded-full bg-primary text-primary-foreground grid place-items-center shadow-2xl active:scale-90 transition-transform z-40"
      >
        <Plus className="size-6" />
      </button>

      {selectedRevista && (
        <RevistaViewer revista={selectedRevista} onClose={() => setSelectedRevista(null)} />
      )}
      {selectedEntrevista && (
        <EntrevistaViewer entrevista={selectedEntrevista} onClose={() => setSelectedEntrevista(null)} />
      )}
      {isCreateOpen && (
        <CreateModal
          tab={tab}
          myArtists={myArtists}
          inputCls={inputCls}
          tgId={user?.id || ""}
          onClose={() => setIsCreateOpen(false)}
          onCreated={() => {
            setIsCreateOpen(false);
            loadAll();
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="w-full p-8 rounded-[1.75rem] bg-card/50 border-2 border-dashed border-primary/20 flex flex-col items-center text-center min-h-40 gap-2 mt-6">
      <Archive className="size-8 text-primary/60" />
      <p className="text-sm font-black uppercase tracking-tight">Vazio por aqui</p>
      <p className="text-[11px] font-medium text-muted-foreground leading-snug max-w-[16rem]">{text}</p>
    </div>
  );
}

function RevistaViewer({ revista, onClose }: { revista: Revista; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const total = revista.paginas.length;

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      <div className="flex items-center justify-between p-4 shrink-0">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase text-primary truncate">{revista.artista}</p>
          <p className="text-sm font-bold truncate">{revista.titulo}</p>
        </div>
        <button onClick={onClose} className="size-9 shrink-0 rounded-full bg-white/10 grid place-items-center active:scale-90">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 relative overflow-hidden">
        <img
          src={resolveImg(revista.paginas[page])}
          className="w-full h-full object-contain"
          referrerPolicy="no-referrer"
        />
        {page > 0 && (
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="absolute left-2 top-1/2 -translate-y-1/2 size-10 rounded-full bg-black/50 grid place-items-center active:scale-90"
          >
            <ChevronLeft className="size-5 text-white" />
          </button>
        )}
        {page < total - 1 && (
          <button
            onClick={() => setPage((p) => Math.min(total - 1, p + 1))}
            className="absolute right-2 top-1/2 -translate-y-1/2 size-10 rounded-full bg-black/50 grid place-items-center active:scale-90"
          >
            <ChevronRight className="size-5 text-white" />
          </button>
        )}
      </div>

      <div className="p-4 shrink-0 text-center text-xs font-bold text-white/70">
        Página {page + 1} / {total}
      </div>
    </div>
  );
}

function EntrevistaViewer({ entrevista, onClose }: { entrevista: Entrevista; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="bg-card border-t sm:border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] max-w-lg w-full max-h-[90dvh] overflow-y-auto">
        {entrevista.capa && (
          <img src={resolveImg(entrevista.capa)} className="w-full aspect-video object-cover" referrerPolicy="no-referrer" />
        )}
        <div className="p-6">
          <div className="flex justify-between items-start mb-4 gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase text-primary truncate">{entrevista.artista}</p>
              <h2 className="text-lg font-black leading-tight">{entrevista.titulo}</h2>
            </div>
            <button onClick={onClose} className="size-9 shrink-0 rounded-full bg-white/5 border border-white/10 grid place-items-center active:scale-90">
              <X className="size-4" />
            </button>
          </div>
          <div className="space-y-5">
            {entrevista.perguntas.map((p, i) => (
              <div key={i}>
                <p className="text-sm font-black text-primary mb-1">{p.pergunta}</p>
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{p.resposta}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateModal({
  tab,
  myArtists,
  inputCls,
  tgId,
  onClose,
  onCreated,
}: {
  tab: "revistas" | "entrevistas";
  myArtists: any[];
  inputCls: string;
  tgId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [artista, setArtista] = useState(myArtists[0]?.nome || "");
  const [titulo, setTitulo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Revista: páginas (a primeira também vira a capa da listagem)
  const [paginas, setPaginas] = useState<string[]>([]);
  const [uploadingPagina, setUploadingPagina] = useState(false);

  // Entrevista: capa opcional + perguntas/respostas
  const [capa, setCapa] = useState("");
  const [uploadingCapa, setUploadingCapa] = useState(false);
  const [perguntas, setPerguntas] = useState<Pergunta[]>([{ pergunta: "", resposta: "" }]);

  async function handleSubmit() {
    if (!artista || !titulo.trim() || submitting) return;
    setErrorMsg(null);

    if (tab === "revistas") {
      if (paginas.length === 0) {
        setErrorMsg("Envie pelo menos 1 página.");
        return;
      }
      setSubmitting(true);
      const res = await api.criarRevistaAcervo({ artista, titulo: titulo.trim(), paginas }, tgId);
      setSubmitting(false);
      if (res.ok) {
        haptic.success();
        onCreated();
      } else {
        setErrorMsg(res.error || "Erro ao publicar a revista.");
      }
      return;
    }

    const perguntasValidas = perguntas.filter((p) => p.pergunta.trim() && p.resposta.trim());
    if (perguntasValidas.length === 0) {
      setErrorMsg("Preencha pelo menos 1 pergunta e resposta.");
      return;
    }
    setSubmitting(true);
    const res = await api.criarEntrevistaAcervo(
      { artista, titulo: titulo.trim(), capa, perguntas: perguntasValidas },
      tgId,
    );
    setSubmitting(false);
    if (res.ok) {
      haptic.success();
      onCreated();
    } else {
      setErrorMsg(res.error || "Erro ao publicar a entrevista.");
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/70 backdrop-blur-sm">
      <div className="bg-card border-t sm:border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] p-5 sm:p-6 max-w-md w-full shadow-2xl max-h-[90dvh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-black uppercase">
            Nova {tab === "revistas" ? "revista" : "entrevista"}
          </h2>
          <button onClick={onClose} className="size-9 shrink-0 rounded-full bg-white/5 border border-white/10 grid place-items-center active:scale-90">
            <X className="size-4" />
          </button>
        </div>

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <p className="text-[10px] font-black uppercase text-muted-foreground">Artista</p>
            {myArtists.length > 0 ? (
              <select value={artista} onChange={(e) => setArtista(e.target.value)} className={inputCls}>
                {myArtists.map((a) => (
                  <option key={a.nome} value={a.nome}>
                    {a.nome}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-muted-foreground">Você precisa ter um artista pra publicar.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-[10px] font-black uppercase text-muted-foreground">Título</p>
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título da edição" className={inputCls} />
          </div>

          {tab === "revistas" ? (
            <div className="space-y-1.5">
              <p className="text-[10px] font-black uppercase text-muted-foreground">
                Páginas ({paginas.length})
              </p>
              {paginas.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {paginas.map((url, i) => (
                    <div key={i} className="relative aspect-[3/4] rounded-lg overflow-hidden bg-secondary">
                      <img src={resolveImg(url)} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      <button
                        onClick={() => setPaginas((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute top-1 right-1 size-5 rounded-full bg-black/70 grid place-items-center"
                      >
                        <X className="size-3 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <label
                className={
                  inputCls +
                  " flex items-center justify-center gap-2 cursor-pointer text-center " +
                  (uploadingPagina ? "opacity-60 pointer-events-none" : "")
                }
              >
                <ImageIcon className="size-4" />
                {uploadingPagina ? "Enviando..." : "Adicionar página"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploadingPagina(true);
                    const url = await uploadToDrive(file);
                    if (url) setPaginas((prev) => [...prev, url]);
                    setUploadingPagina(false);
                  }}
                />
              </label>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <p className="text-[10px] font-black uppercase text-muted-foreground">Capa (opcional)</p>
                {capa && (
                  <div className="w-full aspect-video rounded-xl overflow-hidden bg-secondary">
                    <img src={resolveImg(capa)} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                )}
                <label
                  className={
                    inputCls +
                    " flex items-center justify-center gap-2 cursor-pointer text-center " +
                    (uploadingCapa ? "opacity-60 pointer-events-none" : "")
                  }
                >
                  <ImageIcon className="size-4" />
                  {uploadingCapa ? "Enviando..." : capa ? "Trocar capa" : "Selecionar capa"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setUploadingCapa(true);
                      const url = await uploadToDrive(file);
                      if (url) setCapa(url);
                      setUploadingCapa(false);
                    }}
                  />
                </label>
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase text-muted-foreground">Perguntas e respostas</p>
                {perguntas.map((p, i) => (
                  <div key={i} className="space-y-2 p-3 rounded-2xl bg-white/5 border border-white/10">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black uppercase text-muted-foreground">#{i + 1}</p>
                      {perguntas.length > 1 && (
                        <button
                          onClick={() => setPerguntas((prev) => prev.filter((_, idx) => idx !== i))}
                          className="text-muted-foreground active:scale-90"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                    <input
                      value={p.pergunta}
                      onChange={(e) =>
                        setPerguntas((prev) => prev.map((x, idx) => (idx === i ? { ...x, pergunta: e.target.value } : x)))
                      }
                      placeholder="Pergunta"
                      className={inputCls}
                    />
                    <textarea
                      value={p.resposta}
                      onChange={(e) =>
                        setPerguntas((prev) => prev.map((x, idx) => (idx === i ? { ...x, resposta: e.target.value } : x)))
                      }
                      placeholder="Resposta"
                      className={inputCls + " h-20 resize-none"}
                    />
                  </div>
                ))}
                <button
                  onClick={() => setPerguntas((prev) => [...prev, { pergunta: "", resposta: "" }])}
                  className="w-full py-3 rounded-2xl border border-dashed border-white/15 text-xs font-black uppercase text-muted-foreground active:scale-95"
                >
                  + Adicionar pergunta
                </button>
              </div>
            </>
          )}

          {errorMsg && <p className="text-xs font-bold text-red-400">{errorMsg}</p>}

          <button
            onClick={handleSubmit}
            disabled={submitting || !artista || !titulo.trim()}
            className="mt-2 p-4 min-h-14 bg-primary text-primary-foreground rounded-2xl font-black uppercase tracking-wide flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-50"
          >
            {submitting ? "Publicando..." : "Publicar"}
          </button>
        </div>
      </div>
    </div>
  );
}
