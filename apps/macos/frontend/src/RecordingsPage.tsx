import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

interface RecordingInfo {
  path: string;
  name: string;
  size: number;
  duration_secs: number | null;
  created_at: string;
}

interface UploadResult {
  recordingId: string;
  ossKey: string;
}

type UploadStatus = "idle" | "uploading" | "success" | "error";

interface UploadState {
  status: UploadStatus;
  error?: string;
}

export function RecordingsPage() {
  const [recordings, setRecordings] = useState<RecordingInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playingPath, setPlayingPath] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [uploadStates, setUploadStates] = useState<Record<string, UploadState>>(
    {},
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadRecordings = useCallback(async () => {
    try {
      const list = await invoke<RecordingInfo[]>("list_recordings");
      setRecordings(list);
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecordings();
  }, [loadRecordings]);

  const handlePlay = useCallback(
    (rec: RecordingInfo) => {
      // Stop current playback
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
    [playingPath],
  );

  const handleDelete = useCallback(
    async (rec: RecordingInfo) => {
      // Stop playback if deleting the playing file
      if (playingPath === rec.path && audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
        setPlayingPath(null);
      }

      setDeletingPath(rec.path);
      try {
        await invoke("delete_recording", { filePath: rec.path });
        setRecordings((prev) => prev.filter((r) => r.path !== rec.path));
      } catch (err) {
        setError(String(err));
      } finally {
        setDeletingPath(null);
      }
    },
    [playingPath],
  );

  const handleReveal = useCallback(async (rec: RecordingInfo) => {
    try {
      await invoke("reveal_recording", { filePath: rec.path });
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
      await invoke<UploadResult>("upload_recording", {
        filePath: rec.path,
      });
      setUploadStates((prev) => ({
        ...prev,
        [rec.path]: { status: "success" },
      }));
      // Auto-clear success after 3 seconds
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
    }
  }, []);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="content">
      <section className="section">
        <div className="section-header">
          <h2>Local Recordings</h2>
          <button className="btn-icon" onClick={loadRecordings} title="Refresh">
            ↻
          </button>
        </div>

        {error && (
          <p className="description" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        {recordings.length === 0 && !error ? (
          <p className="description">
            No recordings yet. Use the tray menu to start recording.
          </p>
        ) : (
          <div className="recordings-list">
            {recordings.map((rec) => {
              const upload = uploadStates[rec.path];
              const isUploading = upload?.status === "uploading";
              const isUploaded = upload?.status === "success";
              const uploadError = upload?.status === "error";

              return (
                <div key={rec.path} className="recording-item">
                  <div className="recording-info">
                    <span className="recording-name">{rec.name}</span>
                    <span className="recording-meta">
                      {formatSize(rec.size)}
                      {rec.duration_secs != null &&
                        ` · ${formatDuration(rec.duration_secs)}`}
                      {" · "}
                      {formatDate(rec.created_at)}
                    </span>
                    {uploadError && (
                      <span className="upload-error" title={upload.error}>
                        Upload failed: {upload.error}
                      </span>
                    )}
                  </div>
                  <div className="recording-actions">
                    <button
                      className="btn-icon"
                      onClick={() => handlePlay(rec)}
                      title={playingPath === rec.path ? "Stop" : "Play"}
                    >
                      {playingPath === rec.path ? "⏹" : "▶"}
                    </button>
                    <button
                      className={`btn-icon ${isUploaded ? "btn-success" : ""}`}
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
                      {isUploading ? "⏳" : isUploaded ? "✓" : "⬆"}
                    </button>
                    <button
                      className="btn-icon"
                      onClick={() => handleReveal(rec)}
                      title="Show in Finder"
                    >
                      📂
                    </button>
                    <button
                      className="btn-icon btn-danger"
                      onClick={() => handleDelete(rec)}
                      disabled={deletingPath === rec.path}
                      title="Delete"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
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
