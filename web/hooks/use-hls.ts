'use client';

import { useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import type { Level } from 'hls.js';

export interface HlsLevel {
  index: number;
  height: number | null;
  bitrate: number;
  label: string;
}

export interface HlsState {
  ready: boolean;
  levels: HlsLevel[];
  currentLevel: number;     // -1 = auto
  isLive: boolean;
  error: { kind: 'network' | 'media' | 'fatal'; message: string } | null;
}

export interface UseHlsResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  state: HlsState;
  setLevel: (index: number) => void;       // -1 for auto
  retry: () => void;
}

/**
 * hls.js bridge:
 *  - Falls through to native HLS on Safari (canPlayType m3u8).
 *  - Lazy-loads hls.js so it stays out of the landing-page bundle.
 *  - Maps fatal errors with bounded recovery attempts.
 */
export function useHls(src: string | null): UseHlsResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const recoverCountRef = useRef(0);
  const [state, setState] = useState<HlsState>({
    ready: false,
    levels: [],
    currentLevel: -1,
    isLive: false,
    error: null,
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let cancelled = false;
    setState((s) => ({ ...s, ready: false, error: null }));
    recoverCountRef.current = 0;

    const useNative =
      video.canPlayType('application/vnd.apple.mpegurl') !== '' &&
      // Force hls.js when we want quality control on browsers that also support native HLS but lack APIs.
      typeof window !== 'undefined' &&
      /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    if (useNative) {
      video.src = src;
      const onLoaded = () => {
        if (cancelled) return;
        setState((s) => ({ ...s, ready: true, levels: [], currentLevel: -1 }));
      };
      video.addEventListener('loadedmetadata', onLoaded);
      return () => {
        cancelled = true;
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeAttribute('src');
        video.load();
      };
    }

    let disposed = false;
    void (async () => {
      const mod = await import('hls.js');
      if (cancelled) return;
      const HlsCtor = mod.default;

      if (!HlsCtor.isSupported()) {
        setState((s) => ({
          ...s,
          ready: false,
          error: { kind: 'fatal', message: 'HLS not supported on this browser.' },
        }));
        return;
      }

      const hls = new HlsCtor({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        backBufferLength: 30,
      });
      hlsRef.current = hls;

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(HlsCtor.Events.MANIFEST_PARSED, (_e, data: { levels: Level[] }) => {
        if (disposed) return;
        const levels: HlsLevel[] = data.levels.map((l, i) => ({
          index: i,
          height: l.height ?? null,
          bitrate: l.bitrate ?? 0,
          label: l.height ? `${l.height}p` : `${Math.round((l.bitrate ?? 0) / 1000)} kbps`,
        }));
        setState((s) => ({ ...s, ready: true, levels, currentLevel: hls.currentLevel }));
      });

      hls.on(HlsCtor.Events.LEVEL_SWITCHED, (_e, data: { level: number }) => {
        if (disposed) return;
        setState((s) => ({ ...s, currentLevel: data.level }));
      });

      hls.on(HlsCtor.Events.ERROR, (_e, data) => {
        if (disposed) return;
        if (!data.fatal) return;
        switch (data.type) {
          case HlsCtor.ErrorTypes.NETWORK_ERROR:
            if (recoverCountRef.current < 3) {
              recoverCountRef.current += 1;
              setTimeout(() => hls.startLoad(), 500 * recoverCountRef.current);
            } else {
              setState((s) => ({
                ...s,
                error: { kind: 'network', message: 'Network error. Try again.' },
              }));
            }
            break;
          case HlsCtor.ErrorTypes.MEDIA_ERROR:
            if (recoverCountRef.current < 2) {
              recoverCountRef.current += 1;
              hls.recoverMediaError();
            } else {
              setState((s) => ({
                ...s,
                error: { kind: 'media', message: 'Media error. Reload to retry.' },
              }));
            }
            break;
          default:
            setState((s) => ({
              ...s,
              error: { kind: 'fatal', message: 'Playback failed.' },
            }));
            hls.destroy();
        }
      });
    })();

    return () => {
      cancelled = true;
      disposed = true;
      const hls = hlsRef.current;
      if (hls) {
        hls.destroy();
        hlsRef.current = null;
      }
    };
  }, [src]);

  const setLevel = (index: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = index;
    setState((s) => ({ ...s, currentLevel: index }));
  };

  const retry = () => {
    const hls = hlsRef.current;
    if (hls) {
      hls.startLoad();
      setState((s) => ({ ...s, error: null }));
    } else {
      const v = videoRef.current;
      if (v && src) {
        v.src = src;
        v.load();
      }
    }
  };

  return { videoRef, state, setLevel, retry };
}
