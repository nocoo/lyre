
import { useRef, useState, useCallback, useEffect } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Cpu,
  Download,
  FileText,
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
import { Link } from "react-router";
import { useNavigate } from "react-router";
import { useSetBreadcrumbs } from "@/components/layout";
import { useJobEvents } from "@/hooks/use-job-events";
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
import { getTagColor } from "@/lib/badge-colors";
import { cn } from "@/lib/utils";
import { RegenerateFeedbackDialog } from "@/components/regenerate-feedback-dialog";
import type {
  RecordingDetail,
  TranscriptionJob,
  Tag as TagType,
  Folder as FolderType,
} from "@lyre/api/contracts/recordings";

type PageParams = Record<string, never>;

export default function RecordingDetailPage(_props: PageParams) {
  const { id = "" } = useParams<{ id: string }>();

  useSetBreadcrumbs([
    { label: "Recordings", href: "/recordings" },
    { label: "Detail" },
  ]);

  return <RecordingDetailContent id={id} />;
}

/** Poll interval for job status in milliseconds */
const POLL_INTERVAL_MS = 3000;

function RecordingDetailContent({ id }: { id: string }) {
  const navigate = useNavigate();
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
  //
  // `aiSummary` / `aiSummaryStatus` / `aiSummaryError` mirror the server-side
  // recording columns. They are refreshed from GET /recordings/:id on load,
  // on any status-changing event, and (while status === "running") by a
  // bounded polling loop below.
  //
  // `manualStreamingText` holds the incrementally-decoded response body from
  // the manual POST /summarize call so the user sees text stream in. When
  // the stream finishes the server has already persisted the summary to the
  // DB, and a follow-up poll swaps `aiSummary` in from the authoritative
  // server copy.
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiSummaryStatus, setAiSummaryStatus] = useState<
    "running" | "succeeded" | "failed" | null
  >(null);
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null);
  const [manualStreamingText, setManualStreamingText] = useState<string | null>(
    null,
  );
  /** User-facing phase label ("Requesting AI…", "Streaming…", etc.). */
  const [summaryPhase, setSummaryPhase] = useState<string | null>(null);

  // AI settings (for info sidebar + auto-summarize)
  const [aiProvider, setAiProvider] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [autoSummarize, setAutoSummarize] = useState(false);

  // Regenerate-feedback dialog. Opens only when the user clicks
  // Regenerate on an existing summary — first-time Generate and Retry
  // stay one-click. Feedback is one-shot; not persisted anywhere.
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Persistence badge shown in the summary card header. Drives the
  // small corner indicator that replaces the old blocking "Saving…"
  // full-card state. Lifecycle:
  //   null      → hidden
  //   "saving"  → optimistic write is on screen, server round-trip in
  //               flight (either the manual stream just finished or a
  //               poll tick expected but hasn't confirmed yet)
  //   "saved"   → server confirmed persisted; auto-clears after 2.5s
  //   "failed"  → server reported failure; sticky until the next run
  //               so the user has time to see it
  const [saveIndicator, setSaveIndicator] = useState<
    "saving" | "saved" | "failed" | null
  >(null);

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
        setAiSummaryStatus(data.aiSummaryStatus ?? null);
        setAiSummaryError(data.aiSummaryError ?? null);
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

  const refreshDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/recordings/${id}`);
      if (res.ok) {
        const data = (await res.json()) as RecordingDetail;
        setDetail(data);
        setAiSummary(data.aiSummary ?? null);
        setAiSummaryStatus(data.aiSummaryStatus ?? null);
        setAiSummaryError(data.aiSummaryError ?? null);
        setSelectedTagIds(data.resolvedTags.map((t) => t.id));
        setSelectedFolderId(data.folderId);
        setRecordedAtDate(
          data.recordedAt ? toDateInputValue(data.recordedAt) : "",
        );
      }
    } catch {
      // silently fail
    }
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

  // ── Load AI settings (provider + model for info card, autoSummarize flag) ──
  const loadAiSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/ai");
      if (res.ok) {
        const data = (await res.json()) as {
          provider: string;
          model: string;
          autoSummarize: boolean;
        };
        setAiProvider(data.provider);
        setAiModel(data.model);
        setAutoSummarize(data.autoSummarize);
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

  // ── SSE-based job status updates ──
  // The server-side JobManager polls the ASR provider and pushes events via SSE.
  // We only subscribe when there's an active (non-terminal) job for this recording.
  useJobEvents({
    onEvent: useCallback(
      async (event) => {
        // Only react to events for this recording
        if (event.recordingId !== id) return;

        setPollStatus(event.status);

        if (event.status === "SUCCEEDED" || event.status === "FAILED") {
          setActiveJobId(null);
          // Refresh detail; the transcription-completion side effect on the
          // server sets aiSummaryStatus=running before starting the AI call
          // (when auto-summarize is enabled), and the polling effect below
          // will keep the UI in sync from there.
          await loadDetail();
        }
      },
      [id, loadDetail],
    ),
    jobId: activeJobId,
    enabled: !!activeJobId,
  });

  // ── Poll for summary status while a run is in flight ──
  //
  // Fires whenever the summary is `running` and there's no live manual
  // stream on screen. The manual stream path renders text incrementally
  // itself; the poll takes over from the moment the stream finishes
  // (manualStreamingText set back to null) and drives the corner save
  // indicator until the server confirms the summary is persisted.
  //
  // Two subtleties worth calling out because they killed the previous UX:
  //
  //   1. We DO NOT overwrite `aiSummary` while the server still shows
  //      `running`. The manual stream has already written an optimistic
  //      copy locally; the server row is still null during that window,
  //      so blindly mirroring the server would wipe the streamed text
  //      off screen (the old "Saving…" blank state).
  //   2. When the server flips to a terminal state, we prefer the server
  //      copy if it's non-empty (final wording may differ from what the
  //      client accumulated); on `failed` with no persisted text we
  //      leave the optimistic copy on screen so the user still has the
  //      draft they saw, plus a red badge and error message.
  //
  // Every exit path clears the timer.
  useEffect(() => {
    if (aiSummaryStatus !== "running") return;
    // Manual streaming path is responsible for its own progress display.
    if (manualStreamingText !== null) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let attempts = 0;
    const MAX_POLL_ATTEMPTS = 80; // 80 × 3s ≈ 4 minutes

    const stopPolling = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const pollOnce = async () => {
      attempts++;
      try {
        const res = await fetch(`/api/recordings/${id}`);
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as RecordingDetail;
          const serverStatus = data.aiSummaryStatus ?? null;
          setAiSummaryError(data.aiSummaryError ?? null);
          if (serverStatus === "running") {
            // Server still working. Keep the optimistic aiSummary on
            // screen; don't touch status either (it's already
            // "running").
            return;
          }
          // Terminal state — merge the server copy into local state.
          setAiSummaryStatus(serverStatus);
          if (serverStatus === "succeeded") {
            // Server copy wins (it may have canonical wording), but if
            // it comes back oddly empty keep whatever we have on screen.
            if (data.aiSummary) setAiSummary(data.aiSummary);
            setSaveIndicator("saved");
          } else if (serverStatus === "failed") {
            setSaveIndicator("failed");
            // Deliberately do NOT set aiSummary to null here — the
            // optimistic text remains visible so the user still sees
            // what was streamed, alongside the red badge / error.
          }
          stopPolling();
          return;
        }
      } catch {
        // Transient — try again on the next tick.
      }

      if (attempts >= MAX_POLL_ATTEMPTS) {
        setAiSummaryStatus("failed");
        setAiSummaryError(
          "Summary generation did not complete in time. Try again.",
        );
        setSaveIndicator("failed");
        stopPolling();
      }
    };

    timer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [aiSummaryStatus, manualStreamingText, id]);

  // Auto-dismiss the "saved" badge after a short window. "failed" stays
  // sticky because the user needs a chance to notice it; the next run
  // will reset the indicator explicitly.
  useEffect(() => {
    if (saveIndicator !== "saved") return;
    const t = setTimeout(() => setSaveIndicator(null), 2500);
    return () => clearTimeout(t);
  }, [saveIndicator]);

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
        navigate("/recordings");
      }
    } finally {
      setDeleting(false);
    }
  }, [id, navigate]);

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
  //
  // State flow with optimistic display:
  //   1. Reset: status="running", clear error/summary/badge, mark
  //      manualStreamingText="" so the poll effect stands down. This
  //      keeps the request phase spinner visible while we wait for the
  //      first byte.
  //   2. Stream body chunks into manualStreamingText; UI renders them
  //      incrementally.
  //   3. On stream end: OPTIMISTICALLY commit the accumulated text to
  //      aiSummary and clear manualStreamingText in a single tick. The
  //      card content stays visible — no blank "Saving…" gap. Flip the
  //      corner badge to "saving" so the user knows the server round-
  //      trip is still in flight, and let the poll effect drive it to
  //      "saved" / "failed" when the server confirms.
  //   4. Error paths flip status to "failed", surface a message, and
  //      set the badge to "failed" so the user sees it in the same
  //      spot as a successful save would have appeared.
  //
  // `feedback` is only set when the user came in through the Regenerate
  // dialog. It is sent one-shot to the server (see the summarize route)
  // and never stored locally.
  const handleSummarize = useCallback(
    async (feedback?: string) => {
      setAiSummaryStatus("running");
      setAiSummaryError(null);
      setAiSummary(null);
      setSaveIndicator(null);
      setManualStreamingText("");
      setSummaryPhase("Requesting AI…");

      try {
        const init: RequestInit = { method: "POST" };
        if (feedback && feedback.length > 0) {
          init.headers = { "content-type": "application/json" };
          init.body = JSON.stringify({ feedback });
        }
        const res = await fetch(`/api/recordings/${id}/summarize`, init);

        // Non-streaming error responses come back as JSON before the stream
        // starts. The server also flipped status back to "failed" already.
        if (!res.ok) {
          let message = "Unknown error";
          try {
            const data = (await res.json()) as { error?: string };
            message = data.error ?? message;
          } catch {
            // response body might not be JSON — fall back to statusText
            message = res.statusText || message;
          }
          setAiSummaryStatus("failed");
          setAiSummaryError(message);
          setManualStreamingText(null);
          setSummaryPhase(null);
          setSaveIndicator("failed");
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setAiSummaryStatus("failed");
          setAiSummaryError("Streaming not supported by browser.");
          setManualStreamingText(null);
          setSummaryPhase(null);
          setSaveIndicator("failed");
          return;
        }

        setSummaryPhase("Streaming response…");
        const decoder = new TextDecoder();
        let accumulated = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          setManualStreamingText(accumulated);
        }
        accumulated += decoder.decode();

        // Optimistic commit: promote the streamed text into `aiSummary`
        // and drop the streaming buffer in one tick. The card keeps
        // rendering the same text without flicker. Badge flips to
        // "saving" while the poll effect confirms with the server.
        setAiSummary(accumulated);
        setManualStreamingText(null);
        setSummaryPhase(null);
        setSaveIndicator("saving");
      } catch {
        setAiSummaryStatus("failed");
        setAiSummaryError("Network error — could not reach the server.");
        setManualStreamingText(null);
        setSummaryPhase(null);
        setSaveIndicator("failed");
      }
    },
    [id],
  );

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
    if (selectedFolderId !== (detail?.folderId ?? null)) {
      updates.folderId = selectedFolderId;
    }
    const origTagIds = detail?.resolvedTags.map((t) => t.id) ?? [];
    if (
      selectedTagIds.length !== origTagIds.length ||
      selectedTagIds.some((id) => !origTagIds.includes(id))
    ) {
      updates.tagIds = selectedTagIds;
    }
    const origDate = detail?.recordedAt
      ? toDateInputValue(detail.recordedAt)
      : "";
    if (recordedAtDate !== origDate) {
      updates.recordedAt = recordedAtDate
        ? new Date(recordedAtDate).getTime()
        : null;
    }
    if (Object.keys(updates).length === 0) return;
    setTitleSaving(true);
    await updateRecording(updates);
    await loadDetail();
    setTitleSaving(false);
    toast.success("Properties saved");
  }, [
    editTitle,
    notes,
    selectedFolderId,
    selectedTagIds,
    recordedAtDate,
    detail,
    updateRecording,
    loadDetail,
  ]);

  // ── Title save on blur ──
  const handleTitleSave = useCallback(async () => {
    const trimmed = editTitle.trim();
    if (!trimmed || trimmed === detail?.title) return;
    setTitleSaving(true);
    await updateRecording({ title: trimmed });
    await refreshDetail();
    setTitleSaving(false);
    toast.success("Title saved");
  }, [editTitle, detail?.title, updateRecording, refreshDetail]);

  // ── Notes save on blur ──
  const handleNotesSave = useCallback(async () => {
    if (notes === (detail?.notes ?? "")) return;
    setNotesSaving(true);
    await updateRecording({ notes: notes || null });
    setNotesSaving(false);
    toast.success("Notes saved");
  }, [notes, detail?.notes, updateRecording]);

  // ── Tag toggle ──
  const handleToggleTag = useCallback(
    (tagId: string) => {
      setSelectedTagIds((prev) =>
        prev.includes(tagId)
          ? prev.filter((t) => t !== tagId)
          : [...prev, tagId],
      );
    },
    [],
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
        setSelectedTagIds((prev) => [...prev, tag.id]);
      }
    } finally {
      setNewTagName("");
      setCreatingTag(false);
    }
  }, [newTagName]);

  // ── Folder change ──
  const handleFolderChange = useCallback(
    (folderId: string | null) => {
      setSelectedFolderId(folderId);
      setFolderOpen(false);
    },
    [],
  );

  // ── RecordedAt change ──
  const handleRecordedAtChange = useCallback(
    (dateStr: string) => {
      setRecordedAtDate(dateStr);
    },
    [],
  );

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!detail) return <NotFound />;

  const vm = toRecordingDetailVM(detail);

  const originalTagIds = new Set(detail.resolvedTags.map((t) => t.id));
  const propertiesDirty =
    (editTitle.trim() !== "" && editTitle.trim() !== detail.title) ||
    notes !== (detail.notes ?? "") ||
    selectedFolderId !== (detail.folderId ?? null) ||
    selectedTagIds.length !== originalTagIds.size ||
    selectedTagIds.some((id) => !originalTagIds.has(id)) ||
    recordedAtDate !==
      (detail.recordedAt ? toDateInputValue(detail.recordedAt) : "");

  return (
    <div className="space-y-5">
      {/* Back link + header */}
      <div className="space-y-4">
        <Link
          to="/recordings"
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

      {/* ── Row 1: Player + Metadata (2/3) | Properties (1/3) ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-card bg-secondary p-4 h-full flex flex-col gap-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Play className="h-3.5 w-3.5" strokeWidth={1.5} />
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
            isDirty={propertiesDirty}
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

      {/* Transcribing / Error banners (full width) */}
      {(activeJobId || vm.isTranscribing) && (
        <TranscribingCard status={pollStatus} />
      )}
      {vm.job?.isFailed && !activeJobId && (
        <JobErrorCard message={vm.job.errorMessage} />
      )}

      {/* ── Row 2: AI Summary (2/3) | AI Info (1/3) ── */}
      {vm.hasTranscription && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <AiSummaryCard
              summary={aiSummary}
              streamingText={manualStreamingText}
              status={aiSummaryStatus}
              phase={summaryPhase}
              error={aiSummaryError}
              autoSummarizeEnabled={autoSummarize}
              saveIndicator={saveIndicator}
              onGenerate={() => void handleSummarize()}
              onRegenerate={() => setFeedbackOpen(true)}
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
            <div className="rounded-card bg-secondary p-4 h-full">
              <div className="flex items-center justify-between mb-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" strokeWidth={1.5} />
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

      <RegenerateFeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        onSubmit={(feedback) => {
          setFeedbackOpen(false);
          // Empty string is fine — handleSummarize treats "" the same
          // as undefined and skips the JSON body.
          void handleSummarize(feedback);
        }}
      />
    </div>
  );
}

// ── Sub-components ──

function NotFound() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center text-muted-foreground">
      <p className="text-lg font-medium">Recording not found</p>
      <p className="mt-1 text-sm">
        The recording you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link to="/recordings">
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
          {tags.map((tag) => {
            const color = getTagColor(tag.name);
            return (
              <span
                key={tag.id}
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                  color.bg,
                  color.text,
                )}
              >
                {tag.name}
              </span>
            );
          })}
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
    <div className="flex items-center gap-3 rounded-card bg-secondary p-4">
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
    <div className="rounded-card bg-secondary p-4 h-full">
      <p className="flex items-center gap-1.5 mb-3 text-xs font-medium text-muted-foreground">
        <Cpu className="h-3.5 w-3.5" strokeWidth={1.5} />
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

/**
 * AI summary card. Display precedence:
 *   - Any streamed / persisted / optimistic text goes into `display` and
 *     is rendered as markdown. Once we have content, we keep showing it
 *     — including after a failed persist — so the user never watches
 *     their result vanish.
 *   - `status === "running"` with no content yet shows the phase
 *     spinner (request → stream). Once the stream commits optimistically
 *     the running spinner steps aside and the corner save badge takes
 *     over.
 *   - `saveIndicator` renders a compact chip in the header
 *     ("Saving…" / "Saved" / "Save failed") so persistence state is
 *     acknowledged without hijacking the body.
 *   - `status === "failed"` shows an inline error line BELOW the
 *     content (not replacing it) so the user still has the draft plus
 *     a clear reason and Retry button.
 *   - Never-attempted (status null, no content) shows the empty-state
 *     hint and Generate button.
 */
function AiSummaryCard({
  summary,
  streamingText,
  status,
  phase,
  error,
  autoSummarizeEnabled,
  saveIndicator,
  onGenerate,
  onRegenerate,
}: {
  summary: string | null;
  streamingText: string | null;
  status: "running" | "succeeded" | "failed" | null;
  phase: string | null;
  error: string | null;
  autoSummarizeEnabled: boolean;
  /** Header corner chip: "saving" / "saved" / "failed" / null. */
  saveIndicator: "saving" | "saved" | "failed" | null;
  /** Retry (from failed state) and first-time Generate. One-click. */
  onGenerate: () => void;
  /** Regenerate an existing summary. Opens the feedback dialog. */
  onRegenerate: () => void;
}) {
  const isRunning = status === "running";
  // Optimistic-first display: while manual streaming is arriving, show
  // that; otherwise show the persisted (or committed-optimistic) copy.
  const display = streamingText ?? summary;
  const hasContent = display !== null && display.length > 0;

  const runningLabel = phase
    ? phase
    : autoSummarizeEnabled && !hasContent
      ? "Auto-summarizing after transcription…"
      : "Generating summary…";

  // Regenerate is the ONLY action that opens the feedback dialog; Retry
  // and first-time Generate stay one-click so nothing surprises users
  // who never had a previous summary to react to.
  const isRegenerate = summary !== null && status !== "failed";
  const buttonHandler = isRegenerate ? onRegenerate : onGenerate;

  return (
    <div className="rounded-card bg-secondary p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
            AI Summary
          </p>
          <SaveIndicatorChip indicator={saveIndicator} error={error} />
        </div>

        {/* Generate / Regenerate / Retry button — hidden while running */}
        {!isRunning && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-7 text-xs"
            onClick={buttonHandler}
          >
            {status === "failed" ? (
              <>
                <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
                Retry
              </>
            ) : summary ? (
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

      {/* Running: spinner + phase text (only while we don't have any
          content yet — once streaming starts producing text the body
          renders markdown and the running hint moves inline below it). */}
      {isRunning && !hasContent && (
        <div className="flex items-center gap-2 py-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">{runningLabel}</span>
        </div>
      )}

      {/* Content: streaming text (manual), optimistic commit, or
          persisted summary. Shown even in `failed` state so the user
          keeps the draft they saw. */}
      {hasContent && (
        <div>
          <Markdown>{display ?? ""}</Markdown>
          {isRunning && (
            <div className="flex items-center gap-1.5 mt-2 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="text-xs">{runningLabel}</span>
            </div>
          )}
        </div>
      )}

      {/* Error state — inline note below the content (or standalone
          when there's nothing to show). Text is kept on screen; the
          badge in the header is the primary signal. */}
      {status === "failed" && !isRunning && (
        <div
          className={cn(
            "flex items-start gap-2",
            hasContent ? "mt-3" : "py-2",
          )}
        >
          <AlertCircle
            className="h-4 w-4 shrink-0 text-destructive mt-0.5"
            strokeWidth={1.5}
          />
          <p className="text-sm text-destructive">
            {error ?? "Summary generation failed. Try Retry."}
          </p>
        </div>
      )}

      {/* Empty state (never attempted, no error) */}
      {!hasContent && !isRunning && status !== "failed" && (
        <p className="text-sm text-muted-foreground py-2">
          No summary yet. Click &ldquo;Generate Summary&rdquo; to create one
          from the transcription.
        </p>
      )}
    </div>
  );
}

/**
 * Compact chip that sits next to the "AI Summary" title. Renders one
 * of three visual states; nothing when `indicator` is null. Failure
 * hover shows the server error message so the user has actionable
 * context without needing to scroll.
 */
function SaveIndicatorChip({
  indicator,
  error,
}: {
  indicator: "saving" | "saved" | "failed" | null;
  error: string | null;
}) {
  if (indicator === null) return null;
  if (indicator === "saving") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
        Saving…
      </span>
    );
  }
  if (indicator === "saved") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />
        Saved
      </span>
    );
  }
  // failed
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive"
      title={error ?? "Save failed"}
    >
      <AlertCircle className="h-3 w-3" strokeWidth={1.5} />
      Save failed
    </span>
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
    <div className="rounded-card bg-secondary p-4 h-full">
      <p className="flex items-center gap-1.5 mb-3 text-xs font-medium text-muted-foreground">
        <Settings className="h-3.5 w-3.5" strokeWidth={1.5} />
        AI Configuration
      </p>
      <div className="space-y-3">
        <div>
          <p className="text-xs text-muted-foreground">
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
    <div className="rounded-card bg-secondary p-4 h-full space-y-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
        Properties
      </p>

      {/* Title */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
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
            const color = getTagColor(tag.name);
            return (
              <span
                key={tag.id}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium cursor-pointer",
                  color.bg,
                  color.text,
                )}
                role="button"
                tabIndex={0}
                onClick={() => onToggleTag(tag.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onToggleTag(tag.id);
                  }
                }}
              >
                {tag.name}
                <X className="h-3 w-3" strokeWidth={1.5} />
              </span>
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
                    {allTags.map((tag) => {
                      const color = getTagColor(tag.name);
                      return (
                        <CommandItem
                          key={tag.id}
                          onSelect={() => onToggleTag(tag.id)}
                          className="gap-2"
                        >
                          <Check
                            className={`h-3.5 w-3.5 ${selectedTagIds.includes(tag.id) ? "opacity-100" : "opacity-0"}`}
                          />
                          <span
                            className={cn(
                              "h-2.5 w-2.5 rounded-full shrink-0",
                              color.bg,
                            )}
                          />
                          {tag.name}
                        </CommandItem>
                      );
                    })}
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
