'use client';

import { Maximize, Minimize, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import PlaybackSpeedMenu from './PlaybackSpeedMenu';
import QualitySelector from './QualitySelector';
import { useHls } from '@/hooks/use-hls';
import { cn } from '@/lib/utils/cn';
import { formatDuration } from '@/lib/utils/format';

interface Props {
  src: string | null;
  poster?: string | null;
  className?: string;
}

const CONTROLS_TIMEOUT_MS = 2500;

/**
 * Modern streaming player.
 *
 *  - hls.js bridge (native fallback on Safari).
 *  - Tap to toggle controls; double-tap left/right to seek ±10s.
 *  - Quality + playback speed menus.
 *  - Buffered range visualization on the scrub bar.
 *  - Fullscreen with iOS Safari `webkitEnterFullscreen` fallback.
 *  - Network/media error overlay with retry.
 */
export default function HlsPlayer({ src, poster, className }: Props) {
  const { videoRef, state, setLevel, retry } = useHls(src);

  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ side: 'left' | 'right'; time: number } | null>(null);

  // Sync transient UI state with the <video> element.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => setPosition(v.currentTime || 0);
    const onLoaded = () => setDuration(v.duration || 0);
    const onWait = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onProgress = () => {
      if (v.buffered.length > 0) setBufferedEnd(v.buffered.end(v.buffered.length - 1));
    };
    const onRate = () => setRate(v.playbackRate);
    const onVolume = () => setMuted(v.muted);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onLoaded);
    v.addEventListener('durationchange', onLoaded);
    v.addEventListener('waiting', onWait);
    v.addEventListener('playing', onPlaying);
    v.addEventListener('progress', onProgress);
    v.addEventListener('ratechange', onRate);
    v.addEventListener('volumechange', onVolume);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onLoaded);
      v.removeEventListener('durationchange', onLoaded);
      v.removeEventListener('waiting', onWait);
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('progress', onProgress);
      v.removeEventListener('ratechange', onRate);
      v.removeEventListener('volumechange', onVolume);
    };
  }, [videoRef]);

  // Track fullscreen state across the Fullscreen API + iOS native player.
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Keyboard accelerators.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (!v) return;
      // Skip when typing in form fields elsewhere.
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (!containerRef.current?.contains(document.activeElement) && document.activeElement !== document.body) {
        return;
      }
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          if (v.paused) void v.play();
          else v.pause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          v.currentTime = Math.max(0, v.currentTime - 5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          v.currentTime = Math.min((v.duration || 0) - 0.25, v.currentTime + 5);
          break;
        case 'm':
          e.preventDefault();
          v.muted = !v.muted;
          break;
        case 'f':
          e.preventDefault();
          void enterFullscreen();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const armHide = () => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setShowControls(false);
    }, CONTROLS_TIMEOUT_MS);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => undefined);
    else v.pause();
    armHide();
  };

  const seek = (delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min((v.duration || 0) - 0.25, v.currentTime + delta));
    armHide();
  };

  const onScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const next = Number(e.target.value);
    v.currentTime = next;
    setPosition(next);
  };

  const onSurfaceTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('[data-player-controls]')) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const side: 'left' | 'right' = x < rect.width / 2 ? 'left' : 'right';
    const now = Date.now();
    const last = lastTapRef.current;
    if (last && last.side === side && now - last.time < 350) {
      seek(side === 'left' ? -10 : 10);
      lastTapRef.current = null;
    } else {
      lastTapRef.current = { side, time: now };
      setShowControls((s) => !s);
      armHide();
    }
  };

  const enterFullscreen = async () => {
    const el = containerRef.current;
    const v = videoRef.current;
    try {
      // iOS Safari only supports fullscreen on the <video> element directly.
      type IOSVideoElement = HTMLVideoElement & {
        webkitEnterFullscreen?: () => void;
        webkitExitFullscreen?: () => void;
      };
      const iosV = v as IOSVideoElement | null;
      if (iosV && typeof iosV.webkitEnterFullscreen === 'function') {
        iosV.webkitEnterFullscreen();
        return;
      }
      if (el && document.fullscreenElement !== el) {
        await el.requestFullscreen();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      /* user cancelled */
    }
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    armHide();
  };

  const setPlaybackRate = (r: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = r;
    armHide();
  };

  const bufferedPct = duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0;
  const playedPct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <div
      ref={containerRef}
      className={cn(
        'group relative aspect-video w-full overflow-hidden rounded-2xl bg-black no-select',
        className,
      )}
      onMouseMove={() => {
        setShowControls(true);
        armHide();
      }}
      onClick={onSurfaceTap}
      tabIndex={-1}
    >
      <video
        ref={videoRef as React.RefObject<HTMLVideoElement>}
        poster={poster ?? undefined}
        playsInline
        controls={false}
        preload="metadata"
        crossOrigin="anonymous"
        className="h-full w-full bg-black"
      />

      {/* Buffering spinner */}
      {(isBuffering || !state.ready) && !state.error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        </div>
      )}

      {/* Error overlay */}
      {state.error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 p-4 text-center">
          <p className="text-sm text-white/90">{state.error.message}</p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              retry();
            }}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg"
          >
            <RotateCcw className="h-4 w-4" aria-hidden /> Retry
          </button>
        </div>
      )}

      {/* Controls */}
      <div
        data-player-controls
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-3 text-white transition-opacity duration-200',
          showControls ? 'opacity-100' : 'opacity-0',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Scrub bar with buffered overlay */}
        <div className="relative h-4 pointer-events-auto" aria-hidden>
          <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/20">
            <div className="h-full rounded-full bg-white/35" style={{ width: `${bufferedPct}%` }} />
          </div>
          <div
            className="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
            style={{ width: `${playedPct}%` }}
          />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={position}
            onChange={onScrub}
            aria-label="Seek"
            className="relative h-4 w-full cursor-pointer appearance-none bg-transparent"
          />
        </div>

        <div className="pointer-events-auto flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => seek(-10)}
              aria-label="Back 10 seconds"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/15"
            >
              −10
            </button>
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-900 shadow"
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
            </button>
            <button
              type="button"
              onClick={() => seek(10)}
              aria-label="Forward 10 seconds"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/15"
            >
              +10
            </button>
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? 'Unmute' : 'Mute'}
              className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/15"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <span className="ml-2 tabular-nums text-white/90">
              {formatDuration(position)} / {formatDuration(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <PlaybackSpeedMenu current={rate} onChange={setPlaybackRate} />
            <QualitySelector
              levels={state.levels}
              currentLevel={state.currentLevel}
              onChange={setLevel}
            />
            <button
              type="button"
              onClick={enterFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/15"
            >
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
