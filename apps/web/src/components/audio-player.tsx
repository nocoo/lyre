import { Button } from "@nocoo/basalt";
import { LayerCard } from "@nocoo/basalt/components/layer-card";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { CassettePlayer } from "@/components/cassette-player";
import {
	cyclePlaybackSpeed,
	type PlaybackSpeed,
	progressToTime,
	toAudioPlayerVM,
} from "@/lib/audio-player-vm";

export interface AudioPlayerHandle {
	seekTo: (timeInSeconds: number) => void;
}

interface AudioPlayerProps {
	/** URL of the audio file. When omitted the cassette UI still renders. */
	src?: string;
	/** Title displayed above the player */
	title?: string;
	/** Fallback duration in seconds when the audio file is not loaded */
	durationSeconds?: number;
	/** Called on each time update with current time in seconds */
	onTimeUpdate?: (currentTime: number) => void;
	/** "standalone" wraps in a card; "embedded" renders borderless for nesting */
	variant?: "standalone" | "embedded";
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer(
	{ src, title, durationSeconds, onTimeUpdate, variant = "standalone" },
	ref,
) {
	const audioRef = useRef<HTMLAudioElement>(null);
	const progressBarRef = useRef<HTMLDivElement>(null);
	const rafRef = useRef<number | null>(null);

	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(durationSeconds ?? 0);
	const [speed, setSpeed] = useState<PlaybackSpeed>(1);
	const [volume, setVolume] = useState(1);
	const [isMuted, setIsMuted] = useState(false);

	const vm = toAudioPlayerVM(currentTime, duration, speed);

	useEffect(() => {
		if (durationSeconds != null && durationSeconds > 0 && !src) {
			setDuration(durationSeconds);
		}
	}, [durationSeconds, src]);

	// Expose seekTo via ref
	useImperativeHandle(ref, () => ({
		seekTo: (time: number) => {
			if (audioRef.current) {
				audioRef.current.currentTime = time;
			}
			setCurrentTime(time);
			onTimeUpdate?.(time);
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
		if (!audioRef.current || !src) return;
		if (isPlaying) {
			audioRef.current.pause();
		} else {
			void audioRef.current.play();
		}
		setIsPlaying(!isPlaying);
	}, [isPlaying, src]);

	const skipBack = useCallback(() => {
		const next = Math.max(0, (audioRef.current?.currentTime ?? currentTime) - 10);
		if (audioRef.current) {
			audioRef.current.currentTime = next;
		}
		setCurrentTime(next);
		onTimeUpdate?.(next);
	}, [currentTime, onTimeUpdate]);

	const skipForward = useCallback(() => {
		const next = Math.min(duration, (audioRef.current?.currentTime ?? currentTime) + 10);
		if (audioRef.current) {
			audioRef.current.currentTime = next;
		}
		setCurrentTime(next);
		onTimeUpdate?.(next);
	}, [currentTime, duration, onTimeUpdate]);

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
			if (!progressBarRef.current) return;
			const rect = progressBarRef.current.getBoundingClientRect();
			const pct = ((e.clientX - rect.left) / rect.width) * 100;
			const newTime = progressToTime(pct, duration);
			if (audioRef.current) {
				audioRef.current.currentTime = newTime;
			}
			setCurrentTime(newTime);
			onTimeUpdate?.(newTime);
		},
		[duration, onTimeUpdate],
	);

	// Keyboard seek: Left/Right = ±5s, Home/End = start/end
	const handleProgressKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLDivElement>) => {
			const step = 5;
			const from = audioRef.current?.currentTime ?? currentTime;
			let next = from;
			let handled = true;
			switch (e.key) {
				case "ArrowLeft":
					next = Math.max(0, from - step);
					break;
				case "ArrowRight":
					next = Math.min(duration, from + step);
					break;
				case "Home":
					next = 0;
					break;
				case "End":
					next = duration;
					break;
				default:
					handled = false;
			}
			if (handled) {
				e.preventDefault();
				if (audioRef.current) {
					audioRef.current.currentTime = next;
				}
				setCurrentTime(next);
				onTimeUpdate?.(next);
			}
		},
		[currentTime, duration, onTimeUpdate],
	);

	// Volume controls
	const handleVolumeChange = useCallback((v: number) => {
		setVolume(v);
		setIsMuted(v === 0);
		if (audioRef.current) {
			audioRef.current.volume = v;
			audioRef.current.muted = v === 0;
		}
	}, []);

	const handleToggleMute = useCallback(() => {
		const next = !isMuted;
		setIsMuted(next);
		if (audioRef.current) {
			audioRef.current.muted = next;
		}
	}, [isMuted]);

	// Sync playback rate when speed changes
	useEffect(() => {
		if (audioRef.current) {
			audioRef.current.playbackRate = speed;
		}
	}, [speed]);

	const isEmbedded = variant === "embedded";

	const content = (
		<>
			{src ? (
				/* biome-ignore lint/a11y/useMediaCaption: user-uploaded recordings have no separate caption track; transcripts are rendered via <TranscriptViewer> */
				<audio
					ref={audioRef}
					src={src}
					preload="metadata"
					onLoadedMetadata={handleLoadedMetadata}
					onEnded={handleEnded}
				/>
			) : null}

			{/* ── Embedded: cassette-style player ── */}
			{isEmbedded ? (
				<CassettePlayer
					title={title}
					isPlaying={isPlaying}
					vm={vm}
					volume={volume}
					isMuted={isMuted}
					onTogglePlay={togglePlay}
					onSkipBack={skipBack}
					onSkipForward={skipForward}
					onSpeedCycle={handleSpeedCycle}
					onProgressClick={handleProgressClick}
					onProgressKeyDown={handleProgressKeyDown}
					onVolumeChange={handleVolumeChange}
					onToggleMute={handleToggleMute}
					progressBarRef={progressBarRef}
				/>
			) : (
				/* ── Standalone: original compact layout ── */
				<>
					{title && (
						<p className="mb-3 text-sm font-medium text-basalt-foreground truncate">{title}</p>
					)}
					<div
						ref={progressBarRef}
						className="group relative mb-3 h-1.5 cursor-pointer rounded-full bg-basalt-secondary"
						onClick={handleProgressClick}
						onKeyDown={handleProgressKeyDown}
						role="slider"
						aria-label="Audio progress"
						aria-valuenow={Math.round(vm.progress)}
						aria-valuemin={0}
						aria-valuemax={100}
						tabIndex={0}
					>
						<div
							className="absolute inset-y-0 left-0 rounded-full bg-basalt-foreground"
							style={{ width: `${vm.progress}%` }}
						/>
						<div
							className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-basalt-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
							style={{ left: `${vm.progress}%` }}
						/>
					</div>
					<div className="flex items-center gap-2">
						<span className="min-w-[4ch] text-xs tabular-nums text-basalt-muted-foreground">
							{vm.currentTimeDisplay}
						</span>
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
							<span className="min-w-[4ch] text-right text-xs tabular-nums text-basalt-muted-foreground">
								{vm.durationDisplay}
							</span>
						</div>
					</div>
				</>
			)}
		</>
	);

	if (isEmbedded) {
		return <div className="min-h-0 flex-1">{content}</div>;
	}
	return <LayerCard className="p-4">{content}</LayerCard>;
});
