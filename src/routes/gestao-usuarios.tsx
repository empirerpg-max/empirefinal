import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Ban,
  ChevronLeft,
  Loader2,
  LogOut,
  Search,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredLogin, getStoredSessionToken, isAdminLogin } from "@/components/LoginScreen";
import { driveRawImg } from "@/lib/api";

export const Route = createFileRoute("/gestao-usuarios")({
  head: () => ({ meta: [{ title: "Gestão de usuários — Empire Hub" }] }),
  component: GestaoUsuarios,
});

interface UsuarioGestao {
  id: string;
  usuario: string;
  tipoPerfil: string;
  fotoPerfil: string;
  bloqueado: boolean;
  bloqueadoEm: string;
  deslogadoEm: string;
  naPlanilha: boolean;
}

type Acao = "deslogar" | "bloquear" | "desbloquear";

async function chamarApi(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getStoredSessionToken() || ""}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!json?.success) throw new Error(json?.error || "Falha na operação.");
  return json;
}

function fmtData(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function GestaoUsuarios() {
  const souAdmin = isAdminLogin(getStoredLogin());
  const [usuarios, setUsuarios] = useState<UsuarioGestao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [soBloqueados, setSoBloqueados] = useState(false);
  const [executando, setExecutando] = useState<string | null>(null);

  useEffect(() => {
    if (!souAdmin) return;
    chamarApi("/api/auth/admin/usuarios")
      .then((j) => setUsuarios(j.data || []))
      .catch((e: unknown) =>
        setErro(e instanceof Error ? e.message : "Falha ao carregar usuários."),
      );
  }, [souAdmin]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (usuarios || [])
      .filter((u) => !soBloqueados || u.bloqueado)
      .filter((u) => !termo || u.usuario.toLowerCase().includes(termo) || u.id.includes(termo))
      .sort(
        (a, b) => Number(b.bloqueado) - Number(a.bloqueado) || a.usuario.localeCompare(b.usuario),
      );
  }, [usuarios, busca, soBloqueados]);

  const totalBloqueados = (usuarios || []).filter((u) => u.bloqueado).length;

  async function executar(u: UsuarioGestao, acao: Acao) {
    const nome = u.usuario || `ID ${u.id}`;
    const pergunta = {
      deslogar: `Deslogar "${nome}" de todos os aparelhos? Ele poderá entrar de novo com a senha.`,
      bloquear: `Bloquear "${nome}"? Ele será deslogado e não conseguirá mais entrar até ser desbloqueado.`,
      desbloquear: `Desbloquear "${nome}"? Ele poderá entrar de novo com a senha.`,
    }[acao];
    if (!window.confirm(pergunta)) return;
    const chave = `${u.id}|${u.usuario}`;
    setExecutando(chave);
    try {
      await chamarApi("/api/auth/admin/acao", { acao, id: u.id, usuario: u.usuario });
      const agora = new Date().toISOString();
      setUsuarios((lista) =>
        (lista || []).map((x) =>
          `${x.id}|${x.usuario}` !== chave
            ? x
            : acao === "desbloquear"
              ? { ...x, bloqueado: false, bloqueadoEm: "" }
              : acao === "bloquear"
                ? { ...x, bloqueado: true, bloqueadoEm: agora, deslogadoEm: agora }
                : { ...x, deslogadoEm: agora },
        ),
      );
      toast.success(
        {
          deslogar: `"${nome}" foi deslogado.`,
          bloquear: `"${nome}" foi bloqueado.`,
          desbloquear: `"${nome}" foi desbloqueado.`,
        }[acao],
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha na operação.");
    } finally {
      setExecutando(null);
    }
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-32">
      <Link
        to="/perfil"
        className="inline-flex items-center gap-1 text-muted-foreground mb-6 font-black uppercase text-[11px] hover:text-primary transition-colors"
      >
        <ChevronLeft className="size-4 shrink-0" /> Perfil
      </Link>

      <header className="mb-6">
        <div className="size-14 rounded-2xl bg-primary/15 text-primary grid place-items-center mb-4">
          <Users className="size-7" />
        </div>
        <h1 className="text-3xl font-black italic uppercase tracking-tighter">
          Gestão de <span className="text-primary">usuários</span>
        </h1>
        <p className="text-muted-foreground text-[11px] font-bold mt-1 uppercase tracking-widest">
          Deslogar, bloquear e desbloquear jogadores
        </p>
      </header>

      {!souAdmin ? (
        <p className="text-sm text-muted-foreground">Acesso restrito ao admin.</p>
      ) : erro ? (
        <p className="text-sm text-red-400">{erro}</p>
      ) : !usuarios ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3">
            <div className="relative min-w-0 flex-1">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome ou ID"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-xs text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setSoBloqueados(false)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider border ${
                !soBloqueados
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-white/10 text-muted-foreground"
              }`}
            >
              Todos ({usuarios.length})
            </button>
            <button
              onClick={() => setSoBloqueados(true)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider border ${
                soBloqueados
                  ? "bg-red-500 text-white border-red-500"
                  : "border-white/10 text-muted-foreground"
              }`}
            >
              Bloqueados ({totalBloqueados})
            </button>
          </div>

          {filtrados.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Nenhum jogador encontrado.
            </p>
          ) : (
            <ul className="space-y-2">
              {filtrados.map((u) => {
                const chave = `${u.id}|${u.usuario}`;
                const ocupado = executando === chave;
                // Confere o usuário DA LISTA (não o logado) pelo critério único.
                const ehAdmin = isAdminLogin(u, u.id);
                return (
                  <li
                    key={chave}
                    className={`p-3 rounded-2xl border ${
                      u.bloqueado
                        ? "bg-red-500/5 border-red-500/30"
                        : "bg-white/[0.02] border-white/5"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {u.fotoPerfil ? (
                        <img
                          src={driveRawImg(u.fotoPerfil)}
                          alt=""
                          className="size-10 rounded-full object-cover shrink-0 bg-white/5"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="size-10 rounded-full bg-white/5 grid place-items-center shrink-0">
                          <UserRound className="size-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold truncate">{u.usuario || "(sem nome)"}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {u.id ? `ID ${u.id}` : "sem ID"}
                          {ehAdmin ? " · Admin" : ""}
                          {!u.naPlanilha ? " · fora da planilha" : ""}
                        </p>
                        {u.bloqueado ? (
                          <p className="text-[11px] text-red-400 font-bold">
                            Bloqueado {fmtData(u.bloqueadoEm)}
                          </p>
                        ) : u.deslogadoEm ? (
                          <p className="text-[11px] text-muted-foreground">
                            Deslogado {fmtData(u.deslogadoEm)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {ocupado ? (
                        <Loader2 className="size-4 animate-spin text-primary" />
                      ) : (
                        <>
                          {!u.bloqueado && (
                            <button
                              onClick={() => executar(u, "deslogar")}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 text-[11px] font-black uppercase tracking-wider hover:bg-white/5"
                            >
                              <LogOut className="size-3.5 shrink-0" />
                              <span>Deslogar</span>
                            </button>
                          )}
                          {u.bloqueado ? (
                            <button
                              onClick={() => executar(u, "desbloquear")}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-black uppercase tracking-wider"
                            >
                              <ShieldCheck className="size-3.5 shrink-0" />
                              <span>Desbloquear</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => executar(u, "bloquear")}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500 text-white text-[11px] font-black uppercase tracking-wider"
                            >
                              <Ban className="size-3.5 shrink-0" />
                              <span>Bloquear</span>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
