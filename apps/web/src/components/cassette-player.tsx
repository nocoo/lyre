"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AudioPlayerVM } from "@/lib/audio-player-vm";

/* ── SVG sub-components ── */

/** Decorative screw with cross-slot */
function Screw({ cx, cy, r = 5 }: { cx: number; cy: number; r?: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} className="fill-secondary stroke-border" strokeWidth={0.8} />
      <circle cx={cx} cy={cy} r={r - 1.5} className="fill-none stroke-muted-foreground/25" strokeWidth={0.4} />
      <line x1={cx - r * 0.4} y1={cy} x2={cx + r * 0.4} y2={cy} className="stroke-muted-foreground/40" strokeWidth={0.8} strokeLinecap="round" />
      <line x1={cx} y1={cy - r * 0.4} x2={cx} y2={cy + r * 0.4} className="stroke-muted-foreground/40" strokeWidth={0.8} strokeLinecap="round" />
    </g>
  );
}

/** VU meter with arc scale + needle */
function VuMeter({
  x, y, width, height, level, label,
}: {
  x: number; y: number; width: number; height: number; level: number; label: string;
}) {
  const angle = -45 + level * 90;
  const pivotX = x + width / 2;
  const pivotY = y + height - 3;
  const needleLen = height - 10;
  const rad = (angle * Math.PI) / 180;

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={2.5} className="fill-background stroke-border" strokeWidth={0.6} />
      {/* Scale ticks */}
      {Array.from({ length: 9 }).map((_, i) => {
        const a = -45 + i * (90 / 8);
        const r = (a * Math.PI) / 180;
        const r0 = needleLen - 4;
        const r1 = needleLen - 1;
        return (
          <line
            key={i}
            x1={pivotX + Math.sin(r) * r0} y1={pivotY - Math.cos(r) * r0}
            x2={pivotX + Math.sin(r) * r1} y2={pivotY - Math.cos(r) * r1}
            className={i >= 7 ? "stroke-destructive/60" : "stroke-muted-foreground/35"}
            strokeWidth={i >= 7 ? 1 : 0.6} strokeLinecap="round"
          />
        );
      })}
      {/* Needle */}
      <line
        x1={pivotX} y1={pivotY}
        x2={pivotX + Math.sin(rad) * needleLen}
        y2={pivotY - Math.cos(rad) * needleLen}
        className="stroke-foreground" strokeWidth={0.8} strokeLinecap="round"
      />
      <circle cx={pivotX} cy={pivotY} r={1.5} className="fill-foreground" />
      <text x={x + width / 2} y={y + height - 0.5} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: "4px", fontFamily: "monospace" }}>{label}</text>
    </g>
  );
}

/** Gear/reel that spins during playback */
function Gear({
  cx, cy, radius, isPlaying, spokes, duration,
}: {
  cx: number; cy: number; radius: number; isPlaying: boolean; spokes: number; duration: string;
}) {
  const angles = useMemo(
    () => Array.from({ length: spokes }, (_, i) => (360 / spokes) * i),
    [spokes],
  );
  const teeth = 20;

  return (
    <g style={{
      transformOrigin: `${cx}px ${cy}px`,
      animation: isPlaying ? `cassette-spin ${duration} linear infinite` : "none",
    }}>
      {/* Teeth */}
      {Array.from({ length: teeth }).map((_, i) => {
        const a = (i * (360 / teeth) * Math.PI) / 180;
        return (
          <line key={i}
            x1={cx + Math.cos(a) * (radius - 0.8)} y1={cy + Math.sin(a) * (radius - 0.8)}
            x2={cx + Math.cos(a) * (radius + 1.2)} y2={cy + Math.sin(a) * (radius + 1.2)}
            className="stroke-foreground/15" strokeWidth={1.2} strokeLinecap="round"
          />
        );
      })}
      {/* Rings */}
      <circle cx={cx} cy={cy} r={radius} className="fill-none stroke-foreground/20" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={radius * 0.7} className="fill-none stroke-foreground/10" strokeWidth={0.4} />
      <circle cx={cx} cy={cy} r={radius * 0.45} className="fill-none stroke-foreground/10" strokeWidth={0.4} />
      {/* Hub */}
      <circle cx={cx} cy={cy} r={radius * 0.28} className="fill-secondary stroke-foreground/20" strokeWidth={0.8} />
      {/* Spokes */}
      {angles.map((angle) => {
        const r = (angle * Math.PI) / 180;
        return (
          <line key={angle}
            x1={cx + Math.cos(r) * (radius * 0.1)} y1={cy + Math.sin(r) * (radius * 0.1)}
            x2={cx + Math.cos(r) * (radius * 0.26)} y2={cy + Math.sin(r) * (radius * 0.26)}
            className="stroke-foreground/25" strokeWidth={1.5} strokeLinecap="round"
          />
        );
      })}
      <circle cx={cx} cy={cy} r={1.5} className="fill-foreground/35" />
    </g>
  );
}

/** Smoothly oscillating VU level hook (rAF-driven) */
function useVuLevel(isPlaying: boolean): number {
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);
  const tRef = useRef(0);

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      tRef.current = 0;
      const id = requestAnimationFrame(() => setTick(0));
      return () => cancelAnimationFrame(id);
    }
    const animate = () => {
      tRef.current += 0.03;
      setTick(tRef.current);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [isPlaying]);

  if (!isPlaying && tick === 0) return 0;
  return Math.max(0, Math.min(1, 0.35 + 0.2 * Math.sin(tick * 2.7) + 0.15 * Math.sin(tick * 4.3)));
}

/* ── Main component ── */

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
  const vuLevel = useVuLevel(isPlaying);

  // Gear sizes shift with progress (left shrinks, right grows)
  const leftR = 22 - (vm.progress / 100) * 7;
  const rightR = 15 + (vm.progress / 100) * 7;
  const leftDur = `${1.5 + (vm.progress / 100) * 1.5}s`;
  const rightDur = `${3 - (vm.progress / 100) * 1.5}s`;

  return (
    <div className="flex flex-col gap-3 h-full select-none">
      {/* ── Decorative panel — fills remaining height from container ── */}
      <div className="relative flex-1 min-h-0 rounded-lg bg-secondary/60 border border-border overflow-hidden">
        <svg
          viewBox="0 0 400 100"
          className="w-full h-full"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <defs>
            <style>{`
              @keyframes cassette-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
              }
              @keyframes cassette-pulse {
                0%, 100% { opacity: 0.4; }
                50% { opacity: 1; }
              }
            `}</style>
          </defs>

          {/* Corner screws */}
          <Screw cx={12} cy={12} r={4} />
          <Screw cx={388} cy={12} r={4} />
          <Screw cx={12} cy={88} r={4} />
          <Screw cx={388} cy={88} r={4} />

          {/* VU meters — compact */}
          <VuMeter x={24} y={8} width={36} height={24} level={vuLevel} label="L" />
          <VuMeter x={340} y={8} width={36} height={24} level={vuLevel * 0.85} label="R" />

          {/* Decorative line groups flanking the title */}
          {Array.from({ length: 4 }).map((_, i) => (
            <line key={`dl-${i}`} x1={76 + i * 3.5} y1={12} x2={76 + i * 3.5} y2={26} className="stroke-foreground/[0.06]" strokeWidth={0.8} />
          ))}
          {Array.from({ length: 4 }).map((_, i) => (
            <line key={`dr-${i}`} x1={310 + i * 3.5} y1={12} x2={310 + i * 3.5} y2={26} className="stroke-foreground/[0.06]" strokeWidth={0.8} />
          ))}

          {/* Title label */}
          <rect x="120" y="8" width="160" height="16" rx="2.5" className="fill-foreground/[0.03] stroke-foreground/[0.08]" strokeWidth={0.4} />
          {title && (
            <text x="200" y="19" textAnchor="middle" className="fill-foreground/50" style={{ fontSize: "6px", fontFamily: "monospace", letterSpacing: "0.3px" }}>
              {title.length > 28 ? title.slice(0, 28) + "..." : title}
            </text>
          )}

          {/* LYRE brand */}
          <text x="200" y="38" textAnchor="middle" className="fill-foreground/15" style={{ fontSize: "7px", fontWeight: 700, fontFamily: "monospace", letterSpacing: "3px" }}>
            LYRE
          </text>

          {/* ── Gears ── */}
          <Gear cx={120} cy={62} radius={leftR} isPlaying={isPlaying} spokes={6} duration={leftDur} />
          <Gear cx={280} cy={62} radius={rightR} isPlaying={isPlaying} spokes={6} duration={rightDur} />

          {/* Axle dots connecting gears visually */}
          <circle cx={120} cy={62} r={1} className="fill-foreground/20" />
          <circle cx={280} cy={62} r={1} className="fill-foreground/20" />

          {/* Decorative connector line between gears */}
          <line x1={120 + leftR + 3} y1={62} x2={280 - rightR - 3} y2={62} className="stroke-foreground/[0.06]" strokeWidth={0.5} strokeDasharray="2 3" />

          {/* Side perforation dots */}
          {Array.from({ length: 4 }).map((_, i) => (
            <circle key={`pl-${i}`} cx={8} cy={38 + i * 10} r={1.2} className="fill-foreground/[0.05]" />
          ))}
          {Array.from({ length: 4 }).map((_, i) => (
            <circle key={`pr-${i}`} cx={392} cy={38 + i * 10} r={1.2} className="fill-foreground/[0.05]" />
          ))}

          {/* Bottom ribbed texture */}
          {Array.from({ length: 30 }).map((_, i) => (
            <line key={`rib-${i}`} x1={70 + i * 8.7} y1={88} x2={70 + i * 8.7} y2={93} className="stroke-foreground/[0.04]" strokeWidth={0.8} />
          ))}

          {/* Type label */}
          <rect x="170" y="85" width="60" height="10" rx="2" className="fill-foreground/[0.02] stroke-foreground/[0.06]" strokeWidth={0.3} />
          <text x="200" y="92" textAnchor="middle" className="fill-muted-foreground/40" style={{ fontSize: "4.5px", fontFamily: "monospace", letterSpacing: "0.8px" }}>
            TYPE I
          </text>

          {/* Disc decoration near VU meters */}
          <g className="stroke-foreground/[0.07]" strokeWidth={0.6} fill="none">
            <circle cx={68} cy={18} r={4} />
            <circle cx={68} cy={18} r={1.5} />
            <circle cx={332} cy={18} r={4} />
            <circle cx={332} cy={18} r={1.5} />
          </g>

          {/* Recording indicator */}
          {isPlaying && (
            <circle cx="100" cy="18" r="2.5" className="fill-destructive" style={{ animation: "cassette-pulse 1s ease-in-out infinite" }} />
          )}
        </svg>
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
