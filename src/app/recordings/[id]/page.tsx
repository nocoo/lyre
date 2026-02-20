"use client";

import { use, useRef, useState, useCallback, useEffect } from "react";
import {
  ArrowLeft,
  Play,
  Loader2,
  AlertCircle,
  FileText,
  Trash2,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout";
import {
  AudioPlayer,
  type AudioPlayerHandle,
} from "@/components/audio-player";
import {
  TranscriptViewer,
  TranscriptFullText,
} from "@/components/transcript-viewer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toRecordingDetailVM } from "@/lib/recording-detail-vm";
import type { RecordingDetail, TranscriptionJob } from "@/lib/types";

type PageParams = { params: Promise<{ id: string }> };

export default function RecordingDetailPage({ params }: PageParams) {
  const { id } = use(params);

  return (
    <AppShell
      breadcrumbs={[
        { label: "Recordings", href: "/recordings" },
        { label: "Detail" },
      ]}
    >
      <RecordingDetailContent id={id} />
    </AppShell>
  );
}

/** Poll interval for job status in milliseconds */
const POLL_INTERVAL_MS = 3000;

function RecordingDetailContent({ id }: { id: string }) {
  const router = useRouter();
  const playerRef = useRef<AudioPlayerHandle>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [viewMode, setViewMode] = useState<"sentences" | "fulltext">(
    "sentences",
  );
  const [detail, setDetail] = useState<RecordingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [pollStatus, setPollStatus] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load recording detail ──
  const loadDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/recordings/${id}`);
      if (res.ok) {
        const data = (await res.json()) as RecordingDetail;
        setDetail(data);
        return data;
      }
    } catch {
      // Silently fail — UI handles null detail
    }
    return null;
  }, [id]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const data = await loadDetail();
      setLoading(false);

      // If the recording is currently transcribing with an active job, resume polling
      if (data?.status === "transcribing" && data.latestJob) {
        const job = data.latestJob;
        if (job.status === "PENDING" || job.status === "RUNNING") {
          setActiveJobId(job.id);
          setPollStatus(job.status);
        }
      }
    }
    void load();
  }, [loadDetail]);

  // ── Fetch presigned play URL ──
  useEffect(() => {
    if (!detail?.ossKey) return;
    async function fetchPlayUrl() {
      const res = await fetch(`/api/recordings/${id}/play-url`);
      if (res.ok) {
        const data = (await res.json()) as { playUrl: string };
        setAudioUrl(data.playUrl);
      }
    }
    void fetchPlayUrl();
  }, [id, detail?.ossKey]);

  // ── Poll job status ──
  useEffect(() => {
    if (!activeJobId) return;

    const pollJob = async () => {
      try {
        const res = await fetch(`/api/jobs/${activeJobId}`);
        if (!res.ok) return;

        const job = (await res.json()) as TranscriptionJob;
        setPollStatus(job.status);

        if (job.status === "SUCCEEDED" || job.status === "FAILED") {
          // Stop polling
          setActiveJobId(null);
          // Refresh the full detail to get transcription data
          await loadDetail();
        }
      } catch {
        // Retry on next interval
      }
    };

    // Run immediately, then set interval
    void pollJob();
    pollTimerRef.current = setInterval(() => void pollJob(), POLL_INTERVAL_MS);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [activeJobId, loadDetail]);

  // ── Handlers ──
  const handleTranscribe = useCallback(async () => {
    setTranscribing(true);
    try {
      const res = await fetch(`/api/recordings/${id}/transcribe`, {
        method: "POST",
      });

      if (!res.ok) {
        const err = (await res.json()) as { error: string };
        console.error("Transcription submit failed:", err.error);
        setTranscribing(false);
        return;
      }

      const job = (await res.json()) as TranscriptionJob;

      // Update local state to show transcribing status immediately
      setDetail((prev) =>
        prev ? { ...prev, status: "transcribing", latestJob: job } : prev,
      );
      setActiveJobId(job.id);
      setPollStatus(job.status);
    } catch (error) {
      console.error("Transcription submit error:", error);
    } finally {
      setTranscribing(false);
    }
  }, [id]);

  const handleSeek = useCallback((timeInSeconds: number) => {
    playerRef.current?.seekTo(timeInSeconds);
  }, []);

  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/recordings/${id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/recordings");
      }
    } finally {
      setDeleting(false);
    }
  }, [id, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!detail) return <NotFound />;

  const vm = toRecordingDetailVM(detail);

  return (
    <div className="space-y-6">
      {/* Back link + header */}
      <div className="space-y-4">
        <Link
          href="/recordings"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          Back to recordings
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-semibold truncate">
                {vm.metadata.title}
              </h1>
              <Badge variant={vm.metadata.status.variant} className="shrink-0">
                {vm.metadata.status.label}
              </Badge>
            </div>
            {vm.metadata.description && (
              <p className="mt-1 text-sm text-muted-foreground">
                {vm.metadata.description}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex shrink-0 gap-2">
            {vm.metadata.canTranscribe && (
              <Button
                size="sm"
                className="gap-2"
                onClick={handleTranscribe}
                disabled={transcribing}
              >
                {transcribing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" strokeWidth={1.5} />
                )}
                {transcribing ? "Submitting..." : "Transcribe"}
              </Button>
            )}
            {vm.metadata.canRetranscribe && (
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={handleTranscribe}
                disabled={transcribing}
              >
                {transcribing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" strokeWidth={1.5} />
                )}
                {transcribing ? "Submitting..." : "Re-transcribe"}
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete recording?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete &ldquo;{vm.metadata.title}
                    &rdquo; and its audio file from storage. This action cannot
                    be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    disabled={deleting}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      "Delete"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      {/* Metadata grid */}
      <MetadataGrid
        fileName={vm.metadata.fileName}
        fileSize={vm.metadata.fileSize}
        duration={vm.metadata.duration}
        format={vm.metadata.format}
        sampleRate={vm.metadata.sampleRate}
        createdAt={vm.metadata.createdAt}
        tags={vm.metadata.tags}
      />

      {/* Audio player */}
      {audioUrl && (
        <AudioPlayer
          ref={playerRef}
          src={audioUrl}
          title={vm.metadata.title}
          onTimeUpdate={handleTimeUpdate}
        />
      )}

      {/* Transcribing state — show when actively polling or VM says transcribing */}
      {(activeJobId || vm.isTranscribing) && (
        <TranscribingCard status={pollStatus} />
      )}

      {/* Job error */}
      {vm.job?.isFailed && !activeJobId && (
        <JobErrorCard message={vm.job.errorMessage} />
      )}

      {/* Transcription */}
      {vm.hasTranscription && vm.transcription && (
        <div className="space-y-3">
          {/* View mode toggle */}
          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === "sentences" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("sentences")}
            >
              Sentences
            </Button>
            <Button
              variant={viewMode === "fulltext" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("fulltext")}
              className="gap-1.5"
            >
              <FileText className="h-3.5 w-3.5" strokeWidth={1.5} />
              Full Text
            </Button>
          </div>

          {viewMode === "sentences" ? (
            <TranscriptViewer
              transcription={vm.transcription}
              currentTime={currentTime}
              onSeek={handleSeek}
            />
          ) : (
            <TranscriptFullText transcription={vm.transcription} />
          )}
        </div>
      )}

      {/* Job info (for completed) */}
      {vm.job?.isCompleted && (
        <JobInfoCard
          submitTime={vm.job.submitTime}
          endTime={vm.job.endTime}
          processingDuration={vm.job.processingDuration}
          usageSeconds={vm.job.usageSeconds}
        />
      )}
    </div>
  );
}

// ── Sub-components ──

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <p className="text-lg font-medium">Recording not found</p>
      <p className="mt-1 text-sm">
        The recording you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link href="/recordings">
        <Button variant="outline" size="sm" className="mt-4 gap-2">
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          Back to recordings
        </Button>
      </Link>
    </div>
  );
}

function MetadataGrid({
  fileName,
  fileSize,
  duration,
  format,
  sampleRate,
  createdAt,
  tags,
}: {
  fileName: string;
  fileSize: string;
  duration: string;
  format: string;
  sampleRate: string;
  createdAt: string;
  tags: string[];
}) {
  const items = [
    { label: "File", value: fileName },
    { label: "Size", value: fileSize },
    { label: "Duration", value: duration },
    { label: "Format", value: format },
    { label: "Sample Rate", value: sampleRate },
    { label: "Created", value: createdAt },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.label}>
            <p className="text-xs font-medium text-muted-foreground">
              {item.label}
            </p>
            <p className="mt-0.5 text-sm text-foreground truncate">
              {item.value}
            </p>
          </div>
        ))}
      </div>
      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function TranscribingCard({ status }: { status: string | null }) {
  const statusLabel =
    status === "PENDING"
      ? "Queued"
      : status === "RUNNING"
        ? "Processing"
        : "Submitting";

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
      <Loader2
        className="h-5 w-5 animate-spin text-muted-foreground"
        strokeWidth={1.5}
      />
      <div>
        <p className="text-sm font-medium text-foreground">
          Transcription in progress
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            ({statusLabel})
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          This may take a few minutes depending on the audio length.
        </p>
      </div>
    </div>
  );
}

function JobErrorCard({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-destructive/50 bg-destructive/5 p-4">
      <AlertCircle
        className="h-5 w-5 shrink-0 text-destructive"
        strokeWidth={1.5}
      />
      <div>
        <p className="text-sm font-medium text-foreground">
          Transcription failed
        </p>
        {message && (
          <p className="mt-0.5 text-xs text-muted-foreground">{message}</p>
        )}
      </div>
    </div>
  );
}

function JobInfoCard({
  submitTime,
  endTime,
  processingDuration,
  usageSeconds,
}: {
  submitTime: string;
  endTime: string;
  processingDuration: string;
  usageSeconds: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Job Details
      </p>
      <div className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Submitted</p>
          <p className="text-sm text-foreground">{submitTime}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Completed</p>
          <p className="text-sm text-foreground">{endTime}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Processing</p>
          <p className="text-sm text-foreground">{processingDuration}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Audio Processed</p>
          <p className="text-sm text-foreground">{usageSeconds}</p>
        </div>
      </div>
    </div>
  );
}
