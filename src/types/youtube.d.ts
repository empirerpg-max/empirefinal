declare namespace YT {
  interface Player {
    playVideo(): void;
    pauseVideo(): void;
    stopVideo(): void;
    loadVideoById(id: string): void;
    cueVideoById(id: string): void;
    destroy(): void;
    getPlayerState(): number;
    [key: string]: unknown;
  }
  interface PlayerEvent {
    target: Player;
    data?: unknown;
  }
  interface OnStateChangeEvent {
    target: Player;
    data: number;
  }
  const PlayerState: {
    UNSTARTED: -1;
    ENDED: 0;
    PLAYING: 1;
    PAUSED: 2;
    BUFFERING: 3;
    CUED: 5;
  };
}
