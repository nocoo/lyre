"use client";

import { useState, useEffect } from "react";
import {
  Database,
  Globe,
  Bell,
  FolderOpen,
  Tag,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useSetBreadcrumbs, ThemeToggle } from "@/components/layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getTagColor } from "@/lib/badge-colors";

// ── Types ──

interface FolderItem {
  id: string;
  name: string;
  icon: string | null;
}

interface TagItem {
  id: string;
  name: string;
}

// ── Shared layout components ──

interface SettingSectionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}

function SettingSection({
  icon,
  title,
  description,
  children,
}: SettingSectionProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
          {icon}
        </div>
        <div>
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label className="text-sm">{label}</Label>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ── Editable list item ──

function EditableItem({
  name,
  onRename,
  onDelete,
  colorDot,
}: {
  name: string;
  onRename: (newName: string) => Promise<void>;
  onDelete: () => Promise<void>;
  colorDot?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      setEditName(name);
      return;
    }
    setSaving(true);
    await onRename(trimmed);
    setSaving(false);
    setEditing(false);
  };

  const handleCancel = () => {
    setEditing(false);
    setEditName(name);
  };

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete();
    // component may unmount after delete
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        {colorDot && (
          <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", colorDot)} />
        )}
        <Input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") handleCancel();
          }}
          className="h-7 text-sm flex-1"
          autoFocus
          disabled={saving}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleCancel}
          disabled={saving}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-2">
      {colorDot && (
        <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", colorDot)} />
      )}
      <span className="text-sm text-foreground flex-1 truncate">{name}</span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onClick={handleDelete}
          disabled={deleting}
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
        </Button>
      </div>
    </div>
  );
}

// ── Inline create form ──

function InlineCreateForm({
  placeholder,
  onCreate,
}: {
  placeholder: string;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    await onCreate(trimmed);
    setName("");
    setCreating(false);
  };

  return (
    <div className="flex items-center gap-2 pt-2 border-t border-border">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleCreate();
        }}
        placeholder={placeholder}
        className="h-7 text-sm flex-1"
        disabled={creating}
      />
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={handleCreate}
        disabled={creating || !name.trim()}
      >
        {creating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
        )}
        Add
      </Button>
    </div>
  );
}

// ── Folders & Tags management section ──

function OrganizationSection() {
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [foldersRes, tagsRes] = await Promise.all([
        fetch("/api/folders"),
        fetch("/api/tags"),
      ]);
      if (cancelled) return;
      if (foldersRes.ok) {
        const data = (await foldersRes.json()) as { items: FolderItem[] };
        setFolders(data.items);
      }
      if (tagsRes.ok) {
        const data = (await tagsRes.json()) as { items: TagItem[] };
        setTags(data.items);
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── Folder operations ──

  const createFolder = async (name: string) => {
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const folder = (await res.json()) as FolderItem;
      setFolders((prev) => [...prev, folder]);
      toast.success(`Created folder "${name}"`);
    } else {
      toast.error("Failed to create folder");
    }
  };

  const renameFolder = async (id: string, name: string) => {
    const res = await fetch(`/api/folders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      setFolders((prev) =>
        prev.map((f) => (f.id === id ? { ...f, name } : f)),
      );
      toast.success(`Renamed to "${name}"`);
    } else {
      toast.error("Failed to rename folder");
    }
  };

  const deleteFolder = async (id: string) => {
    const res = await fetch(`/api/folders/${id}`, { method: "DELETE" });
    if (res.ok) {
      setFolders((prev) => prev.filter((f) => f.id !== id));
      toast.success("Folder deleted");
    } else {
      toast.error("Failed to delete folder");
    }
  };

  // ── Tag operations ──

  const createTag = async (name: string) => {
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok || res.status === 409) {
      const data = (await res.json()) as TagItem | { error: string; tag: TagItem };
      const tag = "tag" in data ? data.tag : data;
      setTags((prev) =>
        prev.some((t) => t.id === tag.id) ? prev : [...prev, tag],
      );
      if (res.status === 409) {
        toast.info(`Tag "${name}" already exists`);
      } else {
        toast.success(`Created tag "${name}"`);
      }
    } else {
      toast.error("Failed to create tag");
    }
  };

  const renameTag = async (id: string, name: string) => {
    const res = await fetch(`/api/tags/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      setTags((prev) =>
        prev.map((t) => (t.id === id ? { ...t, name } : t)),
      );
      toast.success(`Renamed to "${name}"`);
    } else if (res.status === 409) {
      toast.error("A tag with that name already exists");
    } else {
      toast.error("Failed to rename tag");
    }
  };

  const deleteTag = async (id: string) => {
    const res = await fetch(`/api/tags/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTags((prev) => prev.filter((t) => t.id !== id));
      toast.success("Tag deleted");
    } else {
      toast.error("Failed to delete tag");
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
          <FolderOpen className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
        </div>
        <div>
          <h2 className="text-sm font-medium text-foreground">Organization</h2>
          <p className="text-xs text-muted-foreground">
            Manage folders and tags for organizing recordings.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Folders */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Folders
            </h3>
            <span className="text-xs text-muted-foreground">({folders.length})</span>
          </div>
          <div className="space-y-1.5">
            {folders.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">No folders yet.</p>
            )}
            {folders.map((folder) => (
              <EditableItem
                key={folder.id}
                name={folder.name}
                onRename={(name) => renameFolder(folder.id, name)}
                onDelete={() => deleteFolder(folder.id)}
              />
            ))}
          </div>
          <InlineCreateForm
            placeholder="New folder name..."
            onCreate={createFolder}
          />
        </div>

        {/* Tags */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Tag className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Tags
            </h3>
            <span className="text-xs text-muted-foreground">({tags.length})</span>
          </div>
          <div className="space-y-1.5">
            {tags.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">No tags yet.</p>
            )}
            {tags.map((tag) => {
              const color = getTagColor(tag.name);
              return (
                <EditableItem
                  key={tag.id}
                  name={tag.name}
                  onRename={(name) => renameTag(tag.id, name)}
                  onDelete={() => deleteTag(tag.id)}
                  colorDot={color.bg}
                />
              );
            })}
          </div>
          <InlineCreateForm
            placeholder="New tag name..."
            onCreate={createTag}
          />
        </div>
      </div>
    </div>
  );
}

// ── Main page ──

export default function SettingsGeneralPage() {
  useSetBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "General" }]);

  const [defaultLanguage, setDefaultLanguage] = useState("auto");
  const [notifyOnComplete, setNotifyOnComplete] = useState(true);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">General</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Appearance, transcription defaults, and storage configuration.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Appearance */}
        <SettingSection
          icon={
            <Globe
              className="h-4 w-4 text-muted-foreground"
              strokeWidth={1.5}
            />
          }
          title="Appearance"
          description="Customize the look and feel."
        >
          <SettingRow
            label="Theme"
            description="Switch between light and dark mode."
          >
            <ThemeToggle />
          </SettingRow>
        </SettingSection>

        {/* Transcription */}
        <SettingSection
          icon={
            <Database
              className="h-4 w-4 text-muted-foreground"
              strokeWidth={1.5}
            />
          }
          title="Transcription"
          description="Default transcription settings."
        >
          <SettingRow
            label="Default language"
            description="Language hint for the ASR engine."
          >
            <select
              value={defaultLanguage}
              onChange={(e) => setDefaultLanguage(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="auto">Auto-detect</option>
              <option value="zh">Chinese</option>
              <option value="en">English</option>
              <option value="ja">Japanese</option>
            </select>
          </SettingRow>
        </SettingSection>

        {/* Notifications */}
        <SettingSection
          icon={
            <Bell
              className="h-4 w-4 text-muted-foreground"
              strokeWidth={1.5}
            />
          }
          title="Notifications"
          description="Control when you get notified."
        >
          <SettingRow
            label="Transcription complete"
            description="Show a notification when transcription finishes."
          >
            <button
              type="button"
              role="switch"
              aria-checked={notifyOnComplete}
              onClick={() => setNotifyOnComplete((v) => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${notifyOnComplete ? "bg-foreground" : "bg-secondary"}`}
            >
              <span
                className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-sm transition-transform ${notifyOnComplete ? "translate-x-5" : "translate-x-0"}`}
              />
            </button>
          </SettingRow>
        </SettingSection>

        {/* Storage */}
        <SettingSection
          icon={
            <Database
              className="h-4 w-4 text-muted-foreground"
              strokeWidth={1.5}
            />
          }
          title="Storage"
          description="Aliyun OSS configuration."
        >
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Bucket name</Label>
              <Input
                value="lyre-audio"
                readOnly
                className="mt-1"
                disabled
              />
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="success" className="text-xs">
                Connected
              </Badge>
              <span className="text-xs text-muted-foreground">
                Server-side configuration
              </span>
            </div>
          </div>
        </SettingSection>

        {/* Folders & Tags (full-width) */}
        <OrganizationSection />
      </div>
    </div>
  );
}
