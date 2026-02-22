"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  Upload,
  X,
  Loader2,
  Check,
  FolderOpen,
  Tag,
  FileAudio,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  fetchFolders,
  fetchTags,
  uploadRecordingWithProgress,
  cancelUpload,
} from "@/lib/commands";
import type {
  RecordingInfo,
  ServerFolder,
  ServerTag,
  UploadProgress,
} from "@/lib/commands";

interface UploadPageProps {
  recording: RecordingInfo;
  onBack: () => void;
  onUploaded: () => void;
}

type PageState = "form" | "uploading" | "completed" | "error";

export function UploadPage({ recording, onBack, onUploaded }: UploadPageProps) {
  // Form state
  const [title, setTitle] = useState(
    recording.name.replace(/\.\w+$/, "")
  );
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  // Server data
  const [folders, setFolders] = useState<ServerFolder[]>([]);
  const [tags, setTags] = useState<ServerTag[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);

  // Upload state
  const [pageState, setPageState] = useState<PageState>("form");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Track if we're still mounted (for cleanup)
  const mountedRef = useRef(true);
  const uploadingRef = useRef(false);
  const completedRef = useRef(false);

  // Load folders and tags from server
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [foldersData, tagsData] = await Promise.all([
          fetchFolders(),
          fetchTags(),
        ]);
        if (!cancelled) {
          setFolders(foldersData);
          setTags(tagsData);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(`Failed to load metadata: ${err}`);
        }
      } finally {
        if (!cancelled) {
          setLoadingMeta(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Listen for upload progress events
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen<UploadProgress>("upload-progress", (event) => {
      if (cancelled || !mountedRef.current) return;
      const p = event.payload;
      setProgress(p);

      if (p.phase === "completed") {
        if (!completedRef.current) {
          completedRef.current = true;
          setPageState("completed");
          toast.success("Upload complete");
        }
      } else if (p.phase === "cancelled") {
        setPageState("form");
        setProgress(null);
      } else if (p.phase === "error") {
        setPageState("error");
        setErrorMessage(p.error ?? "Unknown error");
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Cancel upload on unmount (page exit = cancel)
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (uploadingRef.current) {
        cancelUpload().catch(() => {});
      }
    };
  }, []);

  const handleStartUpload = useCallback(async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }

    setPageState("uploading");
    setErrorMessage(null);
    uploadingRef.current = true;
    completedRef.current = false;

    try {
      await uploadRecordingWithProgress({
        filePath: recording.path,
        title: title.trim(),
        folderId: selectedFolderId ?? undefined,
        tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      });
      // Progress event will handle the "completed" state
      uploadingRef.current = false;
      onUploaded();
    } catch (err) {
      uploadingRef.current = false;
      if (!mountedRef.current) return;
      const msg = String(err);
      if (msg.includes("cancelled")) {
        setPageState("form");
        setProgress(null);
      } else {
        setPageState("error");
        setErrorMessage(msg);
        toast.error(`Upload failed: ${msg}`);
      }
    }
  }, [title, selectedFolderId, selectedTagIds, recording.path, onUploaded]);

  const handleCancel = useCallback(async () => {
    try {
      await cancelUpload();
    } catch {
      // ignore
    }
    uploadingRef.current = false;
    setPageState("form");
    setProgress(null);
  }, []);

  const handleBack = useCallback(() => {
    if (uploadingRef.current) {
      cancelUpload().catch(() => {});
      uploadingRef.current = false;
    }
    onBack();
  }, [onBack]);

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
  }, []);

  const percentDone =
    progress && progress.bytesTotal > 0
      ? Math.round((progress.bytesSent / progress.bytesTotal) * 100)
      : 0;

  return (
    <div
      className="flex h-screen flex-col pt-[74px]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header with back button */}
      <header
        data-tauri-drag-region
        className="fixed top-0 right-0 left-0 z-50 border-b bg-background"
      >
        <div data-tauri-drag-region className="h-[38px]" />
        <div
          data-tauri-drag-region
          className="flex items-center gap-2 px-4 pb-3"
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleBack}
            disabled={pageState === "completed"}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-base font-semibold">Upload Recording</h1>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* File info (always visible) */}
        <div className="mb-5 flex items-center gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5">
          <FileAudio className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{recording.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {formatSize(recording.size)}
              {recording.duration_secs != null &&
                ` · ${formatDuration(recording.duration_secs)}`}
            </p>
          </div>
        </div>

        {pageState === "form" && (
          <div className="space-y-5">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="upload-title">Title</Label>
              <Input
                id="upload-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Recording title"
              />
            </div>

            {/* Folder */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <FolderOpen className="h-3.5 w-3.5" />
                Folder
              </Label>
              {loadingMeta ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading...
                </div>
              ) : folders.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No folders available
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    variant={selectedFolderId === null ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setSelectedFolderId(null)}
                  >
                    None
                  </Button>
                  {folders.map((folder) => (
                    <Button
                      key={folder.id}
                      variant={
                        selectedFolderId === folder.id ? "default" : "outline"
                      }
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setSelectedFolderId(folder.id)}
                    >
                      {folder.name}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5" />
                Tags
              </Label>
              {loadingMeta ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading...
                </div>
              ) : tags.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No tags available
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => {
                    const selected = selectedTagIds.includes(tag.id);
                    return (
                      <Badge
                        key={tag.id}
                        variant={selected ? "default" : "outline"}
                        className="cursor-pointer select-none text-xs"
                        onClick={() => toggleTag(tag.id)}
                      >
                        {tag.name}
                        {selected && <X className="ml-0.5 h-2.5 w-2.5" />}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {(pageState === "uploading" || pageState === "completed" || pageState === "error") && (
          <div className="space-y-4">
            {/* Phase label */}
            <div className="flex items-center gap-2">
              {pageState === "completed" ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : pageState === "error" ? (
                <X className="h-4 w-4 text-destructive" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              <span className="text-sm font-medium">
                {pageState === "completed"
                  ? "Upload complete"
                  : pageState === "error"
                    ? "Upload failed"
                    : phaseLabel(progress?.phase)}
              </span>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all duration-300 ease-out ${
                    pageState === "error"
                      ? "bg-destructive"
                      : pageState === "completed"
                        ? "bg-green-600"
                        : "bg-primary"
                  }`}
                  style={{
                    width: `${pageState === "completed" ? 100 : percentDone}%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {progress
                    ? `${formatSize(progress.bytesSent)} / ${formatSize(progress.bytesTotal)}`
                    : "Preparing..."}
                </span>
                <span>{pageState === "completed" ? "100%" : `${percentDone}%`}</span>
              </div>
            </div>

            {/* Error message */}
            {pageState === "error" && errorMessage && (
              <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {errorMessage}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="border-t px-4 py-3">
        {pageState === "form" && (
          <Button
            onClick={handleStartUpload}
            disabled={!title.trim() || loadingMeta}
            size="sm"
            className="w-full gap-1.5"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload
          </Button>
        )}

        {pageState === "uploading" && (
          <Button
            onClick={handleCancel}
            variant="destructive"
            size="sm"
            className="w-full gap-1.5"
          >
            <X className="h-3.5 w-3.5" />
            Cancel Upload
          </Button>
        )}

        {pageState === "completed" && (
          <Button
            onClick={onBack}
            size="sm"
            className="w-full gap-1.5"
          >
            <Check className="h-3.5 w-3.5" />
            Done
          </Button>
        )}

        {pageState === "error" && (
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setPageState("form");
                setProgress(null);
                setErrorMessage(null);
              }}
              variant="outline"
              size="sm"
              className="flex-1"
            >
              Back to Form
            </Button>
            <Button
              onClick={handleStartUpload}
              size="sm"
              className="flex-1 gap-1.5"
            >
              <Upload className="h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function phaseLabel(phase?: string): string {
  switch (phase) {
    case "presigning":
      return "Preparing upload...";
    case "uploading":
      return "Uploading to cloud...";
    case "creating":
      return "Saving record...";
    case "completed":
      return "Upload complete";
    case "cancelled":
      return "Upload cancelled";
    default:
      return "Starting...";
  }
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
