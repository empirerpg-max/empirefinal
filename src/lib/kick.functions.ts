import { createServerFn } from "@tanstack/react-start";

export type KickStatus = {
  live: boolean;
  channel: string;
  viewers?: number;
  title?: string;
  startedAt?: string;
  playbackUrl?: string;
};

export const getKickStatus = createServerFn({ method: "GET" })
  .inputValidator((d: { channel?: string } | undefined) => ({
    channel: (d?.channel || "empiretvoficial").trim().toLowerCase(),
  }))
  .handler(async ({ data }): Promise<KickStatus> => {
    try {
      const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(data.channel)}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "application/json",
        },
      });
      if (!res.ok) return { live: false, channel: data.channel };
      const j = (await res.json()) as any;
      const ls = j?.livestream;
      if (!ls) return { live: false, channel: data.channel, playbackUrl: j?.playback_url };
      return {
        live: true,
        channel: data.channel,
        viewers: Number(ls.viewer_count || 0),
        title: String(ls.session_title || ""),
        startedAt: ls.created_at ? String(ls.created_at) : undefined,
        playbackUrl: j?.playback_url,
      };
    } catch {
      return { live: false, channel: data.channel };
    }
  });
