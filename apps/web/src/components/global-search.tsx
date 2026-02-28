"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, FolderOpen, Clock } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { formatDuration, formatRelativeTime } from "@/lib/recordings-list-vm";

interface SearchResult {
  id: string;
  title: string;
  description: string | null;
  status: string;
  aiSummary: string | null;
  folder: { id: string; name: string; icon: string } | null;
  resolvedTags: { id: string; name: string }[];
  duration: number | null;
  createdAt: number;
}

/**
 * Global search dialog triggered by Cmd+K.
 * Renders as a CommandDialog overlay — no visible trigger element.
 * The sidebar dispatches the keydown event to open this.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!open || !query.trim()) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal },
        );
        if (res.ok) {
          const data = (await res.json()) as { results: SearchResult[] };
          setResults(data.results);
        }
      } catch {
        // Aborted or network error — ignore
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  const handleSelect = useCallback(
    (id: string) => {
      setOpen(false);
      setQuery("");
      router.push(`/recordings/${id}`);
    },
    [router],
  );

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search Recordings"
      description="Search by title, description, AI summary, or tags"
    >
      <CommandInput
        placeholder="Search recordings..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {loading && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Searching...
          </div>
        )}
        {!loading && query.trim() && results.length === 0 && (
          <CommandEmpty>No recordings found.</CommandEmpty>
        )}
        {!loading && !query.trim() && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Type to search recordings...
          </div>
        )}
        {results.length > 0 && (
          <CommandGroup heading="Recordings">
            {results.map((result) => (
              <CommandItem
                key={result.id}
                value={`${result.title} ${result.resolvedTags.map(t => t.name).join(" ")} ${result.aiSummary ?? ""}`}
                onSelect={() => handleSelect(result.id)}
                className="gap-3 cursor-pointer"
              >
                <Mic
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {result.title}
                    </span>
                    <Badge
                      variant={
                        result.status === "completed"
                          ? "success"
                          : result.status === "failed"
                            ? "destructive"
                            : result.status === "transcribing"
                              ? "warning"
                              : "secondary"
                      }
                      className="text-[10px] shrink-0"
                    >
                      {result.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    {result.folder && (
                      <span className="flex items-center gap-1">
                        <FolderOpen className="h-3 w-3" strokeWidth={1.5} />
                        {result.folder.name}
                      </span>
                    )}
                    {result.duration !== null && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" strokeWidth={1.5} />
                        {formatDuration(result.duration)}
                      </span>
                    )}
                    <span>{formatRelativeTime(result.createdAt)}</span>
                  </div>
                  {result.aiSummary && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                      {result.aiSummary}
                    </p>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
