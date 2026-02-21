"use client";

import { useState, useRef, useCallback, type ChangeEvent } from "react";
import { Upload, FileAudio, X, Loader2, Check, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ── Types ──

type UploadState = "idle" | "selected" | "uploading" | "creating" | "done" | "error";

interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete?: (recordingId: string) => void;
}

// ── Helpers ──

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Normalize audio MIME sub-type to a canonical format name.
 * e.g. "mpeg" → "mp3", "x-m4a" → "m4a", "mp4" → "m4a", "x-wav" → "wav".
 */
export function normalizeAudioFormat(mimeType: string): string {
  const sub = mimeType.split("/")[1] ?? "unknown";
  const map: Record<string, string> = {
    mpeg: "mp3",
    mp3: "mp3",
    "x-wav": "wav",
    wav: "wav",
    "x-m4a": "m4a",
    mp4: "m4a",
    aac: "aac",
    ogg: "ogg",
    flac: "flac",
    webm: "webm",
  };
  return map[sub] ?? sub;
}

/** Safely parse a JSON response, returning null if the body is empty or not JSON. */
async function safeJson<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Extract duration in seconds from an audio File using the Audio element. */
function getAudioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.addEventListener("loadedmetadata", () => {
      const d = Number.isFinite(audio.duration) ? audio.duration : null;
      URL.revokeObjectURL(url);
      resolve(d);
    });
    audio.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      resolve(null);
    });
    audio.src = url;
  });
}

const ACCEPTED_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/flac",
  "audio/aac",
  "audio/mp4",
  "audio/x-m4a",
  "audio/webm",
];

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

// ── Component ──

export function UploadDialog({
  open,
  onOpenChange,
  onUploadComplete,
}: UploadDialogProps) {
  const [state, setState] = useState<UploadState>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [progress, setProgress] = useState<UploadProgress>({
    loaded: 0,
    total: 0,
    percentage: 0,
  });
  const [errorMessage, setErrorMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<XMLHttpRequest | null>(null);

  const reset = useCallback(() => {
    setState("idle");
    setFile(null);
    setTitle("");
    setDescription("");
    setProgress({ loaded: 0, total: 0, percentage: 0 });
    setErrorMessage("");
    abortRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        // Abort in-flight upload
        if (abortRef.current) {
          abortRef.current.abort();
        }
        reset();
      }
      onOpenChange(open);
    },
    [onOpenChange, reset],
  );

  const handleFileSelect = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (!selected) return;

      // Validate type
      if (!ACCEPTED_TYPES.includes(selected.type)) {
        setErrorMessage("Unsupported file type. Please select an audio file.");
        setState("error");
        return;
      }

      // Validate size
      if (selected.size > MAX_FILE_SIZE) {
        setErrorMessage(
          `File too large (${formatFileSize(selected.size)}). Maximum size is ${formatFileSize(MAX_FILE_SIZE)}.`,
        );
        setState("error");
        return;
      }

      setFile(selected);
      // Auto-fill title from filename (without extension)
      if (!title) {
        const nameWithoutExt = selected.name.replace(/\.[^.]+$/, "");
        setTitle(nameWithoutExt);
      }
      setState("selected");
      setErrorMessage("");
    },
    [title],
  );

  const handleUpload = useCallback(async () => {
    if (!file) return;

    try {
      // Step 1: Get presigned URL
      setState("uploading");
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
        }),
      });

      if (!presignRes.ok) {
        const err = await safeJson<{ error?: string }>(presignRes);
        throw new Error(err?.error ?? `Failed to get upload URL (HTTP ${presignRes.status})`);
      }

      const presignData = await safeJson<{
        uploadUrl: string;
        ossKey: string;
        recordingId: string;
      }>(presignRes);
      if (!presignData?.uploadUrl || !presignData.ossKey || !presignData.recordingId) {
        throw new Error("Invalid presign response from server");
      }
      const { uploadUrl, ossKey, recordingId } = presignData;

      // Step 2: Upload to OSS via XMLHttpRequest (for progress tracking)
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        abortRef.current = xhr;

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            setProgress({
              loaded: e.loaded,
              total: e.total,
              percentage: Math.round((e.loaded / e.total) * 100),
            });
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener("error", () => {
          // XHR error events carry no detail — likely CORS or network failure
          reject(new Error("Network error during upload. This may be a CORS issue with the storage provider."));
        });
        xhr.addEventListener("abort", () =>
          reject(new Error("Upload cancelled")),
        );

        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.send(file);
      });

      // Step 3: Create recording in database
      setState("creating");
      const duration = await getAudioDuration(file);
      const createRes = await fetch("/api/recordings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: recordingId,
          title: title || file.name,
          description: description || null,
          fileName: file.name,
          fileSize: file.size,
          duration,
          format: normalizeAudioFormat(file.type),
          ossKey,
          recordedAt: file.lastModified || null,
        }),
      });

      if (!createRes.ok) {
        const err = await safeJson<{ error?: string }>(createRes);
        throw new Error(err?.error ?? `Failed to create recording (HTTP ${createRes.status})`);
      }

      setState("done");
      onUploadComplete?.(recordingId);

      // Auto-close after a short delay
      setTimeout(() => {
        handleOpenChange(false);
      }, 1500);
    } catch (err) {
      if (err instanceof Error && err.message === "Upload cancelled") {
        reset();
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : "Upload failed");
      setState("error");
    }
  }, [file, title, description, onUploadComplete, handleOpenChange, reset]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Recording</DialogTitle>
          <DialogDescription>
            Upload an audio file for transcription. Supports MP3, WAV, OGG,
            FLAC, AAC, M4A, and WebM.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* File picker */}
          <div className="grid gap-2">
            <Label htmlFor="audio-file">Audio File</Label>
            {!file ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="border-input hover:bg-accent hover:text-accent-foreground flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed transition-colors"
              >
                <Upload className="text-muted-foreground h-6 w-6" />
                <span className="text-muted-foreground text-sm">
                  Click to select file
                </span>
              </button>
            ) : (
              <div className="border-input flex items-center gap-3 rounded-lg border p-3">
                <FileAudio className="text-primary h-8 w-8 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {formatFileSize(file.size)}
                  </p>
                </div>
                {state === "selected" && (
                  <button
                    type="button"
                    onClick={reset}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              id="audio-file"
              accept="audio/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Title */}
          <div className="grid gap-2">
            <Label htmlFor="recording-title">Title</Label>
            <Input
              id="recording-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Recording title"
              disabled={state === "uploading" || state === "creating"}
            />
          </div>

          {/* Description (optional) */}
          <div className="grid gap-2">
            <Label htmlFor="recording-description">
              Description{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="recording-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description..."
              disabled={state === "uploading" || state === "creating"}
            />
          </div>

          {/* Progress bar */}
          {(state === "uploading" || state === "creating") && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {state === "uploading"
                    ? `Uploading... ${progress.percentage}%`
                    : "Saving recording..."}
                </span>
                <span className="text-muted-foreground">
                  {state === "uploading" &&
                    `${formatFileSize(progress.loaded)} / ${formatFileSize(progress.total)}`}
                </span>
              </div>
              <div className="bg-secondary h-2 overflow-hidden rounded-full">
                <div
                  className="bg-primary h-full transition-all duration-300"
                  style={{
                    width:
                      state === "creating"
                        ? "100%"
                        : `${progress.percentage}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Success */}
          {state === "done" && (
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <Check className="h-4 w-4" />
              <span>Upload complete!</span>
            </div>
          )}

          {/* Error */}
          {state === "error" && (
            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          {state === "error" && (
            <Button variant="outline" onClick={reset}>
              Try Again
            </Button>
          )}
          <Button
            onClick={handleUpload}
            disabled={
              !file ||
              !title ||
              state === "uploading" ||
              state === "creating" ||
              state === "done"
            }
          >
            {state === "uploading" || state === "creating" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {state === "uploading" ? "Uploading..." : "Saving..."}
              </>
            ) : state === "done" ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                Done
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
