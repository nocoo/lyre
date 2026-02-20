"use client";

import { useRef, useEffect, useState, useCallback, forwardRef } from "react";
import { Loader2, ChevronDown, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  findActiveSentenceIndex,
  findActiveWordIndex,
  toWordVM,
  type TranscriptionVM,
  type SentenceVM,
  type WordVM,
  type RawWord,
} from "@/lib/recording-detail-vm";

// ── Types for word data from API ──

interface SentenceWordsResponse {
  sentenceId: number;
  words: RawWord[];
}

interface WordDataResponse {
  sentences: SentenceWordsResponse[];
}

/** Cache of word data keyed by recording ID */
const wordDataCache = new Map<string, Map<number, WordVM[]>>();

// ── Public components ──

interface TranscriptViewerProps {
  transcription: TranscriptionVM;
  /** Recording ID for lazy-loading word data */
  recordingId: string;
  /** Current audio playback time in seconds (for sentence highlighting) */
  currentTime?: number;
  /** Called when user clicks a sentence timestamp to seek */
  onSeek?: (timeInSeconds: number) => void;
}

export function TranscriptViewer({
  transcription,
  recordingId,
  currentTime = 0,
  onSeek,
}: TranscriptViewerProps) {
  const activeIndex = findActiveSentenceIndex(
    transcription.sentences,
    currentTime,
  );

  return (
    <div className="rounded-xl border border-border bg-card">
      {/* Tab header */}
      <TranscriptTabs
        sentenceCount={transcription.sentenceCount}
        wordCount={transcription.wordCount}
        language={transcription.language}
        copyText={transcription.fullText}
      />

      {/* Content */}
      <div className="p-4">
        <SentenceList
          sentences={transcription.sentences}
          recordingId={recordingId}
          activeIndex={activeIndex}
          currentTime={currentTime}
          onSeek={onSeek}
        />
      </div>
    </div>
  );
}

/** Full-text view of the transcript */
export function TranscriptFullText({
  transcription,
}: {
  transcription: TranscriptionVM;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <TranscriptTabs
        sentenceCount={transcription.sentenceCount}
        wordCount={transcription.wordCount}
        language={transcription.language}
        copyText={transcription.fullText}
      />
      <div className="p-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {transcription.fullText}
        </p>
      </div>
    </div>
  );
}

// ── Internal components ──

function TranscriptTabs({
  sentenceCount,
  wordCount,
  language,
  copyText,
}: {
  sentenceCount: number;
  wordCount: number;
  language: string;
  copyText: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in insecure contexts — silently ignore
    }
  }, [copyText]);

  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
      <span className="text-sm font-medium text-foreground">Transcript</span>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{sentenceCount} sentences</span>
        <span>{wordCount} words</span>
        <span className="uppercase">{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy transcript"}
          className={cn(
            "ml-1 flex h-6 w-6 items-center justify-center rounded-md transition-colors",
            copied
              ? "text-emerald-500"
              : "text-muted-foreground hover:text-foreground hover:bg-accent",
          )}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
        </button>
      </div>
    </div>
  );
}

function SentenceList({
  sentences,
  recordingId,
  activeIndex,
  currentTime,
  onSeek,
}: {
  sentences: SentenceVM[];
  recordingId: string;
  activeIndex: number;
  currentTime: number;
  onSeek: ((timeInSeconds: number) => void) | undefined;
}) {
  const activeRef = useRef<HTMLDivElement>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { wordsBySentence, loading, fetchWords } =
    useWordData(recordingId);

  // Auto-scroll to active sentence
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [activeIndex]);

  const handleToggle = useCallback(
    (sentenceId: number) => {
      if (expandedId === sentenceId) {
        setExpandedId(null);
      } else {
        setExpandedId(sentenceId);
        // Lazy-fetch word data if not already cached
        if (!wordsBySentence) {
          fetchWords();
        }
      }
    },
    [expandedId, wordsBySentence, fetchWords],
  );

  return (
    <div className="space-y-1">
      {sentences.map((sentence, idx) => (
        <SentenceRow
          key={sentence.id}
          ref={idx === activeIndex ? activeRef : undefined}
          sentence={sentence}
          isActive={idx === activeIndex}
          isExpanded={expandedId === sentence.id}
          words={wordsBySentence?.get(sentence.id) ?? null}
          wordsLoading={loading && expandedId === sentence.id}
          currentTime={currentTime}
          onSeek={onSeek}
          onToggle={handleToggle}
        />
      ))}
    </div>
  );
}

const SentenceRow = forwardRef<
  HTMLDivElement,
  {
    sentence: SentenceVM;
    isActive: boolean;
    isExpanded: boolean;
    words: WordVM[] | null;
    wordsLoading: boolean;
    currentTime: number;
    onSeek: ((timeInSeconds: number) => void) | undefined;
    onToggle: (sentenceId: number) => void;
  }
>(function SentenceRow(
  {
    sentence,
    isActive,
    isExpanded,
    words,
    wordsLoading,
    currentTime,
    onSeek,
    onToggle,
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-lg transition-colors",
        isActive && "bg-accent",
      )}
    >
      {/* Sentence header row */}
      <div className="group flex items-start gap-3 px-3 py-2">
        {/* Timestamp button */}
        <button
          type="button"
          className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => onSeek?.(sentence.beginTimeMs / 1000)}
          aria-label={`Seek to ${sentence.startTime}`}
        >
          {sentence.startTime}
        </button>

        {/* Sentence text — clickable to expand */}
        <button
          type="button"
          className="flex-1 text-left text-sm leading-relaxed text-foreground hover:text-foreground/80 transition-colors"
          onClick={() => onToggle(sentence.id)}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? "Collapse word details" : "Expand word details"}
        >
          {sentence.text}
        </button>

        {/* Expand indicator */}
        <ChevronDown
          className={cn(
            "mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-200",
            isExpanded && "rotate-180",
          )}
          strokeWidth={1.5}
        />
      </div>

      {/* Expanded word-level view */}
      {isExpanded && (
        <div className="px-3 pb-3">
          <div className="ml-[calc(theme(spacing.3)+theme(fontSize.xs.1.lineHeight))] rounded-md bg-muted/50 px-3 py-2">
            {wordsLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading word data...
              </div>
            ) : words && words.length > 0 ? (
              <WordKaraoke
                words={words}
                currentTime={currentTime}
                onSeek={onSeek}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                No word-level data available
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

/** Karaoke-style word display with active word highlighting */
function WordKaraoke({
  words,
  currentTime,
  onSeek,
}: {
  words: WordVM[];
  currentTime: number;
  onSeek: ((timeInSeconds: number) => void) | undefined;
}) {
  const activeWordIndex = findActiveWordIndex(words, currentTime);

  return (
    <p className="text-sm leading-relaxed">
      {words.map((word, idx) => (
        <span
          key={`${word.beginTimeMs}-${idx}`}
          className={cn(
            "cursor-pointer rounded-sm transition-colors duration-100",
            idx === activeWordIndex
              ? "bg-primary/20 text-primary font-medium"
              : "text-foreground/80 hover:text-foreground hover:bg-muted",
          )}
          onClick={() => onSeek?.(word.beginTimeMs / 1000)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSeek?.(word.beginTimeMs / 1000);
            }
          }}
          aria-label={`Seek to word "${word.text}" at ${(word.beginTimeMs / 1000).toFixed(1)}s`}
        >
          {word.display}
        </span>
      ))}
    </p>
  );
}

// ── Hook: lazy-fetch word data ──

function useWordData(recordingId: string) {
  const [wordsBySentence, setWordsBySentence] = useState<Map<
    number,
    WordVM[]
  > | null>(() => wordDataCache.get(recordingId) ?? null);
  const [loading, setLoading] = useState(false);

  const fetchWords = useCallback(async () => {
    // Already cached in module-level cache
    if (wordDataCache.has(recordingId)) {
      setWordsBySentence(wordDataCache.get(recordingId)!);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/words`);
      if (!res.ok) {
        setLoading(false);
        return;
      }

      const data = (await res.json()) as WordDataResponse;
      const map = new Map<number, WordVM[]>();

      for (const s of data.sentences) {
        map.set(s.sentenceId, s.words.map(toWordVM));
      }

      wordDataCache.set(recordingId, map);
      setWordsBySentence(map);
    } catch {
      // Silently fail — UI shows "no word data"
    } finally {
      setLoading(false);
    }
  }, [recordingId]);

  return { wordsBySentence, loading, fetchWords };
}
