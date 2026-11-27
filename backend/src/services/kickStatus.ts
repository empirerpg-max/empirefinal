// "Está ao vivo?" de um canal da Kick (API pública não oficial do site).
// Usado pela grade da TV (GET /api/tv/programas?kick=1), que junta a grade e
// o status num pedido só — antes eram dois pedidos a cada checagem por
// pessoa. A mesma lógica de src/lib/kick.functions.ts.

export type KickStatus = {
  live: boolean;
  channel: string;
  viewers?: number;
  title?: string;
  startedAt?: string;
  playbackUrl?: string;
};

export function kickChannelFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./, "");
    if (host !== "kick.com") return null;
    const seg = parsed.pathname.split("/").filter(Boolean);
    return seg.length === 1 ? seg[0].toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function statusKick(channel: string): Promise<KickStatus> {
  try {
    const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    if (!res.ok) return { live: false, channel };
    const j = (await res.json()) as any;
    const ls = j?.livestream;
    if (!ls) return { live: false, channel, playbackUrl: j?.playback_url };
    return {
      live: true,
      channel,
      viewers: Number(ls.viewer_count || 0),
      title: String(ls.session_title || ""),
      startedAt: ls.created_at ? String(ls.created_at) : undefined,
      playbackUrl: j?.playback_url,
    };
  } catch {
    return { live: false, channel };
  }
}
