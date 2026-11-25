import { useEffect, useState } from "react";
import { Database, Loader2, RefreshCw, Power, PowerOff, Send, ShieldCheck, Users, Check, X } from "lucide-react";
import { authHeaders, atualizarArtistasDaPlanilha } from "@/lib/api";

interface StatusAba {
  aba: string;
  estado: "off" | "carregando" | "on" | "pausado";
  pendentesFila: number;
  linhasD1: number;
}

const NOME_ESTADO: Record<StatusAba["estado"], string> = {
  off: "Planilha (antigo)",
  carregando: "Carregando…",
  on: "D1 (planilha = backup)",
  pausado: "Desligando…",
};

// Painel só de admin do catálogo "D1 primeiro" (docs/superpowers/specs/2026-11-18-catalogo-d1-primeiro-design.md):
// ligar cada aba (copia a planilha pro D1 conferindo célula a célula),
// desligar (só com a fila de backup vazia), mandar a fila agora e conferir
// se o backup bate com o D1.
export function PainelCatalogoD1() {
  const [abas, setAbas] = useState<StatusAba[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  // Confirmação na própria tela antes de sobrescrever o espelho de artistas.
  const [confirmandoArtistas, setConfirmandoArtistas] = useState(false);

  async function chamar(caminho: string, body?: unknown) {
    const res = await fetch(`/api/admin/d1primeiro/${caminho}`, {
      method: body === undefined && caminho === "status" ? "GET" : "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) throw new Error(data?.error || `Erro HTTP ${res.status}`);
    return data.data;
  }

  async function atualizar() {
    try {
      setAbas((await chamar("status")).abas);
    } catch (e) {
      setMensagem((e as Error).message);
    }
  }

  async function acao(id: string, fn: () => Promise<string>) {
    setOcupado(id);
    setMensagem(null);
    try {
      setMensagem(await fn());
    } catch (e) {
      setMensagem((e as Error).message);
    } finally {
      setOcupado(null);
      atualizar();
    }
  }

  useEffect(() => {
    atualizar();
  }, []);

  const ligar = (aba: string) =>
    acao(`ligar:${aba}`, async () => {
      const r = await chamar("carregar", { aba });
      if (r.ok) return `"${aba}" ligada no D1 (${r.linhas} linhas copiadas).`;
      if (r.motivo === "formula") return `"${aba}" NÃO foi ligada: tem fórmula nas células ${r.celulas.join(", ")}.`;
      if (r.motivo === "ja-ligada") return `"${aba}" já está ligada (ou em transição) — nada foi copiado.`;
      if (r.motivo === "fila-pendente") return `"${aba}" NÃO foi ligada: ainda há cópias na fila de backup. Envie a fila e tente de novo.`;
      if (r.motivo === "divergencia") return `"${aba}" NÃO foi ligada: a cópia divergiu nas linhas ${r.linhas.join(", ")}.`;
      return `"${aba}" NÃO foi ligada: ${r.erro || r.motivo}.`;
    });

  const desligar = (aba: string) =>
    acao(`desligar:${aba}`, async () => {
      const r = await chamar("desligar", { aba });
      if (r.ok) return `"${aba}" voltou para a planilha (backup conferido).`;
      if (r.motivo === "fila-pendente") return `"${aba}" continua no D1: ${r.pendentes} cópia(s) ainda não chegaram à planilha (Google no limite?). Tente mais tarde.`;
      if (r.motivo === "divergencia") return `"${aba}" continua no D1: a planilha difere do D1 nas linhas ${r.linhas.slice(0, 10).join(", ")}. Nada foi perdido.`;
      return `"${aba}" continua no D1: ${r.erro || r.motivo}.`;
    });

  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4 mb-6 space-y-3">
      <div className="flex items-center gap-2 min-w-0">
        <Database className="size-4 text-emerald-400 shrink-0" />
        <h3 className="text-sm font-black text-white truncate">Catálogo no D1 (admin)</h3>
        <button
          type="button"
          onClick={atualizar}
          className="ml-auto shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-neutral-300 min-w-0"
        >
          <RefreshCw className="size-3 shrink-0" />
          <span className="truncate">Atualizar</span>
        </button>
      </div>
      <p className="text-[11px] text-neutral-400">
        Ligar copia a aba da planilha para o D1 (leva ~40 s). Depois disso o app lê e grava só no D1, e a planilha recebe
        uma cópia a cada 10 minutos. Desligar (~40 s) envia a fila, confere a planilha e só então volta para ela.
      </p>

      <div className="space-y-2">
        {abas.map((a) => (
          <div key={a.aba} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/5 px-3 py-2 min-w-0">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-white truncate">{a.aba}</p>
              <p className="text-[11px] text-neutral-400 truncate">
                {NOME_ESTADO[a.estado]} · {a.linhasD1} linhas no D1 · {a.pendentesFila} na fila
              </p>
            </div>
            {a.estado === "on" ? (
              <button
                type="button"
                disabled={!!ocupado}
                onClick={() => desligar(a.aba)}
                className="shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 text-[11px] font-bold disabled:opacity-50 min-w-0"
              >
                {ocupado === `desligar:${a.aba}` ? <Loader2 className="size-3 animate-spin shrink-0" /> : <PowerOff className="size-3 shrink-0" />}
                <span className="truncate">Desligar</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={!!ocupado}
                onClick={() => ligar(a.aba)}
                className="shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-[11px] font-bold disabled:opacity-50 min-w-0"
              >
                {ocupado === `ligar:${a.aba}` ? <Loader2 className="size-3 animate-spin shrink-0" /> : <Power className="size-3 shrink-0" />}
                <span className="truncate">Ligar no D1</span>
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!!ocupado}
          onClick={() =>
            acao("fila", async () => {
              const res = await fetch("/api/admin/fila-backup/despachar", { method: "POST", headers: authHeaders() });
              const d = await res.json().catch(() => null);
              if (!res.ok || !d?.success) throw new Error(d?.error || `Erro HTTP ${res.status}`);
              const r = d.data;
              return r.parouPorLimite
                ? `Google no limite: ${r.gravados} cópia(s) enviadas, ${r.pendentes} esperando o próximo ciclo.`
                : `${r.gravados} cópia(s) enviadas para a planilha. ${r.pendentes} pendente(s).`;
            })
          }
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-neutral-200 font-bold disabled:opacity-50 min-w-0"
        >
          {ocupado === "fila" ? <Loader2 className="size-3 animate-spin shrink-0" /> : <Send className="size-3 shrink-0" />}
          <span className="truncate">Enviar fila agora</span>
        </button>
        <button
          type="button"
          disabled={!!ocupado}
          onClick={() =>
            acao("verificar", async () => {
              const r: { aba: string; ok: boolean; diferentes: number[] }[] = await chamar("verificar", {});
              if (!r.length) return "Nada para conferir (nenhuma aba ligada com a fila vazia).";
              return r.map((x) => (x.ok ? `${x.aba}: backup igual ao D1.` : `${x.aba}: difere nas linhas ${x.diferentes.slice(0, 10).join(", ")}.`)).join(" ");
            })
          }
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-neutral-200 font-bold disabled:opacity-50 min-w-0"
        >
          {ocupado === "verificar" ? <Loader2 className="size-3 animate-spin shrink-0" /> : <ShieldCheck className="size-3 shrink-0" />}
          <span className="truncate">Conferir backup</span>
        </button>
      </div>

      <div className="rounded-xl bg-white/5 px-3 py-2 space-y-2 min-w-0">
        <p className="text-[11px] text-neutral-400">
          Artistas: sobrescreve foto, capa, biografia, estilo e país de todos os artistas com o que está na aba ARTISTAS
          (país vazio na planilha destrava a nacionalidade).
        </p>
        {confirmandoArtistas ? (
          <div className="space-y-2">
            <p className="text-[11px] font-bold text-amber-300">
              Sobrescrever os dados de todos os artistas com a planilha? As edições dos jogadores que não estiverem na
              planilha serão perdidas.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!!ocupado}
                onClick={() => {
                  setConfirmandoArtistas(false);
                  acao("artistas", async () => {
                    const r = await atualizarArtistasDaPlanilha();
                    const n = r.filter((x) => x.campos.length > 0).length;
                    return n ? `${n} artistas atualizados` : "Nada mudou.";
                  });
                }}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[11px] font-bold disabled:opacity-50 min-w-0"
              >
                <Check className="size-3 shrink-0" />
                <span className="truncate">Confirmar</span>
              </button>
              <button
                type="button"
                onClick={() => setConfirmandoArtistas(false)}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-neutral-200 font-bold min-w-0"
              >
                <X className="size-3 shrink-0" />
                <span className="truncate">Cancelar</span>
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={!!ocupado}
            onClick={() => {
              setMensagem(null);
              setConfirmandoArtistas(true);
            }}
            className="max-w-full inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-neutral-200 font-bold disabled:opacity-50 min-w-0"
          >
            {ocupado === "artistas" ? <Loader2 className="size-3 animate-spin shrink-0" /> : <Users className="size-3 shrink-0" />}
            <span className="truncate">Atualizar todos os artistas a partir da planilha</span>
          </button>
        )}
      </div>

      {mensagem && <p className="text-[11px] text-neutral-200 bg-white/5 rounded-lg px-3 py-2">{mensagem}</p>}
    </div>
  );
}
