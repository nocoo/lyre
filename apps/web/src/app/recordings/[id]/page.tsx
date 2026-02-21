"use client";

import { use, useRef, useState, useCallback, useEffect } from "react";
import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronsUpDown,
  Cpu,
  Download,
  Folder,
  FolderOpen,
  Loader2,
  AlertCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  StickyNote,
  Sparkles,
  Tag,
  Trash2,
  X,
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
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
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
import type {
  RecordingDetail,
  TranscriptionJob,
  Tag as TagType,
  Folder as FolderType,
} from "@/lib/types";

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
  const [downloading, setDownloading] = useState(false);

  // AI summary
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summarizeError, setSummarizeError] = useState<string | null>(null);

  // AI settings (for info sidebar)
  const [aiProvider, setAiProvider] = useState("");
  const [aiModel, setAiModel] = useState("");

  // Editable fields
  const [editTitle, setEditTitle] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
  const [notes, setNotes] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [recordedAtDate, setRecordedAtDate] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<TagType[]>([]);
  const [allFolders, setAllFolders] = useState<FolderType[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [creatingTag, setCreatingTag] = useState(false);

  // ── Load recording detail ──
  const loadDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/recordings/${id}`);
      if (res.ok) {
        const data = (await res.json()) as RecordingDetail;
        setDetail(data);
        // Sync editable fields
        setAiSummary(data.aiSummary ?? null);
        setEditTitle(data.title);
        setNotes(data.notes ?? "");
        setRecordedAtDate(
          data.recordedAt ? toDateInputValue(data.recordedAt) : "",
        );
        setSelectedTagIds(data.resolvedTags.map((t) => t.id));
        setSelectedFolderId(data.folderId);
        return data;
      }
    } catch {
      // Silently fail — UI handles null detail
    }
    return null;
  }, [id]);

  // ── Load user's tags and folders ──
  const loadTagsAndFolders = useCallback(async () => {
    const [tagsRes, foldersRes] = await Promise.all([
      fetch("/api/tags"),
      fetch("/api/folders"),
    ]);
    if (tagsRes.ok) {
      const data = (await tagsRes.json()) as { items: TagType[] };
      setAllTags(data.items);
    }
    if (foldersRes.ok) {
      const data = (await foldersRes.json()) as { items: FolderType[] };
      setAllFolders(data.items);
    }
  }, []);

  // ── Load AI settings (provider + model for info card) ──
  const loadAiSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/ai");
      if (res.ok) {
        const data = (await res.json()) as { provider: string; model: string };
        setAiProvider(data.provider);
        setAiModel(data.model);
      }
    } catch {
      // Non-critical, silently fail
    }
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [data] = await Promise.all([
        loadDetail(),
        loadTagsAndFolders(),
        loadAiSettings(),
      ]);
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
  }, [loadDetail, loadTagsAndFolders, loadAiSettings]);

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
  // Uses visibilitychange to pause polling when tab is hidden
  // and immediately re-poll when the user returns.
  useEffect(() => {
    if (!activeJobId) return;

    let timer: ReturnType<typeof setInterval> | null = null;

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

    const startPolling = () => {
      if (timer) return;
      void pollJob(); // Immediate poll
      timer = setInterval(() => void pollJob(), POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        startPolling(); // Re-poll immediately when user returns
      } else {
        stopPolling(); // Pause in background to save resources
      }
    };

    // Start polling if tab is currently visible
    if (document.visibilityState === "visible") {
      startPolling();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibility);
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

  // ── Download handler ──
  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/recordings/${id}/download-url`);
      if (res.ok) {
        const data = (await res.json()) as { downloadUrl: string };
        window.open(data.downloadUrl, "_blank");
      }
    } finally {
      setDownloading(false);
    }
  }, [id]);

  // ── AI Summarize handler (streaming) ──
  const handleSummarize = useCallback(async () => {
    setSummarizing(true);
    setSummarizeError(null);
    setAiSummary("");
    try {
      const res = await fetch(`/api/recordings/${id}/summarize`, {
        method: "POST",
      });

      // Non-streaming error responses come back as JSON
      if (!res.ok) {
        const data = (await res.json()) as { error: string };
        setSummarizeError(data.error ?? "Unknown error");
        return;
      }

      // Stream the text response
      const reader = res.body?.getReader();
      if (!reader) {
        setSummarizeError("Streaming not supported by browser.");
        return;
      }

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setAiSummary(accumulated);
      }

      // Final decode flush
      accumulated += decoder.decode();
      if (accumulated) {
        setAiSummary(accumulated);
      }
    } catch {
      setSummarizeError("Network error — could not reach the server.");
    } finally {
      setSummarizing(false);
    }
  }, [id]);

  // ── Save field via PUT ──
  const updateRecording = useCallback(
    async (updates: Record<string, unknown>) => {
      await fetch(`/api/recordings/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    },
    [id],
  );

  // ── Save all properties ──
  const handleSaveProperties = useCallback(async () => {
    const updates: Record<string, unknown> = {};
    const trimmedTitle = editTitle.trim();
    if (trimmedTitle && trimmedTitle !== detail?.title) {
      updates.title = trimmedTitle;
    }
    if (notes !== (detail?.notes ?? "")) {
      updates.notes = notes || null;
    }
    if (Object.keys(updates).length === 0) return;
    setTitleSaving(true);
    await updateRecording(updates);
    await loadDetail();
    setTitleSaving(false);
  }, [editTitle, notes, detail?.title, detail?.notes, updateRecording, loadDetail]);

  // ── Title save on blur ──
  const handleTitleSave = useCallback(async () => {
    const trimmed = editTitle.trim();
    if (!trimmed || trimmed === detail?.title) return;
    setTitleSaving(true);
    await updateRecording({ title: trimmed });
    // Refresh detail to update header
    await loadDetail();
    setTitleSaving(false);
  }, [editTitle, detail?.title, updateRecording, loadDetail]);

  // ── Notes save on blur ──
  const handleNotesSave = useCallback(async () => {
    if (notes === (detail?.notes ?? "")) return;
    setNotesSaving(true);
    await updateRecording({ notes: notes || null });
    setNotesSaving(false);
  }, [notes, detail?.notes, updateRecording]);

  // ── Tag toggle ──
  const handleToggleTag = useCallback(
    async (tagId: string) => {
      const next = selectedTagIds.includes(tagId)
        ? selectedTagIds.filter((t) => t !== tagId)
        : [...selectedTagIds, tagId];
      setSelectedTagIds(next);
      await updateRecording({ tagIds: next });
      await loadDetail();
    },
    [selectedTagIds, updateRecording, loadDetail],
  );

  // ── Create new tag and assign ──
  const handleCreateTag = useCallback(async () => {
    const name = newTagName.trim();
    if (!name) return;
    setCreatingTag(true);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok || res.status === 409) {
        const data = (await res.json()) as TagType | { error: string; tag: TagType };
        const tag = "tag" in data ? data.tag : data;
        setAllTags((prev) =>
          prev.some((t) => t.id === tag.id) ? prev : [...prev, tag],
        );
        const next = [...selectedTagIds, tag.id];
        setSelectedTagIds(next);
        await updateRecording({ tagIds: next });
        await loadDetail();
      }
    } finally {
      setNewTagName("");
      setCreatingTag(false);
    }
  }, [newTagName, selectedTagIds, updateRecording, loadDetail]);

  // ── Folder change ──
  const handleFolderChange = useCallback(
    async (folderId: string | null) => {
      setSelectedFolderId(folderId);
      setFolderOpen(false);
      await updateRecording({ folderId });
      await loadDetail();
    },
    [updateRecording, loadDetail],
  );

  // ── RecordedAt change ──
  const handleRecordedAtChange = useCallback(
    async (dateStr: string) => {
      setRecordedAtDate(dateStr);
      const ms = dateStr ? new Date(dateStr).getTime() : null;
      await updateRecording({ recordedAt: ms });
    },
    [updateRecording],
  );

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
    <div className="space-y-5">
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
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" strokeWidth={1.5} />
              )}
              Download
            </Button>

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

      {/* Transcribing / Error banners (full width) */}
      {(activeJobId || vm.isTranscribing) && (
        <TranscribingCard status={pollStatus} />
      )}
      {vm.job?.isFailed && !activeJobId && (
        <JobErrorCard message={vm.job.errorMessage} />
      )}

      {/* ── Row 1: Player + Metadata (2/3) | Properties (1/3) ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-border bg-card p-4 h-full flex flex-col gap-4">
            <p className="text-xs font-medium text-muted-foreground">
              Playback &amp; File Info
            </p>
            {/* Audio player */}
            {audioUrl && (
              <AudioPlayer
                ref={playerRef}
                src={audioUrl}
                title={vm.metadata.title}
                onTimeUpdate={handleTimeUpdate}
                variant="embedded"
              />
            )}
            {/* File metadata */}
            <MetadataGrid
              fileName={vm.metadata.fileName}
              fileSize={vm.metadata.fileSize}
              duration={vm.metadata.duration}
              format={vm.metadata.format}
              sampleRate={vm.metadata.sampleRate}
              createdAt={vm.metadata.createdAt}
              recordedAt={vm.metadata.recordedAt}
              folderName={vm.metadata.folderName}
              tags={vm.metadata.resolvedTags}
            />
          </div>
        </div>
        <div className="lg:col-span-1">
          <EditableProperties
            title={editTitle}
            onTitleChange={setEditTitle}
            onTitleSave={handleTitleSave}
            titleSaving={titleSaving}
            notes={notes}
            onNotesChange={setNotes}
            onNotesSave={handleNotesSave}
            notesSaving={notesSaving}
            onSaveAll={handleSaveProperties}
            isDirty={
              (editTitle.trim() !== "" && editTitle.trim() !== (detail?.title ?? "")) ||
              notes !== (detail?.notes ?? "")
            }
            recordedAtDate={recordedAtDate}
            onRecordedAtChange={handleRecordedAtChange}
            selectedTagIds={selectedTagIds}
            allTags={allTags}
            tagsOpen={tagsOpen}
            onTagsOpenChange={setTagsOpen}
            onToggleTag={handleToggleTag}
            newTagName={newTagName}
            onNewTagNameChange={setNewTagName}
            onCreateTag={handleCreateTag}
            creatingTag={creatingTag}
            selectedFolderId={selectedFolderId}
            allFolders={allFolders}
            folderOpen={folderOpen}
            onFolderOpenChange={setFolderOpen}
            onFolderChange={handleFolderChange}
          />
        </div>
      </div>

      {/* ── Row 2: AI Summary (2/3) | AI Info (1/3) ── */}
      {vm.hasTranscription && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <AiSummaryCard
              summary={aiSummary}
              loading={summarizing}
              error={summarizeError}
              onGenerate={handleSummarize}
            />
          </div>
          <div className="lg:col-span-1">
            <AiInfoCard provider={aiProvider} model={aiModel} />
          </div>
        </div>
      )}

      {/* ── Row 3: Transcription (2/3) | Job Details (1/3) ── */}
      {vm.hasTranscription && vm.transcription && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-border bg-card p-4 h-full">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Transcript
                </p>
                <div className="flex items-center rounded-md border border-border p-0.5">
                  <button
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                      viewMode === "sentences"
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setViewMode("sentences")}
                  >
                    Sentences
                  </button>
                  <button
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                      viewMode === "fulltext"
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setViewMode("fulltext")}
                  >
                    Full Text
                  </button>
                </div>
              </div>

              {viewMode === "sentences" ? (
                <TranscriptViewer
                  transcription={vm.transcription}
                  recordingId={id}
                  currentTime={currentTime}
                  onSeek={handleSeek}
                />
              ) : (
                <TranscriptFullText transcription={vm.transcription} />
              )}
            </div>
          </div>
          {vm.job?.isCompleted && (
            <div className="lg:col-span-1">
              <JobInfoCard
                model={vm.job.model}
                submitTime={vm.job.submitTime}
                endTime={vm.job.endTime}
                processingDuration={vm.job.processingDuration}
                usageSeconds={vm.job.usageSeconds}
                estimatedCost={vm.job.estimatedCost}
              />
            </div>
          )}
        </div>
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

/** Convert Unix ms to YYYY-MM-DD for <input type="date"> */
function toDateInputValue(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function MetadataGrid({
  fileName,
  fileSize,
  duration,
  format,
  sampleRate,
  createdAt,
  recordedAt,
  folderName,
  tags,
}: {
  fileName: string;
  fileSize: string;
  duration: string;
  format: string;
  sampleRate: string;
  createdAt: string;
  recordedAt: string;
  folderName: string;
  tags: TagType[];
}) {
  const items = [
    { label: "File", value: fileName },
    { label: "Size", value: fileSize },
    { label: "Duration", value: duration },
    { label: "Format", value: format },
    { label: "Sample Rate", value: sampleRate },
    { label: "Created", value: createdAt },
    ...(recordedAt ? [{ label: "Recorded", value: recordedAt }] : []),
    ...(folderName ? [{ label: "Folder", value: folderName }] : []),
  ];

  return (
    <div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-4">
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
            <Badge key={tag.id} variant="secondary" className="text-xs">
              {tag.name}
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
  model,
  submitTime,
  endTime,
  processingDuration,
  usageSeconds,
  estimatedCost,
}: {
  model: string;
  submitTime: string;
  endTime: string;
  processingDuration: string;
  usageSeconds: string;
  estimatedCost: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 h-full">
      <p className="mb-3 text-xs font-medium text-muted-foreground">
        Job Details
      </p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        <div>
          <p className="text-xs text-muted-foreground">Model</p>
          <p className="text-sm text-foreground font-mono">{model}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Audio Processed</p>
          <p className="text-sm text-foreground">{usageSeconds}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Estimated Cost</p>
          <p className="text-sm text-foreground">{estimatedCost}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Processing Time</p>
          <p className="text-sm text-foreground">{processingDuration}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Submitted</p>
          <p className="text-sm text-foreground">{submitTime}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Completed</p>
          <p className="text-sm text-foreground">{endTime}</p>
        </div>
      </div>
    </div>
  );
}

// ── AI Summary Card ──

function AiSummaryCard({
  summary,
  loading,
  error,
  onGenerate,
}: {
  summary: string | null;
  loading: boolean;
  error: string | null;
  onGenerate: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-muted-foreground">
          AI Summary
        </p>

        {/* Generate / Regenerate button */}
        {!loading && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-7 text-xs"
            onClick={onGenerate}
          >
            {summary ? (
              <>
                <RefreshCw className="h-3 w-3" strokeWidth={1.5} />
                Regenerate
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" strokeWidth={1.5} />
                Generate Summary
              </>
            )}
          </Button>
        )}
      </div>

      {/* Loading indicator (no text yet) */}
      {loading && !summary && (
        <div className="flex items-center gap-2 py-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Generating summary...</span>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="flex items-start gap-2 py-2">
          <AlertCircle
            className="h-4 w-4 shrink-0 text-destructive mt-0.5"
            strokeWidth={1.5}
          />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Summary content (shown during streaming and after completion) */}
      {summary && (
        <div>
          <Markdown>{summary}</Markdown>
          {loading && (
            <div className="flex items-center gap-1.5 mt-2 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="text-xs">Generating...</span>
            </div>
          )}
        </div>
      )}

      {/* Empty state (no summary, not loading, no error) */}
      {!summary && !loading && !error && (
        <p className="text-sm text-muted-foreground py-2">
          No summary yet. Click &ldquo;Generate Summary&rdquo; to create one
          from the transcription.
        </p>
      )}
    </div>
  );
}

// ── AI Info Card (sidebar) ──

function AiInfoCard({
  provider,
  model,
}: {
  provider: string;
  model: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 h-full">
      <p className="mb-3 text-xs font-medium text-muted-foreground">
        AI Configuration
      </p>
      <div className="space-y-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Settings className="h-3.5 w-3.5" strokeWidth={1.5} />
            Provider
          </p>
          <p className="mt-0.5 text-sm text-foreground">
            {provider || "Not configured"}
          </p>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Cpu className="h-3.5 w-3.5" strokeWidth={1.5} />
            Model
          </p>
          <p className="mt-0.5 text-sm text-foreground font-mono">
            {model || "Not configured"}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Editable Properties ──

function EditableProperties({
  title,
  onTitleChange,
  onTitleSave,
  titleSaving,
  notes,
  onNotesChange,
  onNotesSave,
  notesSaving,
  onSaveAll,
  isDirty,
  recordedAtDate,
  onRecordedAtChange,
  selectedTagIds,
  allTags,
  tagsOpen,
  onTagsOpenChange,
  onToggleTag,
  newTagName,
  onNewTagNameChange,
  onCreateTag,
  creatingTag,
  selectedFolderId,
  allFolders,
  folderOpen,
  onFolderOpenChange,
  onFolderChange,
}: {
  title: string;
  onTitleChange: (v: string) => void;
  onTitleSave: () => void;
  titleSaving: boolean;
  notes: string;
  onNotesChange: (v: string) => void;
  onNotesSave: () => void;
  notesSaving: boolean;
  onSaveAll: () => void;
  isDirty: boolean;
  recordedAtDate: string;
  onRecordedAtChange: (v: string) => void;
  selectedTagIds: string[];
  allTags: TagType[];
  tagsOpen: boolean;
  onTagsOpenChange: (open: boolean) => void;
  onToggleTag: (tagId: string) => void;
  newTagName: string;
  onNewTagNameChange: (v: string) => void;
  onCreateTag: () => void;
  creatingTag: boolean;
  selectedFolderId: string | null;
  allFolders: FolderType[];
  folderOpen: boolean;
  onFolderOpenChange: (open: boolean) => void;
  onFolderChange: (folderId: string | null) => void;
}) {
  const selectedFolder = allFolders.find((f) => f.id === selectedFolderId);

  return (
    <div className="rounded-xl border border-border bg-card p-4 h-full space-y-4">
      <p className="text-xs font-medium text-muted-foreground">Properties</p>

      {/* Title */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
          Title
          {titleSaving && (
            <Loader2 className="h-3 w-3 animate-spin" />
          )}
        </label>
        <Input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          onBlur={onTitleSave}
          placeholder="Recording title"
          className="w-full text-sm"
        />
      </div>

      {/* Recorded date */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" strokeWidth={1.5} />
          Recorded Date
        </label>
        <Input
          type="date"
          value={recordedAtDate}
          onChange={(e) => onRecordedAtChange(e.target.value)}
          className="w-full"
        />
      </div>

      {/* Folder picker */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Folder className="h-3.5 w-3.5" strokeWidth={1.5} />
          Folder
        </label>
        <Popover open={folderOpen} onOpenChange={onFolderOpenChange}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-between"
            >
              {selectedFolder ? (
                <span className="flex items-center gap-1.5 truncate">
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                  {selectedFolder.name}
                </span>
              ) : (
                <span className="text-muted-foreground">No folder</span>
              )}
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-0" align="start">
            <Command>
              <CommandList>
                <CommandGroup>
                  <CommandItem
                    onSelect={() => onFolderChange(null)}
                    className="gap-2"
                  >
                    <Check
                      className={`h-3.5 w-3.5 ${selectedFolderId === null ? "opacity-100" : "opacity-0"}`}
                    />
                    <span className="text-muted-foreground">No folder</span>
                  </CommandItem>
                  {allFolders.map((folder) => (
                    <CommandItem
                      key={folder.id}
                      onSelect={() => onFolderChange(folder.id)}
                      className="gap-2"
                    >
                      <Check
                        className={`h-3.5 w-3.5 ${selectedFolderId === folder.id ? "opacity-100" : "opacity-0"}`}
                      />
                      {folder.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Tags */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Tag className="h-3.5 w-3.5" strokeWidth={1.5} />
          Tags
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedTagIds.map((tagId) => {
            const tag = allTags.find((t) => t.id === tagId);
            if (!tag) return null;
            return (
              <Badge
                key={tag.id}
                variant="secondary"
                className="gap-1 text-xs cursor-pointer"
                onClick={() => onToggleTag(tag.id)}
              >
                {tag.name}
                <X className="h-3 w-3" strokeWidth={1.5} />
              </Badge>
            );
          })}
          <Popover open={tagsOpen} onOpenChange={onTagsOpenChange}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-7"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                Add tag
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-0" align="start">
              <Command>
                <CommandInput
                  placeholder="Search tags..."
                  value={newTagName}
                  onValueChange={onNewTagNameChange}
                />
                <CommandList>
                  <CommandEmpty>
                    {newTagName.trim() ? (
                      <button
                        className="flex w-full items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                        onClick={onCreateTag}
                        disabled={creatingTag}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Create &ldquo;{newTagName.trim()}&rdquo;
                      </button>
                    ) : (
                      "No tags found."
                    )}
                  </CommandEmpty>
                  <CommandGroup>
                    {allTags.map((tag) => (
                      <CommandItem
                        key={tag.id}
                        onSelect={() => onToggleTag(tag.id)}
                        className="gap-2"
                      >
                        <Check
                          className={`h-3.5 w-3.5 ${selectedTagIds.includes(tag.id) ? "opacity-100" : "opacity-0"}`}
                        />
                        {tag.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {newTagName.trim() &&
                    !allTags.some(
                      (t) =>
                        t.name.toLowerCase() === newTagName.trim().toLowerCase(),
                    ) && (
                      <>
                        <CommandSeparator />
                        <CommandGroup>
                          <CommandItem
                            onSelect={onCreateTag}
                            disabled={creatingTag}
                            className="gap-2"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Create &ldquo;{newTagName.trim()}&rdquo;
                          </CommandItem>
                        </CommandGroup>
                      </>
                    )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <StickyNote className="h-3.5 w-3.5" strokeWidth={1.5} />
          Notes
          {notesSaving && (
            <Loader2 className="h-3 w-3 animate-spin" />
          )}
        </label>
        <Textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          onBlur={onNotesSave}
          placeholder="Add notes about this recording..."
          className="min-h-20 text-sm"
        />
      </div>

      {/* Save button */}
      <Button
        size="sm"
        className="w-full gap-1.5"
        onClick={onSaveAll}
        disabled={!isDirty || titleSaving || notesSaving}
      >
        {titleSaving || notesSaving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
        )}
        {titleSaving || notesSaving ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}
