import { useEffect, useState } from "react";
import { Loader2, ChevronDown, ChevronUp, Check, X } from "lucide-react";
import { notify } from "@/lib/notify";

interface LinhaData {
  linha: number;
  artista: string;
  valores: Record<string, any>;
}

interface GridData {
  colunas?: string[];
  editaveis?: string[];
  linhas?: LinhaData[];
  erro?: string;
}

interface PlanilhaGridProps {
  tgId: string;
  loader: (tgId: string) => Promise<GridData>;
  saver: (p: { tgId: string; linha: number; coluna: string; valor: any }) => Promise<any>;
  opcoesColunas?: Record<string, string[]>;
}

export function PlanilhaGrid({ tgId, loader, saver, opcoesColunas = {} }: PlanilhaGridProps) {
  const [data, setData] = useState<GridData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<number | null>(null);
  const [editando, setEditando] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!tgId) return;
    setLoading(true);
    loader(tgId)
      .then((r) => {
        if (r?.erro) setErro(r.erro);
        else setData(r);
      })
      .catch((e) => setErro("Erro: " + String(e.message || e)))
      .finally(() => setLoading(false));
  }, [tgId]);

  if (loading)
    return (
      <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground">
        <Loader2 className="animate-spin w-5 h-5" />
        <span className="text-sm">Carregando...</span>
      </div>
    );

  if (erro)
    return (
      <div className="p-4 text-center text-red-400 text-sm rounded-2xl bg-red-900/20 border border-red-500/20">
        {erro}
      </div>
    );

  if (!data?.linhas || data.linhas.length === 0)
    return (
      <div className="p-4 text-center text-muted-foreground text-sm rounded-2xl bg-white/5 border border-white/10">
        Nenhuma linha encontrada para o seu usuário.
      </div>
    );

  const editaveis = new Set<string>(data.editaveis || []);
  const colunasInfo = ["ACT", "MÚSICA", "WEEKS", "PONTOS DISPONÍVEIS", "PONTOS UTILIZADOS"];

  async function salvar(linha: number, coluna: string, valor: any, original: any) {
    if (String(valor) === String(original ?? "")) return;
    const cellKey = `${linha}-${coluna}`;
    setSaving(cellKey);
    const r = await saver({ tgId, linha, coluna, valor });
    setSaving(null);
    if (r?.erro || r?.ok === false) {
      notify(r);
      setLoading(true);
      const fresh = await loader(tgId);
      setData(fresh);
      setLoading(false);
    } else {
      // Atualiza localmente sem reload
      setData((prev) => {
        if (!prev?.linhas) return prev;
        return {
          ...prev,
          linhas: prev.linhas.map((l) =>
            l.linha === linha ? { ...l, valores: { ...l.valores, [coluna]: valor } } : l,
          ),
        };
      });
    }
    setEditando((prev) => {
      const n = { ...prev };
      delete n[cellKey];
      return n;
    });
  }

  // Agrupa por artista
  const porArtista = data.linhas.reduce(
    (acc, row) => {
      if (!acc[row.artista]) acc[row.artista] = [];
      acc[row.artista].push(row);
      return acc;
    },
    {} as Record<string, LinhaData[]>,
  );

  return (
    <div className="flex flex-col gap-6 pb-6">
      {Object.entries(porArtista).map(([artista, linhas]) => (
        <div key={artista}>
          <h3 className="text-xs font-bold uppercase tracking-widest text-primary mb-2 px-1">{artista}</h3>
          <div className="flex flex-col gap-2">
            {linhas.map((row) => {
              const musica = String(row.valores["MÚSICA"] || row.valores["MUSIC"] || "").replace(`${artista} - `, "");
              const weeks = row.valores["WEEKS"] ?? "";
              const pontosDisp = row.valores["PONTOS DISPONÍVEIS"] ?? "";
              const isOpen = expandido === row.linha;

              return (
                <div key={row.linha} className="rounded-2xl bg-card border border-white/5 overflow-hidden">
                  {/* Header do card */}
                  <button
                    className="w-full flex items-center justify-between p-4 text-left"
                    onClick={() => setExpandido(isOpen ? null : row.linha)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate pr-2">{musica || `Linha ${row.linha}`}</p>
                      <div className="flex items-center gap-3 mt-1">
                        {weeks !== "" && <span className="text-xs text-muted-foreground">{weeks}w</span>}
                        {pontosDisp !== "" && pontosDisp !== 0 && (
                          <span className="text-xs bg-primary/15 text-primary px-2 py-0.5 rounded-full">
                            {pontosDisp} pts
                          </span>
                        )}
                      </div>
                    </div>
                    {isOpen ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                  </button>

                  {/* Campos editáveis expandidos */}
                  {isOpen && (
                    <div className="border-t border-white/5 divide-y divide-white/5">
                      {Array.from(editaveis).map((coluna) => {
                        const cellKey = `${row.linha}-${coluna}`;
                        const valorAtual =
                          editando[cellKey] !== undefined ? editando[cellKey] : (row.valores[coluna] ?? "");
                        const isSaving = saving === cellKey;
                        const opcoes = opcoesColunas[coluna];

                        return (
                          <div key={coluna} className="flex items-center gap-3 px-4 py-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-muted-foreground mb-1">{coluna}</p>
                              {opcoes ? (
                                <select
                                  className="w-full rounded-lg px-2 py-1.5 text-sm outline-none
                                  bg-zinc-800 text-white border border-white/10
                                  focus:border-primary transition-colors
                                  [&>option]:bg-zinc-800 [&>option]:text-white"
                                  value={valorAtual}
                                  disabled={isSaving}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setEditando((prev) => ({ ...prev, [cellKey]: val }));
                                    salvar(row.linha, coluna, val, row.valores[coluna]);
                                  }}
                                >
                                  <option value="">— selecionar —</option>
                                  {opcoes.map((o) => (
                                    <option key={o} value={o}>
                                      {o}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type="number"
                                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-primary transition-colors"
                                  value={valorAtual}
                                  disabled={isSaving}
                                  onChange={(e) => setEditando((prev) => ({ ...prev, [cellKey]: e.target.value }))}
                                  onBlur={(e) => salvar(row.linha, coluna, e.target.value, row.valores[coluna])}
                                />
                              )}
                            </div>
                            <div className="w-5 shrink-0 flex items-center justify-center mt-4">
                              {isSaving && <Loader2 className="animate-spin w-4 h-4 text-primary" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
