import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Download, Loader2, Plus } from "lucide-react";
import { api, type EnqueteTV } from "@/lib/api";
import { getStoredLogin } from "@/components/LoginScreen";

function hora(ms: number | null): string {
  if (ms == null) return "";
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function dataHora(ms: number | null): string {
  if (ms == null) return "";
  return new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Texto do vencedor de uma enquete encerrada: a opção, "empate" ou "sem votos". */
export function textoVencedor(e: EnqueteTV): string {
  if (e.vencedores.length === 1) return e.opcoes[e.vencedores[0]] ?? "";
  if (e.vencedores.length > 1) return "empate";
  return "sem votos";
}

/**
 * Cartão de uma enquete: votar (círculo = escolha única, toca e vota;
 * quadrado = múltipla, marca e toca em Votar), barras com % depois de votar
 * (ou "resultado no fim"), 🏆 nas encerradas e "Encerrar" para admin.
 * Usado na aba Enquetes e, embutido, na faixa do topo do chat.
 */
export function EnqueteCartao({
  enquete: e,
  programaId,
  isAdmin,
  onMudou,
  embutido = false,
  realce = false,
}: {
  enquete: EnqueteTV;
  programaId: string;
  isAdmin: boolean;
  onMudou: () => Promise<void>;
  embutido?: boolean;
  realce?: boolean;
}) {
  const [sel, setSel] = useState<number[]>([]);
  const [mudando, setMudando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [encerrando, setEncerrando] = useState(false);

  const votou = !!e.meuVoto && e.meuVoto.length > 0;
  const podeVotar = e.aberta && (!votou || mudando);
  const multipla = e.tipo === "multipla";

  useEffect(() => {
    if (!e.aberta) {
      setMudando(false);
      setConfirmando(false);
    }
  }, [e.aberta]);

  const enviar = async (opcoes: number[]) => {
    if (enviando) return;
    if (!getStoredLogin()) {
      toast.error("Entre na sua conta para votar");
      return;
    }
    setEnviando(true);
    try {
      const r = await api.votarEnqueteTV(programaId, e.id, opcoes);
      if (r.ok) {
        toast.success(e.secreto ? "Voto registrado · voto secreto" : "Voto registrado");
        setMudando(false);
        setSel([]);
        await onMudou();
      } else if (r.status === 401) {
        toast.error("Entre na sua conta para votar");
      } else if (r.status === 409) {
        toast.error("Enquete encerrada");
        await onMudou();
      } else {
        toast.error(r.erro || "Não deu pra votar. Tente de novo.");
      }
    } finally {
      setEnviando(false);
    }
  };

  const tocarOpcao = (i: number) => {
    if (!podeVotar || enviando) return;
    if (!multipla) {
      void enviar([i]);
      return;
    }
    setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i].sort((a, b) => a - b)));
  };

  const encerrar = async () => {
    if (encerrando) return;
    setEncerrando(true);
    try {
      const r = await api.encerrarEnqueteTV(programaId, e.id);
      if (r.ok) {
        toast.success("Enquete encerrada · resultado publicado no chat");
        setConfirmando(false);
        await onMudou();
      } else {
        toast.error(r.erro || "Não deu pra encerrar. Tente de novo.");
      }
    } finally {
      setEncerrando(false);
    }
  };

  const mostraBarras = !podeVotar && !!e.contagem && !!e.pct;
  const meu = e.meuVoto ?? [];

  let corpo: ReactNode;
  if (podeVotar) {
    corpo = (
      <>
        {e.opcoes.map((op, i) => {
          const marcada = multipla && sel.includes(i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => tocarOpcao(i)}
              disabled={enviando}
              aria-pressed={multipla ? marcada : undefined}
              className={`w-full min-w-0 flex items-center gap-2.5 px-2.5 py-2 mt-1.5 rounded-xl text-left text-[13px] font-semibold transition active:scale-[0.99] disabled:opacity-60 ${
                marcada ? "bg-primary/15 ring-1 ring-primary/50" : "bg-muted/60 hover:bg-muted"
              }`}
            >
              <span
                className={`size-5 shrink-0 grid place-items-center border-2 text-[11px] font-black ${
                  multipla ? "rounded-md" : "rounded-full"
                } ${marcada ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/60"}`}
                aria-hidden="true"
              >
                {marcada ? "✓" : ""}
              </span>
              <span className="flex-1 min-w-0 break-words">{op}</span>
            </button>
          );
        })}
        {multipla && (
          <button
            type="button"
            onClick={() => void enviar(sel)}
            disabled={enviando || sel.length === 0}
            className="w-full min-w-0 h-9 mt-2 px-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-40 active:scale-[0.99] transition"
          >
            {enviando && <Loader2 className="size-4 shrink-0 animate-spin" />}
            <span className="truncate">
              {sel.length > 1 ? `Votar (${sel.length} opções)` : "Votar"}
            </span>
          </button>
        )}
        {mudando && (
          <button
            type="button"
            onClick={() => { setMudando(false); setSel([]); }}
            className="mt-1.5 px-2 py-1 max-w-full min-w-0 rounded-md text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"
          >
            <span className="block truncate">Cancelar</span>
          </button>
        )}
      </>
    );
  } else if (mostraBarras) {
    corpo = e.opcoes.map((op, i) => {
      const pct = e.pct![i] ?? 0;
      const venceu = !e.aberta && e.vencedores.includes(i);
      return (
        <div
          key={i}
          className="relative flex items-center gap-2 px-2.5 py-1.5 mt-1.5 rounded-lg bg-muted/60 overflow-hidden text-[13px] min-w-0"
        >
          <span
            className={`absolute inset-y-0 left-0 ${venceu ? "bg-amber-400/30" : "bg-primary/30"} transition-[width] duration-500`}
            style={{ width: `${pct}%` }}
            aria-hidden="true"
          />
          <span className="relative flex-1 min-w-0 break-words font-semibold">
            {meu.includes(i) ? "✓ " : ""}
            {op}
            {venceu ? " 🏆" : ""}
          </span>
          <span className="relative shrink-0 text-[11px] text-muted-foreground">{e.contagem![i] ?? 0}</span>
          <b className="relative shrink-0 w-9 text-right">{pct}%</b>
        </div>
      );
    });
  } else {
    // Votou numa enquete com "resultado só no fim": mostra o próprio voto.
    corpo = e.opcoes.map((op, i) => (
      <div key={i} className="flex items-center gap-2.5 px-2.5 py-1.5 mt-1.5 rounded-lg bg-muted/40 text-[13px] min-w-0">
        <span
          className={`size-5 shrink-0 grid place-items-center border-2 text-[11px] font-black ${multipla ? "rounded-md" : "rounded-full"} ${
            meu.includes(i) ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
          }`}
          aria-hidden="true"
        >
          {meu.includes(i) ? "✓" : ""}
        </span>
        <span className="flex-1 min-w-0 break-words font-semibold">{op}</span>
      </div>
    ));
  }

  const rodape: string[] = [`${e.total} ${e.total === 1 ? "voto" : "votos"}`];
  if (e.aberta && votou && e.soFim) rodape.push("resultado no fim");
  else if (e.aberta && e.soFim && !votou) rodape.push("resultado só no fim");
  if (e.aberta && e.encerraEm != null) rodape.push(`encerra às ${hora(e.encerraEm)}`);
  if (!e.aberta && e.encerradaEm != null) rodape.push(`encerrada às ${hora(e.encerradaEm)}`);

  return (
    <div
      id={embutido ? undefined : `tvenq-${e.id}`}
      className={
        embutido
          ? "min-w-0"
          : `min-w-0 p-3 rounded-2xl border bg-card/60 transition-shadow ${realce ? "border-primary ring-2 ring-primary/50" : "border-border"}`
      }
    >
      <div className="flex items-baseline justify-between gap-2 min-w-0">
        {!embutido && (
          <b className={`shrink-0 text-[12px] ${e.aberta ? "text-primary" : "text-amber-400"}`}>
            {e.aberta ? "📊 Enquete aberta" : "🏁 Encerrada"}
          </b>
        )}
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
          {multipla ? "Múltipla escolha" : "Escolha única"}
          {e.secreto ? " · voto secreto" : ""}
        </span>
      </div>
      <p className="mt-1 mb-1 font-extrabold text-[14.5px] leading-snug break-words">{e.pergunta}</p>
      {corpo}
      <div className="flex items-center justify-between gap-2 mt-2 min-w-0 text-[11.5px] text-muted-foreground">
        <span className="min-w-0 truncate">{rodape.join(" · ")}</span>
        <div className="flex items-center gap-1 shrink-0">
          {e.aberta && votou && !mudando && (
            <button
              type="button"
              onClick={() => { setMudando(true); setSel(multipla ? [...meu] : []); }}
              className="px-1.5 py-0.5 rounded-md font-semibold hover:text-foreground"
            >
              Mudar voto
            </button>
          )}
          {isAdmin && e.aberta && !confirmando && (
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              className="px-1.5 py-0.5 rounded-md font-extrabold text-red-500 hover:bg-red-500/10"
            >
              Encerrar
            </button>
          )}
        </div>
      </div>
      {isAdmin && e.aberta && confirmando && (
        <div className="flex items-center gap-2 mt-2 p-2 rounded-xl bg-red-500/10 border border-red-500/30 min-w-0">
          <span className="flex-1 min-w-0 text-[12px] font-semibold">Encerrar e publicar o resultado?</span>
          <button
            type="button"
            onClick={() => setConfirmando(false)}
            disabled={encerrando}
            className="shrink-0 h-8 px-3 rounded-lg text-[12px] font-semibold text-muted-foreground hover:bg-muted"
          >
            Não
          </button>
          <button
            type="button"
            onClick={() => void encerrar()}
            disabled={encerrando}
            className="shrink-0 h-8 px-3 rounded-lg bg-red-500 text-white text-[12px] font-bold flex items-center gap-1 disabled:opacity-60"
          >
            {encerrando && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
            <span>Encerrar</span>
          </button>
        </div>
      )}
    </div>
  );
}

function celulaCsv(v: string | number): string {
  let s = String(v);
  // Planilha não pode ler texto como fórmula (=, +, -, @, tab, CR no começo).
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Planilha (CSV, separador ";" para abrir direto no Excel em português) a partir da lista. */
function baixarCsv(lista: EnqueteTV[], programaId: string) {
  const linhas: (string | number)[][] = [["Pergunta", "Tipo", "Opção", "Votos", "%", "Criada", "Encerrada"]];
  for (const e of lista) {
    e.opcoes.forEach((op, i) => {
      linhas.push([
        e.pergunta,
        e.tipo === "multipla" ? "Múltipla" : "Única",
        op,
        e.contagem ? (e.contagem[i] ?? 0) : "",
        e.pct ? (e.pct[i] ?? 0) : "",
        dataHora(e.criadaEm),
        e.aberta ? "aberta" : dataHora(e.encerradaEm),
      ]);
    });
  }
  const csv = "\uFEFF" + linhas.map((l) => l.map(celulaCsv).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `enquetes-${programaId}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Aba "📊 Enquetes" da sala: todas as enquetes (abertas primeiro), com votar e resultados. */
export function EnquetesPanel({
  programaId,
  lista,
  carregado,
  isAdmin,
  onMudou,
  onNova,
  destaqueId,
  onDestaqueConsumido,
}: {
  programaId: string;
  lista: EnqueteTV[];
  carregado: boolean;
  isAdmin: boolean;
  onMudou: () => Promise<void>;
  onNova: () => void;
  destaqueId: string | null;
  onDestaqueConsumido: () => void;
}) {
  const [realce, setRealce] = useState<string | null>(null);

  // Veio de um aviso do chat: rola até a enquete e realça por um instante.
  const achou = !!destaqueId && lista.some((e) => e.id === destaqueId);
  useEffect(() => {
    if (!destaqueId) return;
    if (!achou) {
      if (carregado) onDestaqueConsumido();
      return;
    }
    const id = destaqueId;
    onDestaqueConsumido();
    setRealce(id);
    requestAnimationFrame(() => {
      document.getElementById(`tvenq-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destaqueId, achou, carregado]);
  useEffect(() => {
    if (!realce) return;
    const t = setTimeout(() => setRealce(null), 1_800);
    return () => clearTimeout(t);
  }, [realce]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="px-3 py-3 space-y-3">
        <div className="min-w-0">
          <b className="block text-[15px]">📊 Enquetes desta sala</b>
          <p className="text-[11.5px] text-muted-foreground mt-0.5">Todas as enquetes desta transmissão, com os resultados guardados.</p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => baixarCsv(lista, programaId)}
              disabled={lista.length === 0}
              className="flex-1 min-w-0 h-9 px-3 rounded-xl border border-border bg-muted/40 text-[12.5px] font-semibold flex items-center justify-center gap-1.5 hover:bg-muted disabled:opacity-40 transition"
            >
              <Download className="size-4 shrink-0" />
              <span className="truncate">Baixar planilha (CSV)</span>
            </button>
            <button
              type="button"
              onClick={onNova}
              className="flex-1 min-w-0 h-9 px-3 rounded-xl bg-primary text-primary-foreground text-[12.5px] font-bold flex items-center justify-center gap-1.5 active:scale-[0.99] transition"
            >
              <Plus className="size-4 shrink-0" />
              <span className="truncate">Nova enquete</span>
            </button>
          </div>
        )}
        {!carregado ? (
          <div className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : lista.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">Nenhuma enquete nesta sala ainda.</p>
        ) : (
          lista.map((e) => (
            <EnqueteCartao
              key={e.id}
              enquete={e}
              programaId={programaId}
              isAdmin={isAdmin}
              onMudou={onMudou}
              realce={realce === e.id}
            />
          ))
        )}
      </div>
    </div>
  );
}
