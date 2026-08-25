import { useEffect, useRef, useState } from "react";
import { ShoppingBag, Info, Sparkles, X, Plus, Trash2, ArrowUp, ArrowDown, ImagePlus, Loader2 } from "lucide-react";
import DOMPurify from "dompurify";
import { driveImg } from "@/lib/api";
import { uploadToDrive } from "@/lib/driveUpload";

// Botões "Shop", "Info" e "Visual" nos tópicos de Música/Álbum — material
// extra opcional que o jogador ativa na criação (Gestao.tsx) ou depois via
// Gestão > Editar Lançamentos (EditModal.tsx). Dados vivem em Extra_Musicas/
// Extra_Albuns (planilha principal), uma linha por Código único — ver
// backend/src/controllers/extraMaterialController.ts.

export interface ShopItem {
  foto: string;
  titulo: string;
}

export type VisualBloco =
  | { tipo: "imagem"; url: string }
  | { tipo: "texto"; conteudo: string }
  | { tipo: "html"; conteudo: string };

export interface ExtraMaterialData {
  shop: ShopItem[];
  info: string;
  arte: VisualBloco[];
}

export interface ExtraMaterialEditorValue {
  shopAtivo: boolean;
  shop: ShopItem[];
  infoAtivo: boolean;
  info: string;
  visualAtivo: boolean;
  arte: VisualBloco[];
}

export function emptyExtraMaterialEditorValue(): ExtraMaterialEditorValue {
  return { shopAtivo: false, shop: [], infoAtivo: false, info: "", visualAtivo: false, arte: [] };
}

export async function fetchExtraMaterial(
  codigoUnico: string,
  tipo: "musica" | "album",
): Promise<ExtraMaterialData> {
  const res = await fetch(`/api/gestao/extra?codigoUnico=${encodeURIComponent(codigoUnico)}&tipo=${tipo}`);
  const json = await res.json().catch(() => null);
  if (json?.ok && json.data) return { shop: json.data.shop || [], info: json.data.info || "", arte: json.data.arte || [] };
  return { shop: [], info: "", arte: [] };
}

export async function saveExtraMaterial(
  codigoUnico: string,
  tipo: "musica" | "album",
  value: Partial<ExtraMaterialData>,
): Promise<boolean> {
  const res = await fetch("/api/gestao/extra", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codigoUnico, tipo, ...value }),
  });
  const json = await res.json().catch(() => null);
  return !!json?.ok;
}

// Busca o material extra do tópico atual — usado pelo Forum.tsx tanto pra
// decidir quais botões mostrar quanto pro conteúdo inline do "Visual" (ver
// abaixo), então precisa viver fora do componente dos botões.
export function useExtraMaterial(
  codigoUnico: string | null | undefined,
  tipo: "musica" | "album",
): ExtraMaterialData | null {
  const [data, setData] = useState<ExtraMaterialData | null>(null);

  useEffect(() => {
    setData(null);
    if (!codigoUnico) return;
    fetchExtraMaterial(codigoUnico, tipo).then(setData);
  }, [codigoUnico, tipo]);

  return data;
}

// Renderização dos blocos de Visual (imagem/texto/HTML) — extraída pra ser
// reaproveitada tanto no popup do Shop/Info quanto no modo inline do Visual
// no corpo do tópico (ver Forum.tsx).
export function VisualBlocosView({ arte }: { arte: VisualBloco[] }) {
  return (
    <div className="w-full">
      {arte.map((bloco, i) => {
        if (bloco.tipo === "imagem") {
          return (
            <img
              key={i}
              src={driveImg(bloco.url, 1600)}
              alt=""
              className="w-full h-auto block"
              loading="lazy"
            />
          );
        }
        if (bloco.tipo === "html") {
          // Sanitizado com DOMPurify antes de ir pro DOM — remove <script>,
          // atributos on*/javascript:, <iframe> etc., mas mantém tags
          // normais (div, img, a, b...) pra ainda dar pra fazer
          // embed/layout customizado como pedido.
          return (
            <div
              key={i}
              className="p-4 sm:p-6"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(bloco.conteudo) }}
            />
          );
        }
        return (
          <p key={i} className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap p-4 sm:p-6">
            {bloco.conteudo}
          </p>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// VIEWER — botões no tópico + modais de Shop/Info
// ─────────────────────────────────────────────────────────────────────────
//
// O botão "Visual" não abre popup — ele troca o próprio conteúdo do tópico
// (ver Forum.tsx), mantendo sempre visíveis a capa e o título/artista. Por
// isso ele é controlado de fora (visualAtivo/onToggleVisual) em vez de ter
// um estado "aberto" próprio como Shop/Info.

export function ExtraMaterialButtons({
  data,
  titulo,
  artista,
  visualAtivo,
  onToggleVisual,
}: {
  data: ExtraMaterialData | null;
  // Mostrados fixos no topo da tela do Shop/Info — sem isso, ao abrir um
  // desses botões a pessoa perdia de vista em qual música/álbum estava, já
  // que a tela cobre 100% da tela do tópico.
  titulo?: string;
  artista?: string;
  visualAtivo?: boolean;
  onToggleVisual?: () => void;
}) {
  const [aberto, setAberto] = useState<"shop" | "info" | null>(null);

  if (!data) return null;

  const temShop = data.shop.length > 0;
  const temInfo = !!data.info.trim();
  const temVisual = data.arte.length > 0;
  if (!temShop && !temInfo && !temVisual) return null;

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {temShop && (
          <button
            onClick={() => setAberto("shop")}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-neutral-950/80 border border-white/10 text-neutral-300 hover:text-emerald-400 hover:border-emerald-500/30 transition-colors"
          >
            <ShoppingBag className="size-3.5" /> Shop
          </button>
        )}
        {temInfo && (
          <button
            onClick={() => setAberto("info")}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-neutral-950/80 border border-white/10 text-neutral-300 hover:text-emerald-400 hover:border-emerald-500/30 transition-colors"
          >
            <Info className="size-3.5" /> Info
          </button>
        )}
        {temVisual && (
          <button
            onClick={onToggleVisual}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border transition-colors ${
              visualAtivo
                ? "bg-emerald-500 text-black border-emerald-500"
                : "bg-neutral-950/80 border-white/10 text-neutral-300 hover:text-emerald-400 hover:border-emerald-500/30"
            }`}
          >
            <Sparkles className="size-3.5" /> {visualAtivo ? "Voltar ao normal" : "Visual"}
          </button>
        )}
      </div>

      {aberto && (
        // Cartão tipo popup/bottom-sheet (mesmo padrão dos outros modais do
        // app) em vez de cobrir 100% da tela — no celular, um `inset-0` liso
        // parecia ter trocado de tela inteira; assim fica um popup em cima
        // do tópico tanto no desktop quanto no celular.
        <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/80 backdrop-blur-sm">
          <div className="bg-neutral-950 border-t sm:border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] w-full sm:max-w-2xl max-h-[92dvh] sm:max-h-[85dvh] flex flex-col shadow-2xl">
          <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-white/10 shrink-0">
            <div className="min-w-0">
              {/* Título/artista fixos — sem isso, a tela cheia do Shop/Info
                  não deixava claro de qual música/álbum era. */}
              {titulo && (
                <p className="text-sm font-black text-white truncate leading-tight">
                  {titulo}
                  {artista ? <span className="text-neutral-400 font-bold"> · {artista}</span> : null}
                </p>
              )}
              <h2 className="text-[11px] font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5 mt-0.5">
                {aberto === "shop" && (
                  <>
                    <ShoppingBag className="size-3.5" /> Shop
                  </>
                )}
                {aberto === "info" && (
                  <>
                    <Info className="size-3.5" /> Info
                  </>
                )}
              </h2>
            </div>
            <button
              onClick={() => setAberto(null)}
              className="size-9 shrink-0 rounded-full bg-white/5 border border-white/10 grid place-items-center active:scale-90 transition-transform"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {aberto === "shop" && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 sm:p-6 max-w-3xl mx-auto">
                {data.shop.map((item, i) => (
                  <div key={i} className="bg-neutral-800/40 border border-white/10 rounded-2xl overflow-hidden">
                    <div className="aspect-square bg-neutral-900">
                      {item.foto && (
                        <img src={driveImg(item.foto, 600)} alt={item.titulo} className="w-full h-full object-cover" loading="lazy" />
                      )}
                    </div>
                    <div className="p-3 space-y-2">
                      <h3 className="text-xs font-black uppercase leading-tight">{item.titulo}</h3>
                      <button
                        onClick={(e) => e.preventDefault()}
                        className="w-full py-2 rounded-full bg-emerald-500 text-black text-[10px] font-black uppercase tracking-wider active:scale-95 transition-transform"
                      >
                        Comprar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {aberto === "info" && (
              <div className="max-w-2xl mx-auto p-4 sm:p-6">
                <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap">{data.info}</p>
              </div>
            )}
          </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// EDITOR — toggles + formulário, usado na criação (Gestao.tsx) e no
// retrofit (EditModal.tsx). Componente 100% controlado: quem usa decide
// quando persistir (na criação, só depois que o Código único existe).
// ─────────────────────────────────────────────────────────────────────────

function Toggle({ ativo, onToggle, label }: { ativo: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-2.5 w-full py-1"
    >
      <span
        className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${ativo ? "bg-emerald-500" : "bg-white/10"}`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white transition-transform ${ativo ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </span>
      <span className="text-xs font-black uppercase tracking-wider">{label}</span>
    </button>
  );
}

function ImageUploadSlot({
  url,
  onUpload,
  folderType,
  className,
}: {
  url: string;
  onUpload: (url: string) => void;
  folderType: "materiaisMusica" | "materiaisAlbum";
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);

  async function handleFile(file: File) {
    setEnviando(true);
    try {
      const uploadedUrl = await uploadToDrive(file, folderType);
      onUpload(uploadedUrl);
    } catch {
      // silencioso — o slot só fica sem imagem, dá pra tentar de novo
    } finally {
      setEnviando(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      className={`relative bg-neutral-900 border border-white/10 rounded-xl overflow-hidden grid place-items-center ${className || "aspect-square"}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      {enviando ? (
        <Loader2 className="size-5 animate-spin text-emerald-400" />
      ) : url ? (
        <img src={driveImg(url, 400)} alt="" className="w-full h-full object-cover" />
      ) : (
        <ImagePlus className="size-6 text-neutral-500" />
      )}
    </button>
  );
}

export function ExtraMaterialEditor({
  value,
  onChange,
  folderType,
}: {
  value: ExtraMaterialEditorValue;
  onChange: (value: ExtraMaterialEditorValue) => void;
  folderType: "materiaisMusica" | "materiaisAlbum";
}) {
  const set = (patch: Partial<ExtraMaterialEditorValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div className="bg-neutral-800/40 border border-white/10 rounded-2xl p-4 space-y-3">
        <Toggle ativo={value.shopAtivo} onToggle={() => set({ shopAtivo: !value.shopAtivo })} label="Shop" />
        {value.shopAtivo && (
          <div className="space-y-3 pt-1">
            <p className="text-[11px] text-neutral-400">
              Produtos exibidos como uma lojinha do material — foto, título e um botão "Comprar" ilustrativo (não leva a lugar nenhum).
            </p>
            {value.shop.map((item, i) => (
              <div key={i} className="flex gap-3 items-start bg-neutral-900/60 rounded-xl p-2.5">
                <ImageUploadSlot
                  url={item.foto}
                  folderType={folderType}
                  className="size-16 shrink-0"
                  onUpload={(url) => {
                    const shop = [...value.shop];
                    shop[i] = { ...shop[i], foto: url };
                    set({ shop });
                  }}
                />
                <input
                  value={item.titulo}
                  onChange={(e) => {
                    const shop = [...value.shop];
                    shop[i] = { ...shop[i], titulo: e.target.value };
                    set({ shop });
                  }}
                  placeholder="Título do produto"
                  className="flex-1 bg-transparent border-b border-white/10 text-sm py-2 focus:outline-none focus:border-emerald-500/50"
                />
                <button
                  type="button"
                  onClick={() => set({ shop: value.shop.filter((_, idx) => idx !== i) })}
                  className="p-2 text-neutral-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => set({ shop: [...value.shop, { foto: "", titulo: "" }] })}
              className="flex items-center gap-1.5 text-xs font-bold text-emerald-400"
            >
              <Plus className="size-3.5" /> Adicionar produto
            </button>
          </div>
        )}
      </div>

      <div className="bg-neutral-800/40 border border-white/10 rounded-2xl p-4 space-y-3">
        <Toggle ativo={value.infoAtivo} onToggle={() => set({ infoAtivo: !value.infoAtivo })} label="Info" />
        {value.infoAtivo && (
          <textarea
            value={value.info}
            onChange={(e) => set({ info: e.target.value })}
            placeholder="Descreva o material — informações, contexto, o que quiser detalhar..."
            className="w-full h-28 bg-neutral-900/60 border border-white/10 rounded-xl p-3 text-sm resize-none focus:outline-none focus:border-emerald-500/50"
          />
        )}
      </div>

      <div className="bg-neutral-800/40 border border-white/10 rounded-2xl p-4 space-y-3">
        <Toggle ativo={value.visualAtivo} onToggle={() => set({ visualAtivo: !value.visualAtivo })} label="Visual" />
        {value.visualAtivo && (
          <div className="space-y-3 pt-1">
            <p className="text-[11px] text-neutral-400">
              Monte uma página livre pro material — encartes, arte, o que quiser — empilhando blocos de imagem, texto ou HTML na ordem que quiser. Imagens em até 1600px de largura pra manter qualidade alta sem pesar. O bloco de HTML é renderizado como veio, sem edição visual — use pra embeds ou layout customizado.
            </p>
            {value.arte.map((bloco, i) => (
              <div key={i} className="bg-neutral-900/60 rounded-xl p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase text-neutral-500">
                    Bloco {i + 1} · {bloco.tipo === "imagem" ? "Imagem" : bloco.tipo === "html" ? "HTML" : "Texto"}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => {
                        const arte = [...value.arte];
                        [arte[i - 1], arte[i]] = [arte[i], arte[i - 1]];
                        set({ arte });
                      }}
                      className="p-1.5 text-neutral-500 hover:text-white disabled:opacity-20 transition-colors"
                    >
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={i === value.arte.length - 1}
                      onClick={() => {
                        const arte = [...value.arte];
                        [arte[i], arte[i + 1]] = [arte[i + 1], arte[i]];
                        set({ arte });
                      }}
                      className="p-1.5 text-neutral-500 hover:text-white disabled:opacity-20 transition-colors"
                    >
                      <ArrowDown className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => set({ arte: value.arte.filter((_, idx) => idx !== i) })}
                      className="p-1.5 text-neutral-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
                {bloco.tipo === "imagem" ? (
                  <ImageUploadSlot
                    url={bloco.url}
                    folderType={folderType}
                    className="w-full aspect-video"
                    onUpload={(url) => {
                      const arte = [...value.arte];
                      arte[i] = { tipo: "imagem", url };
                      set({ arte });
                    }}
                  />
                ) : bloco.tipo === "html" ? (
                  <textarea
                    value={bloco.conteudo}
                    onChange={(e) => {
                      const arte = [...value.arte];
                      arte[i] = { tipo: "html", conteudo: e.target.value };
                      set({ arte });
                    }}
                    placeholder="<div>Cole ou escreva seu HTML aqui...</div>"
                    spellCheck={false}
                    className="w-full h-32 bg-neutral-950/60 border border-white/10 rounded-lg p-2.5 text-xs font-mono resize-none focus:outline-none focus:border-emerald-500/50"
                  />
                ) : (
                  <textarea
                    value={bloco.conteudo}
                    onChange={(e) => {
                      const arte = [...value.arte];
                      arte[i] = { tipo: "texto", conteudo: e.target.value };
                      set({ arte });
                    }}
                    placeholder="Texto desse bloco..."
                    className="w-full h-20 bg-neutral-950/60 border border-white/10 rounded-lg p-2.5 text-sm resize-none focus:outline-none focus:border-emerald-500/50"
                  />
                )}
              </div>
            ))}
            <div className="flex gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => set({ arte: [...value.arte, { tipo: "imagem", url: "" }] })}
                className="flex items-center gap-1.5 text-xs font-bold text-emerald-400"
              >
                <Plus className="size-3.5" /> Bloco de imagem
              </button>
              <button
                type="button"
                onClick={() => set({ arte: [...value.arte, { tipo: "texto", conteudo: "" }] })}
                className="flex items-center gap-1.5 text-xs font-bold text-emerald-400"
              >
                <Plus className="size-3.5" /> Bloco de texto
              </button>
              <button
                type="button"
                onClick={() => set({ arte: [...value.arte, { tipo: "html", conteudo: "" }] })}
                className="flex items-center gap-1.5 text-xs font-bold text-emerald-400"
              >
                <Plus className="size-3.5" /> Bloco de HTML
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
