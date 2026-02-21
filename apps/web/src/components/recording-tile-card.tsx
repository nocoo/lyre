import Link from "next/link";
import {
  Clock,
  HardDrive,
  Mic,
  FolderOpen,
  FileAudio,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RecordingCardVM } from "@/lib/recordings-list-vm";

interface RecordingTileCardProps {
  recording: RecordingCardVM;
}

/** Grid/tile view card — compact layout with key info */
export function RecordingTileCard({ recording }: RecordingTileCardProps) {
  const isFailed = recording.statusRaw === "failed";

  return (
    <Link
      href={`/recordings/${recording.id}`}
      className={cn(
        "group flex flex-col rounded-xl border bg-card p-4 transition-colors hover:bg-accent/50 h-full",
        isFailed ? "border-destructive/30" : "border-border",
      )}
    >
      {/* Header: icon + status */}
      <div className="flex items-center justify-between mb-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            isFailed ? "bg-destructive/10" : "bg-secondary",
          )}
        >
          {isFailed ? (
            <AlertCircle
              className="h-4 w-4 text-destructive"
              strokeWidth={1.5}
            />
          ) : (
            <Mic
              className="h-4 w-4 text-muted-foreground"
              strokeWidth={1.5}
            />
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
      <h3 className="text-sm font-medium text-foreground truncate mb-1">
        {recording.title}
      </h3>

      {/* Folder */}
      {recording.folder && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
          <FolderOpen className="h-3 w-3" strokeWidth={1.5} />
          {recording.folder.name}
        </span>
      )}

      {/* AI summary (2 lines) */}
      {recording.aiSummary && (
        <div className="flex items-start gap-1.5 mb-2">
          <Sparkles className="h-3 w-3 shrink-0 text-muted-foreground mt-0.5" strokeWidth={1.5} />
          <p className="text-xs text-muted-foreground line-clamp-2">
            {recording.aiSummary}
          </p>
        </div>
      )}

      {/* Spacer to push footer to bottom */}
      <div className="flex-1" />

      {/* Metadata badges */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
        <span className="flex items-center gap-1">
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
    </Link>
  );
}
