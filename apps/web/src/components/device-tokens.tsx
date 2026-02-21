"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Smartphone,
  Plus,
  Trash2,
  Copy,
  Check,
  Loader2,
  Key,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface TokenListItem {
  id: string;
  name: string;
  lastUsedAt: number | null;
  createdAt: number;
}

interface NewToken {
  id: string;
  name: string;
  token: string;
  createdAt: number;
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function DeviceTokensSection() {
  const [tokens, setTokens] = useState<TokenListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newlyCreated, setNewlyCreated] = useState<NewToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/tokens");
      if (res.ok) {
        const data = (await res.json()) as { items: TokenListItem[] };
        setTokens(data.items);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const handleCreate = useCallback(async () => {
    const name = newTokenName.trim();
    if (!name) return;

    setCreating(true);
    try {
      const res = await fetch("/api/settings/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const data = (await res.json()) as NewToken;
        setNewlyCreated(data);
        setNewTokenName("");
        setShowCreate(false);
        await fetchTokens();
      }
    } finally {
      setCreating(false);
    }
  }, [newTokenName, fetchTokens]);

  const handleCopy = useCallback(async () => {
    if (!newlyCreated) return;
    await navigator.clipboard.writeText(newlyCreated.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [newlyCreated]);

  const handleDismissNewToken = useCallback(() => {
    setNewlyCreated(null);
    setCopied(false);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        const res = await fetch(`/api/settings/tokens/${id}`, {
          method: "DELETE",
        });
        if (res.ok) {
          await fetchTokens();
          // If the deleted token was the newly created one, dismiss the banner
          if (newlyCreated?.id === id) {
            setNewlyCreated(null);
          }
        }
      } finally {
        setDeletingId(null);
      }
    },
    [fetchTokens, newlyCreated],
  );

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
            <Key className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <div>
            <h2 className="text-sm font-medium text-foreground">
              Device Tokens
            </h2>
            <p className="text-xs text-muted-foreground">
              Generate tokens for programmatic API access (e.g. macOS app).
            </p>
          </div>
        </div>
        {!showCreate && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            New Token
          </Button>
        )}
      </div>

      {/* Newly created token banner */}
      {newlyCreated && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950">
          <p className="mb-2 text-xs font-medium text-green-800 dark:text-green-200">
            Token created! Copy it now — it won&apos;t be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-green-100 px-2 py-1 font-mono text-xs text-green-900 dark:bg-green-900 dark:text-green-100">
              {newlyCreated.token}
            </code>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <button
            onClick={handleDismissNewToken}
            className="mt-2 text-xs text-green-700 underline hover:text-green-900 dark:text-green-300 dark:hover:text-green-100"
          >
            I&apos;ve copied the token, dismiss
          </button>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="mb-4 flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-sm">Token name</Label>
            <Input
              value={newTokenName}
              onChange={(e) => setNewTokenName(e.target.value)}
              placeholder='e.g. "MacBook Pro", "Office Mac"'
              className="mt-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") {
                  setShowCreate(false);
                  setNewTokenName("");
                }
              }}
            />
          </div>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={creating || !newTokenName.trim()}
            className="gap-1.5"
          >
            {creating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Create
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowCreate(false);
              setNewTokenName("");
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Token list */}
      {tokens.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Smartphone className="mb-2 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No device tokens yet.
          </p>
          <p className="text-xs text-muted-foreground/70">
            Create one to connect your macOS app or other devices.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {tokens.map((token) => (
            <div
              key={token.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{token.name}</span>
                  {token.lastUsedAt && (
                    <Badge variant="secondary" className="text-[10px]">
                      Used {formatRelativeTime(token.lastUsedAt)}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Created {formatRelativeTime(token.createdAt)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(token.id)}
                disabled={deletingId === token.id}
              >
                {deletingId === token.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
