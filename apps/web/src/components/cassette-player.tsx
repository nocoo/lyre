"use client";

import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import type { AudioPlayerVM } from "@/lib/audio-player-vm";

interface CassettePlayerProps {
  title?: string | undefined;
  isPlaying: boolean;
  vm: AudioPlayerVM;
  volume: number;
  isMuted: boolean;
  onTogglePlay: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  onSpeedCycle: () => void;
  onProgressClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
}

const COVER_URL = "https://s.zhe.to/dcd0e6e42358/20260222/4e6c5790-1868-4224-bacb-3ba795ecd1fb.jpg";

export function CassettePlayer({
  title,
  isPlaying,
  vm,
  volume,
  isMuted,
  onTogglePlay,
  onSkipBack,
  onSkipForward,
  onSpeedCycle,
  onProgressClick,
  onVolumeChange,
  onToggleMute,
  progressBarRef,
}: CassettePlayerProps) {
  return (
    <div className="flex flex-col gap-3 h-full select-none">
      {/* ── Cover art panel — fills remaining height from container ── */}
      <div className="relative flex-1 min-h-0 rounded-lg overflow-hidden border border-border">
        {/* Background image */}
        <Image
          src={COVER_URL}
          alt=""
          fill
          className="object-cover"
          draggable={false}
          priority
        />

        {/* Title overlay — bottom-aligned with ink-bleed gradient backdrop */}
        {title && (
          <div className="absolute inset-x-0 bottom-0 flex items-end">
            {/* Ink-bleed gradient: transparent top → dense black bottom, height follows text */}
            <div className="w-full px-4 pb-3 pt-10 bg-gradient-to-t from-black/80 via-black/50 to-transparent">
              <p className="text-sm font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] line-clamp-2 leading-snug">
                {title}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Transport controls ── */}
      <div className="rounded-lg bg-secondary/80 border border-border p-3 space-y-2.5">
        {/* Progress bar */}
        <div
          ref={progressBarRef}
          className="group relative h-2 cursor-pointer rounded-full bg-muted"
          onClick={onProgressClick}
          role="slider"
          aria-label="Audio progress"
          aria-valuenow={Math.round(vm.progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-foreground transition-[width] duration-75"
            style={{ width: `${vm.progress}%` }}
          />
          <div
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground bg-background opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
            style={{ left: `${vm.progress}%` }}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-2">
          <span className="min-w-[4ch] text-xs tabular-nums text-muted-foreground font-mono">
            {vm.currentTimeDisplay}
          </span>

          <div className="flex flex-1 items-center justify-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={onSkipBack} aria-label="Skip back 10 seconds">
              <SkipBack className="h-4 w-4" strokeWidth={1.5} />
            </Button>

            <button
              className={`
                flex h-10 w-10 items-center justify-center rounded-full
                border-2 border-foreground/20 bg-foreground text-background shadow-md
                transition-all duration-150
                hover:scale-105 hover:shadow-lg active:scale-90 active:shadow-sm
                ${isPlaying ? "ring-2 ring-foreground/20 ring-offset-2 ring-offset-secondary" : ""}
              `}
              onClick={onTogglePlay}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="h-4.5 w-4.5" strokeWidth={2.5} />
              ) : (
                <Play className="h-4.5 w-4.5 ml-0.5" strokeWidth={2.5} />
              )}
            </button>

            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={onSkipForward} aria-label="Skip forward 10 seconds">
              <SkipForward className="h-4 w-4" strokeWidth={1.5} />
            </Button>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="secondary" size="sm"
              className="h-6 min-w-[3rem] px-2 text-xs tabular-nums font-mono border border-border"
              onClick={onSpeedCycle}
              aria-label={`Playback speed ${vm.speedDisplay}`}
            >
              {vm.speedDisplay}
            </Button>

            <button
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
              onClick={onToggleMute}
              aria-label={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="h-3.5 w-3.5" strokeWidth={1.5} />
              ) : (
                <Volume2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
            </button>

            <input
              type="range" min={0} max={1} step={0.05}
              value={isMuted ? 0 : volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              className="h-1 w-14 cursor-pointer appearance-none rounded-full bg-muted accent-foreground
                [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground
                [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:border-0"
              aria-label="Volume"
            />

            <span className="min-w-[4ch] text-right text-xs tabular-nums text-muted-foreground font-mono">
              {vm.durationDisplay}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
