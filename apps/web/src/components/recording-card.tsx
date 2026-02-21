import Link from "next/link";
import { Calendar, Clock, HardDrive, Mic } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RecordingCardVM } from "@/lib/recordings-list-vm";

interface RecordingCardProps {
  recording: RecordingCardVM;
}

export function RecordingCard({ recording }: RecordingCardProps) {
  return (
    <Link
      href={`/recordings/${recording.id}`}
      className="group block rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/50"
    >
      {/* Header: icon + title + status */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
          <Mic
            className="h-5 w-5 text-muted-foreground"
            strokeWidth={1.5}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-foreground truncate">
              {recording.title}
            </h3>
            <Badge variant={recording.status.variant} className="shrink-0">
              {recording.status.label}
            </Badge>
          </div>
          {recording.description && (
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
              {recording.description}
            </p>
          )}
        </div>
      </div>

      {/* Footer: metadata */}
      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
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
        <span className="ml-auto">{recording.createdAtRelative}</span>
      </div>

      {/* Tags */}
      {recording.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {recording.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </Link>
  );
}
