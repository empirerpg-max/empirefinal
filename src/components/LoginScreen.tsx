import { useState } from "react";
import { Crown, Lock, User, Loader2, Eye, EyeOff } from "lucide-react";
import logoIcon from "@/assets/logo-icon.png";

export interface LoginResult {
  id: string;
  nome: string;
  usuario: string;
  tipoPerfil: string;
  fotoPerfil: string;
  prestigio: string;
}

const STORAGE_KEY = "empire_login_user";
// Token de sessão assinado (HMAC) emitido pelo backend no login/heartbeat —
// guardado à parte do usuário pra facilitar limpar um sem o outro, e porque
// código legado que já lê STORAGE_KEY não precisa saber que ele existe.
const TOKEN_STORAGE_KEY = "empire_session_token";

export function getStoredLogin(): LoginResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LoginResult) : null;
  } catch {
    return null;
  }
}

export function clearStoredLogin() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function setStoredLogin(user: LoginResult) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function getStoredSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredSessionToken(token: string | null | undefined) {
  if (typeof window === "undefined" || !token) return;
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Silencioso — sem token guardado, ações admin caem no fallback de
    // "não prova identidade" no backend, não quebra o app.
  }
}

function TrocarSenhaInicialScreen({
  usuario,
  senhaAtual,
  onDone,
}: {
  usuario: string;
  senhaAtual: string;
  onDone: () => void;
}) {
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (novaSenha.length < 4) {
      setErrorMsg("A nova senha precisa ter pelo menos 4 caracteres.");
      return;
    }
    if (novaSenha !== confirmar) {
      setErrorMsg("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/auth/trocar-senha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, senhaAtual, novaSenha }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Não foi possível trocar a senha.");
      }
      onDone();
    } catch (err: any) {
      setErrorMsg(err.message || "Erro de conexão ao trocar a senha.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <Lock className="size-10 text-primary relative z-10" />
            <span className="absolute inset-0 rounded-2xl bg-primary/40 blur-xl opacity-60" />
          </div>
          <h1 className="font-black uppercase tracking-tight text-xl text-center">Defina sua senha</h1>
          <p className="text-[11px] text-muted-foreground uppercase font-black tracking-[0.15em] mt-2 text-center opacity-70">
            Primeiro acesso — troque a senha inicial por uma só sua
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-card border border-white/10 rounded-[2rem] p-6 sm:p-7 space-y-5 shadow-2xl"
        >
          <div>
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
              Nova senha
            </label>
            <input
              type="password"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none focus:border-primary/50 transition placeholder:text-muted-foreground/40"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
              Confirmar nova senha
            </label>
            <input
              type="password"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none focus:border-primary/50 transition placeholder:text-muted-foreground/40"
              required
            />
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 text-xs font-medium">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-14 rounded-[2rem] bg-primary text-primary-foreground font-black uppercase text-xs tracking-[0.2em] flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50 shadow-[0_10px_30px_rgba(var(--primary-rgb),0.3)]"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : "Confirmar"}
          </button>
        </form>
      </div>
    </div>
  );
}

export function LoginScreen({ onSuccess }: { onSuccess: (user: LoginResult) => void }) {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [showSenha, setShowSenha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Quando o login usa a senha inicial (definida pelo admin na planilha), o
  // backend exige trocar por uma senha própria antes de entrar — guarda o
  // usuário logado e a senha usada até essa troca ser concluída.
  const [pendingTroca, setPendingTroca] = useState<{ user: LoginResult; senhaAtual: string; token?: string } | null>(
    null,
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuario.trim() || !senha) {
      setErrorMsg("Preencha usuário e senha.");
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario: usuario.trim(), senha }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Não foi possível entrar.");
      }
      if (json.data?.precisaTrocarSenha) {
        setPendingTroca({ user: json.data as LoginResult, senhaAtual: senha, token: json.token });
        return;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(json.data));
      setStoredSessionToken(json.token);
      onSuccess(json.data as LoginResult);
    } catch (err: any) {
      setErrorMsg(err.message || "Erro de conexão ao entrar.");
    } finally {
      setLoading(false);
    }
  };

  if (pendingTroca) {
    return (
      <TrocarSenhaInicialScreen
        usuario={pendingTroca.user.usuario}
        senhaAtual={pendingTroca.senhaAtual}
        onDone={() => {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(pendingTroca.user));
          setStoredSessionToken(pendingTroca.token);
          onSuccess(pendingTroca.user);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <img src={logoIcon} alt="Empire" className="size-16 rounded-2xl object-contain relative z-10" />
            <span className="absolute inset-0 rounded-2xl bg-primary/40 blur-xl opacity-60" />
          </div>
          <h1 className="font-black italic uppercase tracking-tighter text-2xl">
            <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              Empire
            </span>{" "}
            <span className="text-primary">Hub</span>
          </h1>
          <p className="text-[11px] text-muted-foreground uppercase font-black tracking-[0.2em] mt-2 text-center opacity-70">
            Entre com seu usuário e senha
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-card border border-white/10 rounded-[2rem] p-6 sm:p-7 space-y-5 shadow-2xl"
        >
          <div>
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <User className="size-3.5 text-primary" />
              Usuário
            </label>
            <input
              type="text"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="Ex: hugo_empire"
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none focus:border-primary/50 transition placeholder:text-muted-foreground/40"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Lock className="size-3.5 text-primary" />
              Senha
            </label>
            <div className="relative">
              <input
                type={showSenha ? "text" : "password"}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 pr-11 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none focus:border-primary/50 transition placeholder:text-muted-foreground/40"
                required
              />
              <button
                type="button"
                onClick={() => setShowSenha((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
                tabIndex={-1}
              >
                {showSenha ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-2 italic">
              Primeiro acesso? Use a senha inicial que um admin te passou — você vai trocar por uma sua na sequência.
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 text-xs font-medium">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-14 rounded-[2rem] bg-primary text-primary-foreground font-black uppercase text-xs tracking-[0.2em] flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50 shadow-[0_10px_30px_rgba(var(--primary-rgb),0.3)]"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <>
                <Crown className="size-4" />
                Entrar
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
