import { Badge, Checkbox } from "@nocoo/basalt";
import { LayerCard } from "@nocoo/basalt/components/layer-card";
import { AlertCircle, Clock, FileAudio, FolderOpen, HardDrive, Mic, Sparkles } from "lucide-react";
import { Link } from "react-router";
import type { RecordingCardVM } from "@/lib/recordings-list-vm";
import { cn } from "@/lib/utils";

interface RecordingTileCardProps {
	recording: RecordingCardVM;
	selectable?: boolean;
	selected?: boolean;
	onToggleSelect?: (id: string) => void;
}

/** Grid/tile view card — compact layout with key info */
export function RecordingTileCard({
	recording,
	selectable = false,
	selected = false,
	onToggleSelect,
}: RecordingTileCardProps) {
	const isFailed = recording.statusRaw === "failed";

	// Body without the checkbox — reused by both selectable and non-selectable modes.
	const body = (
		<>
			{/* Header: icon + status */}
			<div className="flex items-center justify-between mb-3">
				<div
					className={cn(
						"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
						isFailed ? "bg-basalt-destructive/10" : "bg-basalt-secondary",
					)}
				>
					{isFailed ? (
						<AlertCircle className="h-4 w-4 text-basalt-destructive" strokeWidth={1.5} />
					) : (
						<Mic className="h-4 w-4 text-basalt-muted-foreground" strokeWidth={1.5} />
					)}
				</div>
				<div className="flex items-center gap-1.5">
					<Badge variant={recording.status.variant} className="text-[10px]">
						{recording.status.label}
					</Badge>
					{recording.format !== "—" && (
						<Badge variant="outline" className="text-[10px] gap-1">
							<FileAudio className="h-3 w-3" strokeWidth={1.5} />
							{recording.format}
						</Badge>
					)}
				</div>
			</div>

			{/* Title */}
			<h3 className="text-sm font-medium text-basalt-foreground truncate mb-1">
				{recording.title}
			</h3>

			{/* Folder */}
			{recording.folder && (
				<span className="flex items-center gap-1 text-xs text-basalt-muted-foreground mb-1">
					<FolderOpen className="h-3 w-3" strokeWidth={1.5} />
					{recording.folder.name}
				</span>
			)}

			{/* AI summary (2 lines) */}
			{recording.aiSummary && (
				<div className="flex items-start gap-1.5 mb-2">
					<Sparkles
						className="h-3 w-3 shrink-0 text-basalt-muted-foreground mt-0.5"
						strokeWidth={1.5}
					/>
					<p className="text-xs text-basalt-muted-foreground line-clamp-2">{recording.aiSummary}</p>
				</div>
			)}

			{/* Spacer to push footer to bottom */}
			<div className="flex-1" />

			{/* Metadata badges */}
			<div className="flex items-center gap-3 text-xs text-basalt-muted-foreground mt-2">
				<span className="flex items-center gap-1 tabular-nums">
					<Clock className="h-3 w-3" strokeWidth={1.5} />
					{recording.duration}
				</span>
				<span className="flex items-center gap-1">
					<HardDrive className="h-3 w-3" strokeWidth={1.5} />
					{recording.fileSize}
				</span>
				<span className="ml-auto shrink-0">{recording.createdAtRelative}</span>
			</div>

			{/* Tags */}
			{recording.colorTags.length > 0 && (
				<div className="mt-2 flex flex-wrap gap-1">
					{recording.colorTags.map((tag) => (
						<span
							key={tag.id}
							className={cn(
								"inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
								tag.bgClass,
								tag.textClass,
							)}
						>
							{tag.name}
						</span>
					))}
				</div>
			)}
		</>
	);

	// Selectable mode overlays the checkbox on top of a full-card toggle
	// button. Checkbox and button are siblings so we don't nest one
	// interactive control inside another.
	if (selectable) {
		return (
			<LayerCard
				className={cn(
					"group relative flex h-full flex-col transition-colors",
					selected
						? "ring-1 ring-basalt-primary !bg-basalt-primary/5"
						: isFailed
							? "ring-1 ring-basalt-destructive/30 hover:bg-basalt-accent/50"
							: "hover:bg-basalt-accent/50",
				)}
			>
				<div className="absolute top-3 left-3 z-10">
					<Checkbox
						checked={selected}
						onCheckedChange={() => onToggleSelect?.(recording.id)}
						aria-label={`Select ${recording.title}`}
					/>
				</div>
				<button
					type="button"
					onClick={() => onToggleSelect?.(recording.id)}
					className="flex h-full w-full cursor-pointer flex-col p-4 pl-10 text-left"
				>
					{body}
				</button>
			</LayerCard>
		);
	}

	return (
		<Link to={`/recordings/${recording.id}`} className="block h-full">
			<LayerCard
				className={cn(
					"group flex h-full flex-col p-4 transition-colors hover:bg-basalt-accent/50",
					isFailed ? "ring-1 ring-basalt-destructive/30" : "",
				)}
			>
				{body}
			</LayerCard>
		</Link>
	);
}
