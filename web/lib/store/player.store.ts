import { create } from 'zustand';

export type PlayerError =
  | { kind: 'network'; message: string }
  | { kind: 'media'; message: string }
  | { kind: 'fatal'; message: string };

interface PlayerState {
  variantId: string | null;
  quality: string | null;             // user-chosen label, or null = auto
  level: number;                       // -1 = auto
  isPlaying: boolean;
  isBuffering: boolean;
  durationSec: number;
  positionSec: number;
  error: PlayerError | null;

  setVariant: (variantId: string | null, quality: string | null) => void;
  setLevel: (level: number) => void;
  setPlaying: (v: boolean) => void;
  setBuffering: (v: boolean) => void;
  setTime: (positionSec: number, durationSec: number) => void;
  setError: (e: PlayerError | null) => void;
  reset: () => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  variantId: null,
  quality: null,
  level: -1,
  isPlaying: false,
  isBuffering: false,
  durationSec: 0,
  positionSec: 0,
  error: null,
  setVariant: (variantId, quality) => set({ variantId, quality }),
  setLevel: (level) => set({ level }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setBuffering: (isBuffering) => set({ isBuffering }),
  setTime: (positionSec, durationSec) => set({ positionSec, durationSec }),
  setError: (error) => set({ error }),
  reset: () =>
    set({
      variantId: null,
      quality: null,
      level: -1,
      isPlaying: false,
      isBuffering: false,
      durationSec: 0,
      positionSec: 0,
      error: null,
    }),
}));
