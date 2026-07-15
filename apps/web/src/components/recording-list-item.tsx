import {
	AlertCircle,
	Calendar,
	Clock,
	FileAudio,
	FolderOpen,
	HardDrive,
	Mic,
	Sparkles,
} from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { RecordingCardVM } from "@/lib/recordings-list-vm";
import { cn } from "@/lib/utils";

interface RecordingListItemProps {
	recording: RecordingCardVM;
	selectable?: boolean;
	selected?: boolean;
	onToggleSelect?: (id: string) => void;
}

/** List view row — rich metadata badges, 2-line AI summary, colorful tags */
export function RecordingListItem({
	recording,
	selectable = false,
	selected = false,
	onToggleSelect,
}: RecordingListItemProps) {
	const isFailed = recording.statusRaw === "failed";

	const body = (
		<>
			<div
				className={cn(
					"flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
					isFailed ? "bg-destructive/10" : "bg-secondary",
				)}
			>
				{isFailed ? (
					<AlertCircle className="h-5 w-5 text-destructive" strokeWidth={1.5} />
				) : (
					<Mic className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
				)}
			</div>
			<div className="flex-1 min-w-0">
				<h3 className="text-sm font-medium text-foreground truncate">{recording.title}</h3>
				<div className="mt-1 flex items-center gap-1.5">
					<Badge variant={recording.status.variant} className="shrink-0 text-[10px]">
						{recording.status.label}
					</Badge>
					{recording.format !== "—" && (
						<Badge variant="outline" className="shrink-0 text-[10px] gap-1">
							<FileAudio className="h-3 w-3" strokeWidth={1.5} />
							{recording.format}
						</Badge>
					)}
				</div>

				{/* Row 2: folder + metadata badges */}
				<div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
					{recording.folder && (
						<span className="flex items-center gap-1">
							<FolderOpen className="h-3 w-3" strokeWidth={1.5} />
							{recording.folder.name}
						</span>
					)}
					<span className="flex items-center gap-1 tabular-nums">
						<Clock className="h-3 w-3" strokeWidth={1.5} />
						{recording.duration}
					</span>
					<span className="flex items-center gap-1">
						<HardDrive className="h-3 w-3" strokeWidth={1.5} />
						{recording.fileSize}
					</span>
					{recording.recordedAt && (
						<span className="flex items-center gap-1">
							<Calendar className="h-3 w-3" strokeWidth={1.5} />
							{recording.recordedAt}
						</span>
					)}
					<span className="ml-auto shrink-0">{recording.createdAtRelative}</span>
				</div>

				{/* Row 3: AI summary (2 lines max) */}
				{recording.aiSummary && (
					<div className="mt-2 flex items-start gap-1.5">
						<Sparkles className="h-3 w-3 shrink-0 text-muted-foreground mt-0.5" strokeWidth={1.5} />
						<p className="text-xs text-muted-foreground line-clamp-2">{recording.aiSummary}</p>
					</div>
				)}

				{/* Row 4: colorful tags */}
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
			</div>
		</>
	);

	// In selectable mode the row is a container that lays out the checkbox
	// beside a full-width toggle button. The two interactive elements are
	// siblings so we don't nest <button> inside <button>.
	if (selectable) {
		return (
			<div
				className={cn(
					"group flex items-start gap-3 rounded-card bg-secondary p-4 transition-colors",
					selected
						? "ring-1 ring-primary bg-primary/5"
						: isFailed
							? "ring-1 ring-destructive/30 hover:bg-accent/50"
							: "hover:bg-accent/50",
				)}
			>
				<div className="flex items-center pt-2.5">
					<Checkbox
						checked={selected}
						onCheckedChange={() => onToggleSelect?.(recording.id)}
						aria-label={`Select ${recording.title}`}
					/>
				</div>
				<button
					type="button"
					onClick={() => onToggleSelect?.(recording.id)}
					className="flex flex-1 min-w-0 items-start gap-3 text-left cursor-pointer"
				>
					{body}
				</button>
			</div>
		);
	}

	return (
		<Link
			to={`/recordings/${recording.id}`}
			className={cn(
				"group flex items-start gap-3 rounded-card bg-secondary p-4 transition-colors hover:bg-accent/50",
				isFailed ? "ring-1 ring-destructive/30" : "",
			)}
		>
			{body}
		</Link>
	);
}
