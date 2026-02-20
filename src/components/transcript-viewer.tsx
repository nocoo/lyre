"use client";

import { useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  findActiveSentenceIndex,
  type TranscriptionVM,
  type SentenceVM,
} from "@/lib/recording-detail-vm";

interface TranscriptViewerProps {
  transcription: TranscriptionVM;
  /** Current audio playback time in seconds (for sentence highlighting) */
  currentTime?: number;
  /** Called when user clicks a sentence timestamp to seek */
  onSeek?: (timeInSeconds: number) => void;
}

export function TranscriptViewer({
  transcription,
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
      />

      {/* Content */}
      <div className="p-4">
        <SentenceList
          sentences={transcription.sentences}
          activeIndex={activeIndex}
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
      />
      <div className="p-4">
        <ScrollArea className="max-h-[400px]">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {transcription.fullText}
          </p>
        </ScrollArea>
      </div>
    </div>
  );
}

// ── Internal components ──

function TranscriptTabs({
  sentenceCount,
  wordCount,
  language,
}: {
  sentenceCount: number;
  wordCount: number;
  language: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
      <span className="text-sm font-medium text-foreground">Transcript</span>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{sentenceCount} sentences</span>
        <span>{wordCount} words</span>
        <span className="uppercase">{language}</span>
      </div>
    </div>
  );
}

function SentenceList({
  sentences,
  activeIndex,
  onSeek,
}: {
  sentences: SentenceVM[];
  activeIndex: number;
  onSeek?: (timeInSeconds: number) => void;
}) {
  const activeRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to active sentence
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [activeIndex]);

  return (
    <ScrollArea className="max-h-[400px]">
      <div className="space-y-1">
        {sentences.map((sentence, idx) => (
          <SentenceRow
            key={sentence.id}
            ref={idx === activeIndex ? activeRef : undefined}
            sentence={sentence}
            isActive={idx === activeIndex}
            onSeek={onSeek}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

import { forwardRef } from "react";

const SentenceRow = forwardRef<
  HTMLDivElement,
  {
    sentence: SentenceVM;
    isActive: boolean;
    onSeek?: (timeInSeconds: number) => void;
  }
>(function SentenceRow({ sentence, isActive, onSeek }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "group flex gap-3 rounded-lg px-3 py-2 transition-colors",
        isActive && "bg-accent",
      )}
    >
      {/* Timestamp button */}
      <button
        type="button"
        className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => onSeek?.(sentence.beginTimeMs / 1000)}
        aria-label={`Seek to ${sentence.startTime}`}
      >
        {sentence.startTime}
      </button>

      {/* Sentence text */}
      <p className="flex-1 text-sm leading-relaxed text-foreground">
        {sentence.text}
      </p>
    </div>
  );
});
