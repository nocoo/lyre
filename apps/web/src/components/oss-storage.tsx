/**
 * OSS storage management component.
 *
 * Displays a full audit of OSS objects grouped by user, with orphan detection
 * and batch cleanup capabilities.
 */

"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import {
  RefreshCw,
  Trash2,
  ChevronRight,
  ChevronDown,
  User,
  FileAudio,
  FileText,
  File,
  AlertTriangle,
  CheckCircle,
  Loader2,
  FolderOpen,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

// ── Types (matching API response) ──

interface FileInfo {
  key: string;
  size: number;
  lastModified: string;
  hasDbRecord: boolean;
}

interface TaskFolder {
  id: string;
  files: FileInfo[];
  totalSize: number;
  hasDbRecord: boolean;
}

interface BucketSection {
  folders: TaskFolder[];
  totalSize: number;
  totalFiles: number;
  orphanFolders: number;
  orphanSize: number;
}

interface UserBucket {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  uploads: BucketSection;
  results: BucketSection;
}

interface OssScanResult {
  users: UserBucket[];
  unlinkedResults: TaskFolder[];
  summary: {
    totalSize: number;
    totalFiles: number;
    totalOrphanFiles: number;
    totalOrphanSize: number;
  };
}

// ── Helpers ──

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`;
}

function getFileIcon(key: string) {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  if (["wav", "mp3", "m4a", "ogg", "flac", "aac", "webm"].includes(ext)) {
    return <FileAudio className="h-3.5 w-3.5 text-blue-500" strokeWidth={1.5} />;
  }
  if (["json", "txt", "md"].includes(ext)) {
    return <FileText className="h-3.5 w-3.5 text-amber-500" strokeWidth={1.5} />;
  }
  return <File className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />;
}

function getFileName(key: string): string {
  return key.split("/").pop() ?? key;
}

// ── Summary cards ──

function SummaryCard({
  label,
  value,
  sub,
  variant = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  variant?: "default" | "warning" | "success";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        variant === "warning" && "border-amber-500/30 bg-amber-500/5",
        variant === "success" && "border-green-500/30 bg-green-500/5",
        variant === "default" && "border-border bg-card",
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold mt-0.5">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Folder row (expandable) ──

function FolderRow({
  folder,
  selected,
  onToggleSelect,
}: {
  folder: TaskFolder;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isOrphan = !folder.hasDbRecord;

  return (
    <div className={cn("border-b border-border last:border-b-0", isOrphan && "bg-amber-500/5")}>
      <div className="flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors">
        {isOrphan && (
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            aria-label={`Select orphan folder ${folder.id}`}
          />
        )}
        {!isOrphan && <span className="w-4" />}

        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
        </button>

        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" strokeWidth={1.5} />

        <span className="text-sm font-mono text-foreground truncate flex-1">
          {folder.id}
        </span>

        <span className="text-xs text-muted-foreground shrink-0">
          {folder.files.length} {folder.files.length === 1 ? "file" : "files"}
        </span>

        <span className="text-xs font-mono text-muted-foreground shrink-0 w-16 text-right">
          {formatBytes(folder.totalSize)}
        </span>

        {isOrphan ? (
          <Badge variant="warning" className="text-[10px] shrink-0">
            orphan
          </Badge>
        ) : (
          <Badge variant="success" className="text-[10px] shrink-0">
            linked
          </Badge>
        )}
      </div>

      {expanded && (
        <div className="pl-14 pr-3 pb-2 space-y-0.5">
          {folder.files.map((file) => (
            <div
              key={file.key}
              className="flex items-center gap-2 py-1 text-xs"
            >
              {getFileIcon(file.key)}
              <span className="text-muted-foreground truncate flex-1">
                {getFileName(file.key)}
              </span>
              <span className="text-muted-foreground font-mono shrink-0">
                {formatBytes(file.size)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── User section ──

function UserSection({
  user,
  selectedKeys,
  onToggleFolder,
}: {
  user: UserBucket;
  selectedKeys: Set<string>;
  onToggleFolder: (folderKeys: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const totalSize = user.uploads.totalSize + user.results.totalSize;
  const totalFiles = user.uploads.totalFiles + user.results.totalFiles;
  const totalOrphans =
    user.uploads.orphanFolders + user.results.orphanFolders;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* User header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
        )}

        <User className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} />

        <div className="flex-1 text-left min-w-0">
          <span className="text-sm font-medium text-foreground">
            {user.userName ?? user.userId}
          </span>
          {user.userEmail && (
            <span className="text-xs text-muted-foreground ml-2">
              {user.userEmail}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-muted-foreground">
            {totalFiles} files
          </span>
          <span className="text-sm font-mono font-medium">
            {formatBytes(totalSize)}
          </span>
          {totalOrphans > 0 && (
            <Badge variant="warning" className="text-[10px]">
              {totalOrphans} orphan{totalOrphans > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border">
          {/* Uploads section */}
          {user.uploads.folders.length > 0 && (
            <div>
              <div className="px-4 py-2 bg-secondary/30">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Uploads
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {user.uploads.totalFiles} files &middot; {formatBytes(user.uploads.totalSize)}
                  </span>
                  {user.uploads.orphanFolders > 0 && (
                    <span className="text-xs text-amber-500">
                      ({user.uploads.orphanFolders} orphan, {formatBytes(user.uploads.orphanSize)})
                    </span>
                  )}
                </div>
              </div>
              {user.uploads.folders.map((folder) => {
                const folderFileKeys = folder.files.map((f) => f.key);
                const allSelected = folderFileKeys.every((k) =>
                  selectedKeys.has(k),
                );
                return (
                  <FolderRow
                    key={folder.id}
                    folder={folder}
                    selected={allSelected}
                    onToggleSelect={() => onToggleFolder(folderFileKeys)}
                  />
                );
              })}
            </div>
          )}

          {/* Results section */}
          {user.results.folders.length > 0 && (
            <div>
              <div className="px-4 py-2 bg-secondary/30">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Results
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {user.results.totalFiles} files &middot; {formatBytes(user.results.totalSize)}
                  </span>
                  {user.results.orphanFolders > 0 && (
                    <span className="text-xs text-amber-500">
                      ({user.results.orphanFolders} orphan, {formatBytes(user.results.orphanSize)})
                    </span>
                  )}
                </div>
              </div>
              {user.results.folders.map((folder) => {
                const folderFileKeys = folder.files.map((f) => f.key);
                const allSelected = folderFileKeys.every((k) =>
                  selectedKeys.has(k),
                );
                return (
                  <FolderRow
                    key={folder.id}
                    folder={folder}
                    selected={allSelected}
                    onToggleSelect={() => onToggleFolder(folderFileKeys)}
                  />
                );
              })}
            </div>
          )}

          {user.uploads.folders.length === 0 &&
            user.results.folders.length === 0 && (
              <p className="px-4 py-3 text-xs text-muted-foreground">
                No files found.
              </p>
            )}
        </div>
      )}
    </div>
  );
}

// ── Main component ──

export function OssStorageSection() {
  const [data, setData] = useState<OssScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [cleaning, setCleaning] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const scan = useCallback(async () => {
    setLoading(true);
    setSelectedKeys(new Set());
    try {
      const res = await fetch("/api/settings/oss");
      if (!res.ok) throw new Error("Failed to scan OSS");
      const result = (await res.json()) as OssScanResult;
      setData(result);
    } catch (err) {
      toast.error("Failed to scan OSS storage");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    scan();
  }, [scan]);

  const toggleFolder = useCallback((keys: string[]) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const allSelected = keys.every((k) => next.has(k));
      if (allSelected) {
        for (const k of keys) next.delete(k);
      } else {
        for (const k of keys) next.add(k);
      }
      return next;
    });
  }, []);

  const selectAllOrphans = useCallback(() => {
    if (!data) return;
    const orphanKeys: string[] = [];
    for (const user of data.users) {
      for (const folder of user.uploads.folders) {
        if (!folder.hasDbRecord) {
          orphanKeys.push(...folder.files.map((f) => f.key));
        }
      }
      for (const folder of user.results.folders) {
        if (!folder.hasDbRecord) {
          orphanKeys.push(...folder.files.map((f) => f.key));
        }
      }
    }
    for (const folder of data.unlinkedResults) {
      orphanKeys.push(...folder.files.map((f) => f.key));
    }
    setSelectedKeys(new Set(orphanKeys));
  }, [data]);

  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  const handleCleanup = async () => {
    setShowConfirm(false);
    setCleaning(true);
    try {
      const keys = Array.from(selectedKeys);
      const res = await fetch("/api/settings/oss/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys }),
      });
      if (!res.ok) throw new Error("Cleanup failed");
      const result = (await res.json()) as {
        deleted: number;
        requested: number;
        confirmed: number;
        skipped: number;
      };
      toast.success(
        `Deleted ${result.deleted} files (${result.skipped} skipped as non-orphan)`,
      );
      // Re-scan after cleanup
      await scan();
    } catch (err) {
      toast.error("Failed to clean up orphan files");
      console.error(err);
    } finally {
      setCleaning(false);
    }
  };

  // Calculate selected size
  const selectedSize = (() => {
    if (!data) return 0;
    let size = 0;
    const allFolders = [
      ...data.users.flatMap((u) => [
        ...u.uploads.folders,
        ...u.results.folders,
      ]),
      ...data.unlinkedResults,
    ];
    for (const folder of allFolders) {
      for (const file of folder.files) {
        if (selectedKeys.has(file.key)) size += file.size;
      }
    }
    return size;
  })();

  if (loading && !data) {
    return (
      <div className="rounded-xl border border-border bg-card p-8">
        <div className="flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Scanning OSS storage...
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const hasOrphans = data.summary.totalOrphanFiles > 0;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label="Total Storage"
          value={formatBytes(data.summary.totalSize)}
          sub={`${data.summary.totalFiles} files`}
        />
        <SummaryCard
          label="Users"
          value={data.users.length.toString()}
          sub="across all buckets"
        />
        <SummaryCard
          label="Orphan Files"
          value={data.summary.totalOrphanFiles.toString()}
          sub={formatBytes(data.summary.totalOrphanSize)}
          variant={hasOrphans ? "warning" : "success"}
        />
        <SummaryCard
          label="Status"
          value={hasOrphans ? "Orphans found" : "All clean"}
          variant={hasOrphans ? "warning" : "success"}
        />
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={scan}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", loading && "animate-spin")}
              strokeWidth={1.5}
            />
            Rescan
          </Button>

          {hasOrphans && (
            <Fragment>
              <Button
                variant="outline"
                size="sm"
                onClick={selectAllOrphans}
                className="gap-1.5"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" strokeWidth={1.5} />
                Select all orphans
              </Button>

              {selectedKeys.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearSelection}
                >
                  Clear selection
                </Button>
              )}
            </Fragment>
          )}
        </div>

        {selectedKeys.size > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {selectedKeys.size} files selected ({formatBytes(selectedSize)})
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowConfirm(true)}
              disabled={cleaning}
              className="gap-1.5"
            >
              {cleaning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              Delete selected
            </Button>
          </div>
        )}
      </div>

      {/* User sections */}
      <div className="space-y-3">
        {data.users.map((user) => (
          <UserSection
            key={user.userId}
            user={user}
            selectedKeys={selectedKeys}
            onToggleFolder={toggleFolder}
          />
        ))}

        {/* Unlinked results */}
        {data.unlinkedResults.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/5">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" strokeWidth={1.5} />
              <div className="flex-1">
                <span className="text-sm font-medium text-foreground">
                  Unlinked Results
                </span>
                <span className="text-xs text-muted-foreground ml-2">
                  Cannot be attributed to any user
                </span>
              </div>
              <Badge variant="warning" className="text-[10px]">
                {data.unlinkedResults.length} orphan{data.unlinkedResults.length > 1 ? "s" : ""}
              </Badge>
            </div>
            <div className="border-t border-amber-500/20">
              {data.unlinkedResults.map((folder) => {
                const folderFileKeys = folder.files.map((f) => f.key);
                const allSelected = folderFileKeys.every((k) =>
                  selectedKeys.has(k),
                );
                return (
                  <FolderRow
                    key={folder.id}
                    folder={folder}
                    selected={allSelected}
                    onToggleSelect={() => toggleFolder(folderFileKeys)}
                  />
                );
              })}
            </div>
          </div>
        )}

        {data.users.length === 0 && data.unlinkedResults.length === 0 && (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">
              OSS storage is empty.
            </p>
          </div>
        )}
      </div>

      {/* Confirmation dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete orphan files?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedKeys.size} files (
              {formatBytes(selectedSize)}) from OSS. Only files confirmed as
              orphans (no matching database record) will be deleted. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCleanup}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete {selectedKeys.size} files
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
