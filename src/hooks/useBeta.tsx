import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { opcoesConsulta } from "@/lib/consultas";
import { acaoUsoVoltar, type MotivoVolta, type Versao } from "@/lib/beta/regras";
import {
  ESTADO_SEGURO,
  dadosTecnicos,
  estadoFinal,
  estadoValido,
  guardarEstado,
  estadoInicial,
  lerEstadoGuardado,
  type EstadoBeta,
} from "@/lib/beta/cliente";
import { instalarErrosRecentes } from "@/lib/beta/errosRecentes";
import { definirVersaoUso, usoGlobal } from "@/lib/uso/envio";
import { telaDaRota } from "@/lib/uso/coletor";

type Reporte = { texto: string; printUrl?: string; incluirTecnico: boolean };

export type BetaContexto = {
  estado: EstadoBeta;
  carregado: boolean;
  trocarVersao(v: Versao, extra?: { motivo?: MotivoVolta; texto?: string }): Promise<boolean>;
  reportar(r: Reporte): Promise<{ ok: true } | { ok: false; erro: string }>;
};

const CHAVE_CONSULTA = ["beta", "estado"] as const;

// Fora do provider: estado seguro e funções que não fazem nada.
const FORA: BetaContexto = {
  estado: ESTADO_SEGURO,
  carregado: false,
  trocarVersao: async () => false,
  reportar: async () => ({ ok: false, erro: "Indisponível agora." }),
};

const Ctx = createContext<BetaContexto>(FORA);

/** Tela e rota atuais (rota sem query string). */
function telaERota(): { tela: string; rota: string } {
  if (typeof window === "undefined") return { tela: "/", rota: "/" };
  const rota = window.location.pathname;
  const search: Record<string, unknown> = {};
  new URLSearchParams(window.location.search).forEach((v, k) => (search[k] = v));
  return { tela: telaDaRota(rota, search), rota };
}

export function BetaProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // Primeiro desenho já com o estado guardado (app é ssr:false, leitura síncrona).
  const [guardado] = useState<EstadoBeta>(() => {
    const e = estadoInicial();
    definirVersaoUso(e.versao);
    return e;
  });
  const lido = true;

  useEffect(() => {
    instalarErrosRecentes();
  }, []);

  const consulta = useQuery({
    queryKey: CHAVE_CONSULTA,
    queryFn: async () => {
      const e = estadoValido(await api.betaEstado());
      if (!e) throw new Error("Estado do Beta inválido.");
      return e;
    },
    enabled: lido,
    retry: 1,
    ...opcoesConsulta("catalogo"), // muda raramente: 5 min, sem refazer ao voltar para a aba
  });

  const doServidor = consulta.data ?? null;
  useEffect(() => {
    if (!doServidor) return;
    guardarEstado(doServidor);
    definirVersaoUso(doServidor.versao);
  }, [doServidor]);

  const estado = estadoFinal(doServidor, guardado);
  const carregado = lido && !consulta.isPending;

  const trocarVersao = useCallback<BetaContexto["trocarVersao"]>(
    async (v, extra) => {
      const { tela, rota } = telaERota();
      try {
        await api.betaEscolher({ versao: v, motivo: extra?.motivo, texto: extra?.texto, tela, rota });
      } catch {
        return false;
      }
      // Sem recarregar a página: o player continua tocando.
      const atual = qc.getQueryData<EstadoBeta>(CHAVE_CONSULTA) ?? lerEstadoGuardado() ?? ESTADO_SEGURO;
      const novo: EstadoBeta = { ...atual, versao: v };
      qc.setQueryData(CHAVE_CONSULTA, novo);
      guardarEstado(novo);
      definirVersaoUso(v);
      if (v === "anterior") usoGlobal()?.acao(acaoUsoVoltar(extra?.motivo));
      return true;
    },
    [qc],
  );

  const reportar = useCallback<BetaContexto["reportar"]>(
    async (r) => {
      const { tela, rota } = telaERota();
      try {
        await api.betaReportar({
          texto: r.texto,
          tela,
          rota,
          versao: estado.versao,
          printUrl: r.printUrl,
          tecnico: r.incluirTecnico ? dadosTecnicos({ versao: estado.versao, rota }) : undefined,
        });
        return { ok: true as const };
      } catch (err) {
        return { ok: false as const, erro: err instanceof Error ? err.message : "Não deu para enviar." };
      }
    },
    [estado.versao],
  );

  const valor = useMemo<BetaContexto>(
    () => ({ estado, carregado, trocarVersao, reportar }),
    [estado, carregado, trocarVersao, reportar],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useBeta(): BetaContexto {
  return useContext(Ctx);
}
