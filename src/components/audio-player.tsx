"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  toAudioPlayerVM,
  cyclePlaybackSpeed,
  progressToTime,
  type PlaybackSpeed,
} from "@/lib/audio-player-vm";

export interface AudioPlayerHandle {
  seekTo: (timeInSeconds: number) => void;
}

interface AudioPlayerProps {
  /** URL of the audio file */
  src: string;
  /** Title displayed above the player */
  title?: string;
  /** Called on each time update with current time in seconds */
  onTimeUpdate?: (currentTime: number) => void;
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  function AudioPlayer({ src, title, onTimeUpdate }, ref) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const progressBarRef = useRef<HTMLDivElement>(null);
    const rafRef = useRef<number | null>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [speed, setSpeed] = useState<PlaybackSpeed>(1);

    const vm = toAudioPlayerVM(currentTime, duration, speed);

    // Expose seekTo via ref
    useImperativeHandle(ref, () => ({
      seekTo: (time: number) => {
        if (audioRef.current) {
          audioRef.current.currentTime = time;
          setCurrentTime(time);
        }
      },
    }));

    // Smooth progress animation via requestAnimationFrame
    useEffect(() => {
      if (!isPlaying) {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        return;
      }

      const tick = () => {
        if (audioRef.current) {
          const time = audioRef.current.currentTime;
          setCurrentTime(time);
          onTimeUpdate?.(time);
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);

      return () => {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
    }, [isPlaying, onTimeUpdate]);

    // Audio event handlers
    const handleLoadedMetadata = useCallback(() => {
      if (audioRef.current) {
        setDuration(audioRef.current.duration);
      }
    }, []);

    const handleEnded = useCallback(() => {
      setIsPlaying(false);
      // Final sync to ensure we're at the end
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
      }
    }, []);

    // Playback controls
    const togglePlay = useCallback(() => {
      if (!audioRef.current) return;
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        void audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }, [isPlaying]);

    const skipBack = useCallback(() => {
      if (audioRef.current) {
        audioRef.current.currentTime = Math.max(
          0,
          audioRef.current.currentTime - 10,
        );
        setCurrentTime(audioRef.current.currentTime);
      }
    }, []);

    const skipForward = useCallback(() => {
      if (audioRef.current) {
        audioRef.current.currentTime = Math.min(
          duration,
          audioRef.current.currentTime + 10,
        );
        setCurrentTime(audioRef.current.currentTime);
      }
    }, [duration]);

    const handleSpeedCycle = useCallback(() => {
      const nextSpeed = cyclePlaybackSpeed(speed);
      setSpeed(nextSpeed);
      if (audioRef.current) {
        audioRef.current.playbackRate = nextSpeed;
      }
    }, [speed]);

    // Seek via progress bar click
    const handleProgressClick = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (!progressBarRef.current || !audioRef.current) return;
        const rect = progressBarRef.current.getBoundingClientRect();
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        const newTime = progressToTime(pct, duration);
        audioRef.current.currentTime = newTime;
        setCurrentTime(newTime);
      },
      [duration],
    );

    // Sync playback rate when speed changes
    useEffect(() => {
      if (audioRef.current) {
        audioRef.current.playbackRate = speed;
      }
    }, [speed]);

    return (
      <div className="rounded-xl border border-border bg-card p-4">
        {/* Hidden audio element */}
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
        />

        {/* Title */}
        {title && (
          <p className="mb-3 text-sm font-medium text-foreground truncate">
            {title}
          </p>
        )}

        {/* Progress bar */}
        <div
          ref={progressBarRef}
          className="group relative mb-3 h-1.5 cursor-pointer rounded-full bg-secondary"
          onClick={handleProgressClick}
          role="slider"
          aria-label="Audio progress"
          aria-valuenow={Math.round(vm.progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-foreground"
            style={{ width: `${vm.progress}%` }}
          />
          {/* Thumb */}
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
            style={{ left: `${vm.progress}%` }}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-2">
          {/* Time display */}
          <span className="min-w-[4ch] text-xs tabular-nums text-muted-foreground">
            {vm.currentTimeDisplay}
          </span>

          {/* Playback controls */}
          <div className="flex flex-1 items-center justify-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={skipBack}
              aria-label="Skip back 10 seconds"
            >
              <SkipBack className="h-4 w-4" strokeWidth={1.5} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={togglePlay}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="h-5 w-5" strokeWidth={1.5} />
              ) : (
                <Play className="h-5 w-5 ml-0.5" strokeWidth={1.5} />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={skipForward}
              aria-label="Skip forward 10 seconds"
            >
              <SkipForward className="h-4 w-4" strokeWidth={1.5} />
            </Button>
          </div>

          {/* Speed + duration */}
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="h-6 min-w-[3rem] px-2 text-xs tabular-nums"
              onClick={handleSpeedCycle}
              aria-label={`Playback speed ${vm.speedDisplay}`}
            >
              {vm.speedDisplay}
            </Button>
            <span className="min-w-[4ch] text-right text-xs tabular-nums text-muted-foreground">
              {vm.durationDisplay}
            </span>
          </div>
        </div>
      </div>
    );
  },
);
