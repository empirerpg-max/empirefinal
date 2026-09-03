// Helpers de embed do Empire TV, compartilhados entre a tela cheia (/tv) e
// o mini player flutuante global — extraídos daqui pra não duplicar a
// lógica de plataforma (Kick/YouTube/Vimeo) em dois lugares.

// Converte stream_url da planilha em URL embeddável quando possível.
// - Kick canal (kick.com/<canal>): só embeda se ao_vivo, via player.kick.com
// - YouTube watch/short: converte para youtube.com/embed
// - URLs já embeddáveis (player.kick.com, youtube.com/embed, vimeo player, iframe): usa como está
// - Telegram (t.me/...) ou nada: sem embed
export function resolveStreamEmbed(url: string | undefined, aoVivo: boolean): string | null {
  if (!url) return null;
  const u = url.trim();
  if (!u) return null;
  try {
    const parsed = new URL(u);
    const host = parsed.hostname.replace(/^www\./, "");

    if (host === "t.me" || host === "telegram.me") return null;

    // player.kick.com direto — forçamos os mesmos parâmetros do outro ramo
    // abaixo (autoplay=true&muted=false) em vez de usar a URL crua como
    // veio salva, porque se ela não tiver "muted=false" o player abre mudo
    // silenciosamente sem nenhum erro visível — foi exatamente esse o caso
    // que fez o som "sumir do nada" pra uma transmissão específica.
    if (host === "player.kick.com") {
      parsed.searchParams.set("autoplay", "true");
      parsed.searchParams.set("muted", "false");
      return parsed.toString();
    }
    if (host === "kick.com") {
      // A checagem de "ao vivo" via API da Kick é bloqueada por proteção
      // anti-bot server-side (confirmado: HTTP 403 "Request blocked by
      // security policy") — não dá pra confiar nela pra decidir se embeda.
      // Sempre embeda o canal quando a URL é válida; o próprio player da
      // Kick mostra "offline" quando não tiver transmissão, então isso
      // nunca piora a experiência, só deixa de depender de uma checagem
      // que está bloqueada.
      // muted=false: sem isso o player da Kick abre mudo por padrão.
      const seg = parsed.pathname.split("/").filter(Boolean);
      if (seg.length === 1) return `https://player.kick.com/${seg[0]}?autoplay=true&muted=false`;
      return null; // rota não-embeddável (ex: /video/..., /clips/...)
    }

    // modestbranding/rel/iv_load_policy reduzem ao máximo a marca do
    // YouTube (logo grande, sugestões de outros canais) — o player deve
    // parecer o mesmo independente de qual plataforma serve o vídeo.
    // autoplay=1&mute=0: mesma intenção do muted=false da Kick acima — sem
    // isso o embed do YouTube nem tenta autoplay (fica parado esperando um
    // clique no play), e o botão de ativar som (que usa o parâmetro
    // "mute", não "muted") não tinha nenhum efeito nele antes.
    const YT_PARAMS = "modestbranding=1&rel=0&iv_load_policy=3&playsinline=1&autoplay=1&mute=0";
    if (host === "youtu.be") {
      const id = parsed.pathname.slice(1);
      return id ? `https://www.youtube.com/embed/${id}?${YT_PARAMS}` : null;
    }
    if (host.endsWith("youtube.com")) {
      if (parsed.pathname === "/watch") {
        const id = parsed.searchParams.get("v");
        return id ? `https://www.youtube.com/embed/${id}?${YT_PARAMS}` : null;
      }
      if (parsed.pathname.startsWith("/embed/") || parsed.pathname.startsWith("/live/")) {
        return u.includes("?") ? `${u}&${YT_PARAMS}` : `${u}?${YT_PARAMS}`;
      }
      return null;
    }

    if (host.includes("vimeo.com")) {
      const VIMEO_PARAMS = "title=0&byline=0&portrait=0&autoplay=1&muted=0";
      if (host === "player.vimeo.com") {
        return u.includes("?") ? `${u}&${VIMEO_PARAMS}` : `${u}?${VIMEO_PARAMS}`;
      }
      const id = parsed.pathname.split("/").filter(Boolean).pop();
      return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}?${VIMEO_PARAMS}` : null;
    }

    return u; // assume embeddável
  } catch {
    return null;
  }
}

export function kickChannelFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./, "");
    if (host !== "kick.com") return null;
    const seg = parsed.pathname.split("/").filter(Boolean);
    return seg.length === 1 ? seg[0] : null;
  } catch {
    return null;
  }
}

// Nome do parâmetro de "sem som" varia por plataforma (Kick: muted=true/
// false, YouTube: mute=1/0, Vimeo: muted=1/0) — cada uma ignora o parâmetro
// da outra silenciosamente, então usar sempre "muted" (como o código fazia
// antes) simplesmente não tinha efeito nenhum no YouTube.
export function buildForceUnmuteUrl(currentSrc: string): string {
  const url = new URL(currentSrc);
  const host = url.hostname.replace(/^www\./, "");
  if (host.endsWith("youtube.com")) {
    url.searchParams.set("mute", "0");
    url.searchParams.set("autoplay", "1");
  } else if (host.includes("vimeo.com")) {
    url.searchParams.set("muted", "0");
    url.searchParams.set("autoplay", "1");
  } else {
    url.searchParams.set("muted", "false");
    url.searchParams.set("autoplay", "true");
  }
  // Garante que a URL muda mesmo se já tivesse esses parâmetros (senão
  // trocar o src pro mesmo valor não recarrega nada e o clique não faz
  // efeito nenhum).
  url.searchParams.set("_unmute", String(Date.now()));
  return url.toString();
}

// Verdadeiro depois que a pessoa já conseguiu ativar o som de alguma
// transmissão nesta sessão do navegador — usado só pra decidir se
// mostramos o aviso grande "toque pra ativar o som" ou um ícone discreto,
// nunca pra pular a exigência do navegador de um toque de verdade por
// vídeo novo (isso é política do próprio navegador, não dá pra contornar).
export const TV_UNMUTE_SESSION_KEY = "empire_tv_unmuted_session";

export function markUnmutedThisSession() {
  try {
    sessionStorage.setItem(TV_UNMUTE_SESSION_KEY, "1");
  } catch {
    /* sessionStorage indisponível (modo privado etc.) — sem problema, só volta a perguntar */
  }
}

export function hasUnmutedThisSession(): boolean {
  try {
    return sessionStorage.getItem(TV_UNMUTE_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

// Substitui o NÓ do iframe (não só o atributo src) de forma síncrona,
// dentro do próprio handler de clique. Reatribuir "src" no mesmo elemento
// via JS deixou de bastar pra ativar som em navegação cross-origin em
// navegadores recentes — a permissão de autoplay-com-som exige que a
// "ativação do usuário" chegue junto da criação do frame, e vários
// navegadores pararam de propagar isso quando é só uma troca de atributo
// num elemento já existente (endurecimento anti-abuso, já que sites usavam
// exatamente esse truque pra forçar autoplay com som). Criar um elemento
// NOVO como consequência direta e síncrona do clique é o que continua
// funcionando.
export function forceUnmuteIframe(el: HTMLIFrameElement): HTMLIFrameElement {
  const fresh = el.cloneNode(false) as HTMLIFrameElement;
  fresh.src = buildForceUnmuteUrl(el.src);
  el.replaceWith(fresh);
  markUnmutedThisSession();
  return fresh;
}
