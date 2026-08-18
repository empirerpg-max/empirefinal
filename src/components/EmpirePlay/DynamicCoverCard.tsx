import { driveRawImg } from "@/lib/api";

// IDs fixos dos templates de capa dinâmica (pasta "Capa Playlist" no Drive).
// Resolvidos por ID porque são arquivos de design controlados por nós — o
// conteúdo variável (foto do artista / capa da música) sempre vem por nome
// dinâmico da planilha, nunca por ID fixo.
const TEMPLATES = {
  spotifyBase: "1HzcUaW91zn-45UbGjFotDS3BQs8kMTcR",
  spotifySub: "1DggkwV5S3JEjwNIl2TCJXKQktbFPI5Ch",
  appleBase: "1Kq9AZ3We9NfEGXOR3CaXX1aISL3_4DCw",
  youtubeBase: "1iL2PWPgHW30YuTGK4tQMobBESnCMD0Es",
  youtubeSub: "13ygT5tAFmgVRIC2Wd7qa74xj6Yi4EMjR",
  hotBase: "1yXHsKqvdpdM2F2F4hP5ksP6YVugmh6_C",
  hotSub: "1D_zfoJ2hASAkdKhq6tHDvQYoNLSLju-K",
} as const;

const NAME_FALLBACKS = new Set(["", "Artista não informado", "Artista Independente"]);

function cleanName(name?: string | null): string {
  if (!name) return "";
  return NAME_FALLBACKS.has(name.trim()) ? "" : name.trim();
}

export type CoverPlatform = "spotify" | "apple" | "youtube" | "hot";

export function DynamicCoverCard({
  platform,
  artistName,
  artistPhotoUrl,
  coverUrl,
  className = "",
}: {
  platform: CoverPlatform;
  artistName?: string | null;
  artistPhotoUrl?: string | null;
  coverUrl?: string | null;
  className?: string;
}) {
  const name = cleanName(artistName);
  const photo = artistPhotoUrl ? driveRawImg(artistPhotoUrl) : undefined;
  const cover = coverUrl ? driveRawImg(coverUrl) : undefined;

  if (platform === "spotify") {
    const hasPhoto = !!photo;
    return (
      <div className={`overflow-hidden ${className}`}>
        {hasPhoto && (
          <img src={photo} alt="" className="absolute inset-0 size-full object-cover" />
        )}
        <img
          src={driveRawImg(hasPhoto ? TEMPLATES.spotifyBase : TEMPLATES.spotifySub)}
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
        {name && (
          <div
            className="absolute right-[6%] bottom-[5%] text-right font-extrabold text-white text-[11px] sm:text-sm leading-tight"
            style={{ fontFamily: "'Poppins', sans-serif", textShadow: "0 2px 10px rgba(0,0,0,.6)" }}
          >
            {name}
          </div>
        )}
      </div>
    );
  }

  if (platform === "apple") {
    const squareCover = cover;
    const middlePhoto = photo || cover;
    return (
      <div className={`overflow-hidden bg-black ${className}`}>
        <img
          src={driveRawImg(TEMPLATES.appleBase)}
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
        {squareCover && (
          <>
            <div
              className="absolute overflow-hidden"
              style={{ top: "50.03%", height: "36.47%", left: "-6.55%", width: "36.47%" }}
            >
              <img src={squareCover} alt="" className="size-full object-cover" />
            </div>
            <div
              className="absolute overflow-hidden"
              style={{ top: "50.03%", height: "36.47%", left: "33.09%", width: "36.47%" }}
            >
              <img src={middlePhoto} alt="" className="size-full object-cover" />
            </div>
            <div
              className="absolute overflow-hidden"
              style={{ top: "50.03%", height: "36.47%", left: "72.73%", width: "36.47%" }}
            >
              <img src={squareCover} alt="" className="size-full object-cover" />
            </div>
          </>
        )}
        {name && (
          <div
            className="absolute left-0 w-full flex items-center justify-center text-center font-extrabold text-white px-[6%] text-[10px] sm:text-sm z-10"
            style={{
              top: "50.03%",
              height: "36.47%",
              fontFamily: "'Poppins', sans-serif",
              textShadow: "0 2px 12px rgba(0,0,0,.85)",
            }}
          >
            {name}
          </div>
        )}
      </div>
    );
  }

  if (platform === "youtube") {
    const hasPhoto = !!photo;
    return (
      <div className={`overflow-hidden ${className}`}>
        {hasPhoto ? (
          <>
            <img src={photo} alt="" className="absolute inset-0 size-full object-cover" />
            <img
              src={driveRawImg(TEMPLATES.youtubeBase)}
              alt=""
              className="absolute inset-0 size-full object-cover"
            />
          </>
        ) : (
          <>
            <img
              src={driveRawImg(TEMPLATES.youtubeSub)}
              alt=""
              className="absolute inset-0 size-full object-cover"
            />
            {name && (
              <div
                className="absolute inset-x-0 bottom-[8%] text-center font-extrabold text-white text-[11px] sm:text-sm px-[6%]"
                style={{ fontFamily: "'Poppins', sans-serif", textShadow: "0 2px 10px rgba(0,0,0,.6)" }}
              >
                {name}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // platform === "hot"
  const hasCover = !!cover;
  return (
    <div className={`overflow-hidden ${className}`}>
      {hasCover && <img src={cover} alt="" className="absolute inset-0 size-full object-cover" />}
      <img
        src={driveRawImg(hasCover ? TEMPLATES.hotBase : TEMPLATES.hotSub)}
        alt=""
        className="absolute inset-0 size-full object-cover"
      />
      {name && (
        <div
          className="absolute inset-x-0 bottom-[13%] text-center font-extrabold text-white uppercase text-[11px] sm:text-sm tracking-wide"
          style={{ fontFamily: "'Poppins', sans-serif", textShadow: "0 2px 10px rgba(0,0,0,.6)" }}
        >
          {name}
        </div>
      )}
    </div>
  );
}
