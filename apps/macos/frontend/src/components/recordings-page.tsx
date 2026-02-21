"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Play,
  Square,
  Upload,
  FolderOpen,
  Trash2,
  RefreshCw,
  Check,
  Loader2,
  AlertCircle,
  Music,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  listRecordings,
  deleteRecording,
  revealRecording,
  uploadRecording,
} from "@/lib/commands";
import type { RecordingInfo } from "@/lib/commands";

type UploadStatus = "idle" | "uploading" | "success" | "error";

interface UploadState {
  status: UploadStatus;
  error?: string;
}

export function RecordingsPage() {
  const [recordings, setRecordings] = useState<RecordingInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingPath, setPlayingPath] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [uploadStates, setUploadStates] = useState<Record<string, UploadState>>(
    {}
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadRecordings = useCallback(async () => {
    try {
      const list = await listRecordings();
      setRecordings(list);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecordings();
  }, [loadRecordings]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const handlePlay = useCallback(
    (rec: RecordingInfo) => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      if (playingPath === rec.path) {
        setPlayingPath(null);
        return;
      }

      const src = convertFileSrc(rec.path);
      const audio = new Audio(src);
      audio.onended = () => {
        setPlayingPath(null);
        audioRef.current = null;
      };
      audio.onerror = () => {
        setPlayingPath(null);
        audioRef.current = null;
      };
      audio.play().catch(() => setPlayingPath(null));
      audioRef.current = audio;
      setPlayingPath(rec.path);
    },
    [playingPath]
  );

  const handleDelete = useCallback(
    async (rec: RecordingInfo) => {
      if (playingPath === rec.path && audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
        setPlayingPath(null);
      }

      setDeletingPath(rec.path);
      try {
        await deleteRecording(rec.path);
        setRecordings((prev) => prev.filter((r) => r.path !== rec.path));
      } catch (err) {
        toast.error(String(err));
      } finally {
        setDeletingPath(null);
      }
    },
    [playingPath]
  );

  const handleReveal = useCallback(async (rec: RecordingInfo) => {
    try {
      await revealRecording(rec.path);
    } catch (err) {
      console.error("Failed to reveal:", err);
    }
  }, []);

  const handleUpload = useCallback(async (rec: RecordingInfo) => {
    setUploadStates((prev) => ({
      ...prev,
      [rec.path]: { status: "uploading" },
    }));

    try {
      await uploadRecording(rec.path);
      setUploadStates((prev) => ({
        ...prev,
        [rec.path]: { status: "success" },
      }));
      toast.success(`Uploaded ${rec.name}`);
      setTimeout(() => {
        setUploadStates((prev) => {
          const next = { ...prev };
          if (next[rec.path]?.status === "success") {
            next[rec.path] = { status: "idle" };
          }
          return next;
        });
      }, 3000);
    } catch (err) {
      setUploadStates((prev) => ({
        ...prev,
        [rec.path]: { status: "error", error: String(err) },
      }));
      toast.error(`Upload failed: ${err}`);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (recordings.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4">
        <Music className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No recordings yet</p>
        <p className="text-[11px] text-muted-foreground/70">
          Use the tray menu to start recording
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {recordings.length} recording{recordings.length !== 1 ? "s" : ""}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={loadRecordings}
          title="Refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {/* Recordings list */}
      <ScrollArea className="flex-1">
        <div className="divide-y divide-border">
          {recordings.map((rec) => {
            const upload = uploadStates[rec.path];
            const isPlaying = playingPath === rec.path;
            const isDeleting = deletingPath === rec.path;
            const isUploading = upload?.status === "uploading";
            const isUploaded = upload?.status === "success";
            const hasUploadError = upload?.status === "error";

            return (
              <div
                key={rec.path}
                className="group flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50"
              >
                {/* Play button */}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0"
                  onClick={() => handlePlay(rec)}
                  title={isPlaying ? "Stop" : "Play"}
                >
                  {isPlaying ? (
                    <Square className="h-3 w-3" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                </Button>

                {/* Recording info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {rec.name}
                    </span>
                    {isPlaying && (
                      <Badge
                        variant="default"
                        className="shrink-0 text-[10px]"
                      >
                        playing
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {formatSize(rec.size)}
                    {rec.duration_secs != null &&
                      ` · ${formatDuration(rec.duration_secs)}`}
                    {" · "}
                    {formatDate(rec.created_at)}
                  </p>
                  {hasUploadError && (
                    <p className="flex items-center gap-1 text-[10px] text-destructive">
                      <AlertCircle className="h-2.5 w-2.5" />
                      <span className="truncate">{upload.error}</span>
                    </p>
                  )}
                </div>

                {/* Action buttons — visible on hover */}
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleUpload(rec)}
                    disabled={isUploading}
                    title={
                      isUploading
                        ? "Uploading..."
                        : isUploaded
                          ? "Uploaded"
                          : "Upload to Lyre"
                    }
                  >
                    {isUploading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : isUploaded ? (
                      <Check className="h-3 w-3 text-green-600" />
                    ) : (
                      <Upload className="h-3 w-3" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleReveal(rec)}
                    title="Show in Finder"
                  >
                    <FolderOpen className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleDelete(rec)}
                    disabled={isDeleting}
                    title="Delete"
                    className="hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
