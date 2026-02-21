import Link from "next/link";
import {
  Calendar,
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

interface RecordingListItemProps {
  recording: RecordingCardVM;
}

/** List view row — rich metadata badges, 2-line AI summary, colorful tags */
export function RecordingListItem({ recording }: RecordingListItemProps) {
  const isFailed = recording.statusRaw === "failed";

  return (
    <Link
      href={`/recordings/${recording.id}`}
      className={cn(
        "group block rounded-xl border bg-card p-4 transition-colors hover:bg-accent/50",
        isFailed ? "border-destructive/30" : "border-border",
      )}
    >
      {/* Row 1: icon + title + badges */}
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            isFailed ? "bg-destructive/10" : "bg-secondary",
          )}
        >
          {isFailed ? (
            <AlertCircle
              className="h-5 w-5 text-destructive"
              strokeWidth={1.5}
            />
          ) : (
            <Mic
              className="h-5 w-5 text-muted-foreground"
              strokeWidth={1.5}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-medium text-foreground truncate">
              {recording.title}
            </h3>
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
            <span className="flex items-center gap-1">
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
              <p className="text-xs text-muted-foreground line-clamp-2">
                {recording.aiSummary}
              </p>
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
      </div>
    </Link>
  );
}
