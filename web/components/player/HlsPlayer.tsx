'use client';

import { useEffect, useRef, useState } from 'react';
import { Maximize, Pause, Play, RotateCcw } from 'lucide-react';
import { useHls } from '@/hooks/use-hls';
import { cn } from '@/lib/utils/cn';
import { formatDuration } from '@/lib/utils/format';
import QualitySelector from './QualitySelector';

interface Props {
  src: string | null;
  poster?: string | null;
  className?: string;
}

const CONTROLS_TIMEOUT_MS = 2500;

export default function HlsPlayer({ src, poster, className }: Props) {
  const { videoRef, state, setLevel, retry } = useHls(src);

  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Keep transient UI state in sync with the <video> element.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => setPosition(v.currentTime || 0);
    const onLoaded = () => setDuration(v.duration || 0);
    const onWait = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onLoaded);
    v.addEventListener('durationchange', onLoaded);
    v.addEventListener('waiting', onWait);
    v.addEventListener('playing', onPlaying);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onLoaded);
      v.removeEventListener('durationchange', onLoaded);
      v.removeEventListener('waiting', onWait);
      v.removeEventListener('playing', onPlaying);
    };
  }, [videoRef]);

  const armHide = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setShowControls(false);
    }, CONTROLS_TIMEOUT_MS);
  };

  const handleSurfaceTap = () => {
    setShowControls((v) => !v);
    armHide();
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

  const enterFullscreen = async () => {
    const el = containerRef.current;
    const v = videoRef.current;
    try {
      // iOS Safari path: <video> only supports its own native fullscreen.
      // @ts-expect-error iOS-only
      if (v && typeof v.webkitEnterFullscreen === 'function') {
        // @ts-expect-error iOS-only
        v.webkitEnterFullscreen();
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

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative aspect-video w-full overflow-hidden rounded-xl bg-black no-select',
        className,
      )}
      onMouseMove={() => {
        setShowControls(true);
        armHide();
      }}
      onClick={handleSurfaceTap}
    >
      <video
        ref={videoRef as React.Ref<HTMLVideoElement>}
        poster={poster ?? undefined}
        playsInline
        controls={false}
        preload="metadata"
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
          <p className="text-sm text-fg/90">{state.error.message}</p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              retry();
            }}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg"
          >
            <RotateCcw className="h-4 w-4" aria-hidden /> Retry
          </button>
        </div>
      )}

      {/* Controls */}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/80 to-transparent p-3 transition-opacity duration-200',
          showControls ? 'opacity-100' : 'opacity-0',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Scrub bar */}
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={position}
          onChange={onScrub}
          aria-label="Seek"
          className="pointer-events-auto h-1 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-accent"
        />

        <div className="pointer-events-auto flex items-center justify-between gap-2 text-xs text-white">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => seek(-10)}
              aria-label="Back 10 seconds"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/10"
            >
              −10
            </button>
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-black"
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={() => seek(10)}
              aria-label="Forward 10 seconds"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/10"
            >
              +10
            </button>
            <span className="ml-2 tabular-nums">
              {formatDuration(position)} / {formatDuration(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <QualitySelector
              levels={state.levels}
              currentLevel={state.currentLevel}
              onChange={setLevel}
            />
            <button
              type="button"
              onClick={enterFullscreen}
              aria-label="Fullscreen"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/10"
            >
              <Maximize className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
