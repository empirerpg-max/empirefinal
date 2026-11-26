import { useCallback, useEffect, useRef, useState } from "react";
import { api, type EnqueteTV } from "@/lib/api";

export const ENQ_PREFIX = "ENQ::";
export const ENQRES_PREFIX = "ENQRES::";

const INTERVALO_MS = 5_000;

export interface EnquetesTV {
  lista: EnqueteTV[];
  carregado: boolean;
  /** Busca a lista de novo (ignora respostas que chegarem fora de ordem). */
  recarregar: () => Promise<void>;
}

/**
 * Enquetes da sala, uma busca só para a aba, a faixa do chat e os avisos.
 * Atualiza a cada 5 s só enquanto `ativo` (aba Enquetes ou faixa expandida
 * visível) e a página está visível; fora disso, quem chama pede
 * `recarregar()` (aviso ENQ::/ENQRES:: chegando, abrir a aba). Também busca
 * ao voltar a página para visível e logo depois do horário de encerramento
 * automático de uma enquete aberta (o servidor fecha na leitura).
 */
export function useEnquetesTV(programaId: string, ativo: boolean): EnquetesTV {
  const [lista, setLista] = useState<EnqueteTV[]>([]);
  const [carregado, setCarregado] = useState(false);
  const seqRef = useRef(0);
  const programaRef = useRef(programaId);
  programaRef.current = programaId;

  const recarregar = useCallback(async () => {
    const seq = ++seqRef.current;
    const pid = programaRef.current;
    const r = await api.listarEnquetesTV(pid);
    if (seq !== seqRef.current || pid !== programaRef.current) return;
    if (r) setLista(r);
    setCarregado(true);
  }, []);

  useEffect(() => {
    setLista([]);
    setCarregado(false);
    void recarregar();
    const onVis = () => {
      if (document.visibilityState === "visible") void recarregar();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [programaId, recarregar]);

  useEffect(() => {
    if (!ativo) return;
    void recarregar();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void recarregar();
    }, INTERVALO_MS);
    return () => clearInterval(t);
  }, [ativo, recarregar]);

  // Encerramento automático: busca de novo logo depois do horário, para a
  // faixa sumir e o resultado aparecer mesmo sem nada visível atualizando.
  const proximoFim = lista.reduce<number | null>(
    (min, e) => (e.aberta && e.encerraEm != null && (min == null || e.encerraEm < min) ? e.encerraEm : min),
    null,
  );
  // Se a busca vier com a enquete ainda aberta (relógio do servidor atrás
  // do aparelho), tenta de novo a cada 3 s por até 1 min depois do horário.
  const [rearme, setRearme] = useState(0);
  useEffect(() => {
    if (proximoFim == null) return;
    const falta = proximoFim - Date.now();
    if (falta < -60_000) return;
    const espera = falta + 1_500 > 0 ? Math.max(1_000, falta + 1_500) : 3_000;
    if (espera > 2 ** 31 - 1) return;
    const t = setTimeout(() => {
      void recarregar().then(() => setRearme((n) => n + 1));
    }, espera);
    return () => clearTimeout(t);
  }, [proximoFim, rearme, recarregar]);

  return { lista, carregado, recarregar };
}
