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

/** Decorative screw rendered as an SVG circle with cross-slot */
function Screw({ cx, cy, r = 6 }: { cx: number; cy: number; r?: number }) {
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        className="fill-secondary stroke-border"
        strokeWidth={1}
      />
      <circle
        cx={cx}
        cy={cy}
        r={r - 2}
        className="fill-none stroke-muted-foreground/30"
        strokeWidth={0.5}
      />
      {/* Cross slot */}
      <line
        x1={cx - r * 0.45}
        y1={cy}
        x2={cx + r * 0.45}
        y2={cy}
        className="stroke-muted-foreground/50"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <line
        x1={cx}
        y1={cy - r * 0.45}
        x2={cx}
        y2={cy + r * 0.45}
        className="stroke-muted-foreground/50"
        strokeWidth={1}
        strokeLinecap="round"
      />
    </g>
  );
}

/** VU meter needle — tilts based on "level" (0–1) */
function VuMeter({
  x,
  y,
  width,
  height,
  level,
  label,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  level: number;
  label: string;
}) {
  // Needle angle: -45° (silence) to +45° (max)
  const angle = -45 + level * 90;
  const needlePivotX = x + width / 2;
  const needlePivotY = y + height - 4;
  const needleLen = height - 12;

  // Precompute needle end coordinates
  const needleRad = (angle * Math.PI) / 180;
  const needleEndX = needlePivotX + Math.sin(needleRad) * needleLen;
  const needleEndY = needlePivotY - Math.cos(needleRad) * needleLen;

  return (
    <g>
      {/* Meter background */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={3}
        className="fill-background stroke-border"
        strokeWidth={0.75}
      />
      {/* Inner shadow */}
      <rect
        x={x + 1.5}
        y={y + 1.5}
        width={width - 3}
        height={height - 3}
        rx={2}
        className="fill-none stroke-foreground/5"
        strokeWidth={0.5}
      />
      {/* Scale arc ticks */}
      {Array.from({ length: 9 }).map((_, i) => {
        const tickAngle = -45 + i * (90 / 8);
        const rad = (tickAngle * Math.PI) / 180;
        const innerR = needleLen - 6;
        const outerR = needleLen - 2;
        const isRed = i >= 7;
        return (
          <line
            key={i}
            x1={needlePivotX + Math.sin(rad) * innerR}
            y1={needlePivotY - Math.cos(rad) * innerR}
            x2={needlePivotX + Math.sin(rad) * outerR}
            y2={needlePivotY - Math.cos(rad) * outerR}
            className={isRed ? "stroke-destructive/70" : "stroke-muted-foreground/40"}
            strokeWidth={isRed ? 1.2 : 0.8}
            strokeLinecap="round"
          />
        );
      })}
      {/* Needle — CSS transition on the group transform for smooth movement */}
      <line
        x1={needlePivotX}
        y1={needlePivotY}
        x2={needleEndX}
        y2={needleEndY}
        className="stroke-foreground"
        strokeWidth={1}
        strokeLinecap="round"
      />
      {/* Pivot dot */}
      <circle cx={needlePivotX} cy={needlePivotY} r={2} className="fill-foreground" />
      {/* Label */}
      <text
        x={x + width / 2}
        y={y + height - 1}
        textAnchor="middle"
        className="fill-muted-foreground"
        style={{ fontSize: "5px", fontFamily: "monospace" }}
      >
        {label}
      </text>
    </g>
  );
}

/** Cassette tape reel — spins when playing */
function TapeReel({
  cx,
  cy,
  radius,
  isPlaying,
  spokes,
  animationDuration,
}: {
  cx: number;
  cy: number;
  radius: number;
  isPlaying: boolean;
  spokes: number;
  animationDuration: string;
}) {
  const spokeAngles = useMemo(
    () => Array.from({ length: spokes }, (_, i) => (360 / spokes) * i),
    [spokes],
  );

  return (
    <g
      style={{
        transformOrigin: `${cx}px ${cy}px`,
        animation: isPlaying
          ? `cassette-spin ${animationDuration} linear infinite`
          : "none",
      }}
    >
      {/* Outer ring */}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        className="fill-none stroke-foreground/20"
        strokeWidth={1.5}
      />
      {/* Gear teeth on outer ring */}
      {Array.from({ length: 24 }).map((_, i) => {
        const a = (i * 15 * Math.PI) / 180;
        const inner = radius - 1;
        const outer = radius + 1.5;
        return (
          <line
            key={`tooth-${i}`}
            x1={cx + Math.cos(a) * inner}
            y1={cy + Math.sin(a) * inner}
            x2={cx + Math.cos(a) * outer}
            y2={cy + Math.sin(a) * outer}
            className="stroke-foreground/15"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        );
      })}
      {/* Concentric rings */}
      <circle
        cx={cx}
        cy={cy}
        r={radius * 0.75}
        className="fill-none stroke-foreground/10"
        strokeWidth={0.5}
      />
      <circle
        cx={cx}
        cy={cy}
        r={radius * 0.5}
        className="fill-none stroke-foreground/10"
        strokeWidth={0.5}
      />
      {/* Hub */}
      <circle
        cx={cx}
        cy={cy}
        r={radius * 0.3}
        className="fill-secondary stroke-foreground/25"
        strokeWidth={1}
      />
      {/* Spokes */}
      {spokeAngles.map((angle) => {
        const rad = (angle * Math.PI) / 180;
        return (
          <line
            key={angle}
            x1={cx + Math.cos(rad) * (radius * 0.12)}
            y1={cy + Math.sin(rad) * (radius * 0.12)}
            x2={cx + Math.cos(rad) * (radius * 0.28)}
            y2={cy + Math.sin(rad) * (radius * 0.28)}
            className="stroke-foreground/30"
            strokeWidth={2}
            strokeLinecap="round"
          />
        );
      })}
      {/* Center dot */}
      <circle cx={cx} cy={cy} r={2} className="fill-foreground/40" />
    </g>
  );
}

/**
 * Custom hook: generates a smoothly oscillating VU level (0–1) driven by rAF.
 * Uses a tick counter to trigger renders; actual level is derived from the counter.
 */
function useVuLevel(isPlaying: boolean): number {
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);
  const tRef = useRef(0);

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      tRef.current = 0;
      // Schedule a state update on the next frame instead of synchronously
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
  // Combine two sine waves for organic needle movement
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

  // Tape reel sizes: left gets smaller, right gets bigger as progress increases
  const leftReelRadius = 28 - (vm.progress / 100) * 10;
  const rightReelRadius = 18 + (vm.progress / 100) * 10;

  // Left reel spins faster as it unwinds (smaller radius = faster RPM)
  const leftDuration = `${1.5 + (vm.progress / 100) * 1.5}s`;
  const rightDuration = `${3 - (vm.progress / 100) * 1.5}s`;

  return (
    <div className="flex flex-col gap-3 h-full select-none">
      {/* ── Cassette body ── */}
      <div className="relative flex-1 min-h-0">
        <svg
          viewBox="0 0 400 200"
          className="w-full h-full"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Cassette tape player"
        >
          <defs>
            {/* Spin animation */}
            <style>{`
              @keyframes cassette-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
              }
              @keyframes cassette-pulse {
                0%, 100% { opacity: 0.5; }
                50% { opacity: 1; }
              }
            `}</style>
            {/* Tape window gradient */}
            <linearGradient id="cassette-tape-window" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--foreground))" stopOpacity="0.06" />
              <stop offset="100%" stopColor="hsl(var(--foreground))" stopOpacity="0.02" />
            </linearGradient>
            {/* Cassette body gradient */}
            <linearGradient id="cassette-body-bg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--secondary))" stopOpacity="1" />
              <stop offset="100%" stopColor="hsl(var(--muted))" stopOpacity="1" />
            </linearGradient>
          </defs>

          {/* ── Outer chassis ── */}
          <rect
            x="4"
            y="4"
            width="392"
            height="192"
            rx="12"
            className="fill-none stroke-border"
            strokeWidth="1"
          />
          {/* Main body */}
          <rect
            x="6"
            y="6"
            width="388"
            height="188"
            rx="10"
            fill="url(#cassette-body-bg)"
          />
          {/* Inner bevel highlight */}
          <rect
            x="8"
            y="8"
            width="384"
            height="1"
            rx="0.5"
            className="fill-foreground/[0.04]"
          />

          {/* ── Corner screws ── */}
          <Screw cx={22} cy={22} r={5} />
          <Screw cx={378} cy={22} r={5} />
          <Screw cx={22} cy={178} r={5} />
          <Screw cx={378} cy={178} r={5} />

          {/* ── Brand / title label ── */}
          <rect
            x="140"
            y="12"
            width="120"
            height="18"
            rx="3"
            className="fill-foreground/[0.04] stroke-foreground/10"
            strokeWidth={0.5}
          />
          {title && (
            <text
              x="200"
              y="24"
              textAnchor="middle"
              className="fill-foreground/60"
              style={{
                fontSize: "7px",
                fontFamily: "monospace",
                letterSpacing: "0.5px",
              }}
            >
              {title.length > 22 ? title.slice(0, 22) + "..." : title}
            </text>
          )}

          {/* ── "LYRE" brand text ── */}
          <text
            x="200"
            y="44"
            textAnchor="middle"
            className="fill-foreground/20"
            style={{
              fontSize: "8px",
              fontWeight: 700,
              fontFamily: "monospace",
              letterSpacing: "4px",
            }}
          >
            LYRE
          </text>

          {/* ── VU Meters ── */}
          <VuMeter x={42} y={14} width={44} height={30} level={vuLevel} label="L" />
          <VuMeter x={314} y={14} width={44} height={30} level={vuLevel * 0.85} label="R" />

          {/* ── Decorative lines / texture (left of label) ── */}
          {Array.from({ length: 5 }).map((_, i) => (
            <line
              key={`deco-line-${i}`}
              x1={100 + i * 4}
              y1={16}
              x2={100 + i * 4}
              y2={32}
              className="stroke-foreground/[0.06]"
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: 5 }).map((_, i) => (
            <line
              key={`deco-line-r-${i}`}
              x1={280 + i * 4}
              y1={16}
              x2={280 + i * 4}
              y2={32}
              className="stroke-foreground/[0.06]"
              strokeWidth={1}
            />
          ))}

          {/* ── Tape window ── */}
          <rect
            x="60"
            y="55"
            width="280"
            height="100"
            rx="8"
            fill="url(#cassette-tape-window)"
            className="stroke-border"
            strokeWidth={1}
          />
          {/* Inner window border */}
          <rect
            x="64"
            y="59"
            width="272"
            height="92"
            rx="6"
            className="fill-background/60 stroke-foreground/10"
            strokeWidth={0.5}
          />

          {/* ── Tape ribbon between reels ── */}
          <path
            d={`M ${130 + leftReelRadius} 105 Q 200 ${85 + (vm.progress / 100) * 15} ${270 - rightReelRadius} 105`}
            className="fill-none stroke-foreground/20"
            strokeWidth={2}
          />
          {/* Bottom tape path */}
          <path
            d={`M ${130 + leftReelRadius} 105 Q 200 ${125 - (vm.progress / 100) * 15} ${270 - rightReelRadius} 105`}
            className="fill-none stroke-foreground/10"
            strokeWidth={1.5}
          />

          {/* ── Tape reels ── */}
          <TapeReel
            cx={130}
            cy={105}
            radius={leftReelRadius}
            isPlaying={isPlaying}
            spokes={6}
            animationDuration={leftDuration}
          />
          <TapeReel
            cx={270}
            cy={105}
            radius={rightReelRadius}
            isPlaying={isPlaying}
            spokes={6}
            animationDuration={rightDuration}
          />

          {/* ── Tape guide posts ── */}
          <circle cx={90} cy={130} r={3} className="fill-secondary stroke-foreground/20" strokeWidth={0.75} />
          <circle cx={310} cy={130} r={3} className="fill-secondary stroke-foreground/20" strokeWidth={0.75} />

          {/* ── Head assembly (bottom center) ── */}
          <rect
            x="175"
            y="128"
            width="50"
            height="14"
            rx="2"
            className="fill-foreground/[0.06] stroke-foreground/15"
            strokeWidth={0.5}
          />
          {/* Head pins */}
          <rect x="185" y="130" width="3" height="10" rx="1" className="fill-foreground/15" />
          <rect x="195" y="129" width="5" height="12" rx="1" className="fill-foreground/10 stroke-foreground/15" strokeWidth={0.3} />
          <rect x="207" y="130" width="3" height="10" rx="1" className="fill-foreground/15" />

          {/* ── Decorative dots / perforations (left edge) ── */}
          {Array.from({ length: 8 }).map((_, i) => (
            <circle
              key={`perf-l-${i}`}
              cx={30}
              cy={60 + i * 12}
              r={1.5}
              className="fill-foreground/[0.06]"
            />
          ))}
          {/* ── Decorative dots / perforations (right edge) ── */}
          {Array.from({ length: 8 }).map((_, i) => (
            <circle
              key={`perf-r-${i}`}
              cx={370}
              cy={60 + i * 12}
              r={1.5}
              className="fill-foreground/[0.06]"
            />
          ))}

          {/* ── Bottom edge detail: ribbed texture ── */}
          {Array.from({ length: 40 }).map((_, i) => (
            <line
              key={`rib-${i}`}
              x1={60 + i * 7}
              y1={162}
              x2={60 + i * 7}
              y2={168}
              className="stroke-foreground/[0.05]"
              strokeWidth={1}
            />
          ))}

          {/* ── Type indicator ── */}
          <rect
            x="155"
            y="165"
            width="90"
            height="14"
            rx="3"
            className="fill-foreground/[0.03] stroke-foreground/[0.08]"
            strokeWidth={0.5}
          />
          <text
            x="200"
            y="175"
            textAnchor="middle"
            className="fill-muted-foreground/50"
            style={{ fontSize: "6px", fontFamily: "monospace", letterSpacing: "1px" }}
          >
            TYPE I · NORMAL
          </text>

          {/* ── Decorative disc icons (pure SVG) ── */}
          <g className="stroke-foreground/[0.08]" strokeWidth={0.8} fill="none">
            <circle cx={98} cy={20} r={5} />
            <circle cx={98} cy={20} r={2} />
            <circle cx={302} cy={20} r={5} />
            <circle cx={302} cy={20} r={2} />
          </g>

          {/* ── Recording indicator dot (blinks when playing) ── */}
          {isPlaying && (
            <circle
              cx="135"
              cy="22"
              r="3"
              className="fill-destructive"
              style={{ animation: "cassette-pulse 1s ease-in-out infinite" }}
            />
          )}
        </svg>
      </div>

      {/* ── Transport controls panel ── */}
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

        {/* Time + controls row */}
        <div className="flex items-center gap-2">
          {/* Current time */}
          <span className="min-w-[4ch] text-xs tabular-nums text-muted-foreground font-mono">
            {vm.currentTimeDisplay}
          </span>

          {/* Central transport controls */}
          <div className="flex flex-1 items-center justify-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={onSkipBack}
              aria-label="Skip back 10 seconds"
            >
              <SkipBack className="h-4 w-4" strokeWidth={1.5} />
            </Button>

            {/* Play/Pause — large with press feedback */}
            <button
              className={`
                flex h-10 w-10 items-center justify-center rounded-full
                border-2 border-foreground/20
                bg-foreground text-background
                shadow-md
                transition-all duration-150
                hover:scale-105 hover:shadow-lg
                active:scale-90 active:shadow-sm
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

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={onSkipForward}
              aria-label="Skip forward 10 seconds"
            >
              <SkipForward className="h-4 w-4" strokeWidth={1.5} />
            </Button>
          </div>

          {/* Right side: speed + volume + duration */}
          <div className="flex items-center gap-1.5">
            {/* Speed */}
            <Button
              variant="secondary"
              size="sm"
              className="h-6 min-w-[3rem] px-2 text-xs tabular-nums font-mono border border-border"
              onClick={onSpeedCycle}
              aria-label={`Playback speed ${vm.speedDisplay}`}
            >
              {vm.speedDisplay}
            </Button>

            {/* Volume toggle */}
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

            {/* Volume slider */}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              className="h-1 w-14 cursor-pointer appearance-none rounded-full bg-muted accent-foreground
                [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground
                [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:border-0"
              aria-label="Volume"
            />

            {/* Duration */}
            <span className="min-w-[4ch] text-right text-xs tabular-nums text-muted-foreground font-mono">
              {vm.durationDisplay}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
