import { Badge, Button, Input, Label, toast } from "@nocoo/basalt";
import { LayerCard } from "@nocoo/basalt/components/layer-card";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	Check,
	CheckCircle2,
	CloudUpload,
	Copy,
	Database,
	Download,
	Eye,
	EyeOff,
	FolderOpen,
	History,
	KeyRound,
	Loader2,
	Pencil,
	Plug,
	Plus,
	RefreshCw,
	RotateCw,
	Save,
	Tag,
	Trash2,
	Upload,
	Webhook,
	X,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSetBreadcrumbs } from "@/components/layout";
import { Skeleton } from "@/components/ui/skeleton";
import { getTagColor } from "@/lib/badge-colors";
import { cn } from "@/lib/utils";

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
				{colorDot && <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", colorDot)} />}
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
			{colorDot && <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", colorDot)} />}
			<span className="text-sm text-basalt-foreground flex-1 truncate">{name}</span>
			<div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
				<Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditing(true)}>
					<Pencil className="h-3.5 w-3.5 text-basalt-muted-foreground" strokeWidth={1.5} />
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 w-7 p-0 text-basalt-destructive hover:text-basalt-destructive"
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
		<div className="flex items-center gap-2 pt-2 border-t border-basalt-border">
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
			const [foldersRes, tagsRes] = await Promise.all([fetch("/api/folders"), fetch("/api/tags")]);
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
		return () => {
			cancelled = true;
		};
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
			setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
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
			setTags((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]));
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
			setTags((prev) => prev.map((t) => (t.id === id ? { ...t, name } : t)));
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
			<LayerCard className="p-5">
				<div className="mb-4 flex items-center gap-3">
					<Skeleton className="h-9 w-9 rounded-lg" />
					<div className="space-y-1.5">
						<Skeleton className="h-4 w-28" />
						<Skeleton className="h-3 w-64" />
					</div>
				</div>
				<div className="grid gap-6 lg:grid-cols-2">
					{Array.from({ length: 2 }, (_, colIdx) => `org-col-${colIdx}`).map((colKey) => (
						<div key={colKey} className="space-y-3">
							<div className="flex items-center gap-2">
								<Skeleton className="h-3.5 w-3.5 rounded-sm" />
								<Skeleton className="h-3 w-16" />
							</div>
							<div className="space-y-2">
								{Array.from({ length: 3 }, (_, i) => `${colKey}-row-${i}`).map((rowKey) => (
									<Skeleton key={rowKey} className="h-6 w-full" />
								))}
							</div>
							<Skeleton className="h-8 w-full rounded-md" />
						</div>
					))}
				</div>
			</LayerCard>
		);
	}

	return (
		<LayerCard className="p-5">
			<div className="mb-4 flex items-center gap-3">
				<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-basalt-secondary">
					<FolderOpen className="h-4 w-4 text-basalt-muted-foreground" strokeWidth={1.5} />
				</div>
				<div>
					<h2 className="text-sm font-medium text-basalt-foreground">Organization</h2>
					<p className="text-xs text-basalt-muted-foreground">
						Manage folders and tags for organizing recordings.
					</p>
				</div>
			</div>

			<div className="grid gap-6 lg:grid-cols-2">
				{/* Folders */}
				<div className="space-y-3">
					<div className="flex items-center gap-2">
						<FolderOpen className="h-3.5 w-3.5 text-basalt-muted-foreground" strokeWidth={1.5} />
						<h3 className="text-xs font-medium text-basalt-muted-foreground uppercase tracking-wider">
							Folders
						</h3>
						<span className="text-xs text-basalt-muted-foreground">({folders.length})</span>
					</div>
					<div className="space-y-1.5">
						{folders.length === 0 && (
							<p className="text-xs text-basalt-muted-foreground py-2">No folders yet.</p>
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
					<InlineCreateForm placeholder="New folder name..." onCreate={createFolder} />
				</div>

				{/* Tags */}
				<div className="space-y-3">
					<div className="flex items-center gap-2">
						<Tag className="h-3.5 w-3.5 text-basalt-muted-foreground" strokeWidth={1.5} />
						<h3 className="text-xs font-medium text-basalt-muted-foreground uppercase tracking-wider">
							Tags
						</h3>
						<span className="text-xs text-basalt-muted-foreground">({tags.length})</span>
					</div>
					<div className="space-y-1.5">
						{tags.length === 0 && (
							<p className="text-xs text-basalt-muted-foreground py-2">No tags yet.</p>
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
					<InlineCreateForm placeholder="New tag name..." onCreate={createTag} />
				</div>
			</div>
		</LayerCard>
	);
}

// ── Data backup section ──

function BackupSection() {
	const [exporting, setExporting] = useState(false);
	const [importing, setImporting] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleExport = async () => {
		setExporting(true);
		try {
			const res = await fetch("/api/settings/backup/export");
			if (!res.ok) {
				toast.error("Failed to export data");
				return;
			}
			const data = await res.json();
			const blob = new Blob([JSON.stringify(data, null, 2)], {
				type: "application/json",
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			const date = new Date().toISOString().slice(0, 10);
			a.download = `lyre-backup-${date}.json`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
			toast.success("Backup exported successfully");
		} catch {
			toast.error("Failed to export data");
		} finally {
			setExporting(false);
		}
	};

	const handleImport = async (file: File) => {
		setImporting(true);
		try {
			const text = await file.text();
			let parsed: unknown;
			try {
				parsed = JSON.parse(text);
			} catch {
				toast.error("Invalid JSON file");
				return;
			}

			const res = await fetch("/api/settings/backup/import", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(parsed),
			});

			if (res.ok) {
				const result = (await res.json()) as { imported: Record<string, number> };
				const total = Object.values(result.imported).reduce((a, b) => a + b, 0);
				toast.success(`Imported ${total} records successfully`);
			} else {
				const err = (await res.json()) as { error: string };
				toast.error(err.error || "Import failed");
			}
		} catch {
			toast.error("Failed to import data");
		} finally {
			setImporting(false);
			// Reset file input so re-selecting same file works
			if (fileInputRef.current) fileInputRef.current.value = "";
		}
	};

	const busy = exporting || importing;

	return (
		<LayerCard className="p-5">
			<div className="mb-4 flex items-center gap-3">
				<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-basalt-secondary">
					<Database className="h-4 w-4 text-basalt-muted-foreground" strokeWidth={1.5} />
				</div>
				<div>
					<h2 className="text-sm font-medium text-basalt-foreground">Data Backup</h2>
					<p className="text-xs text-basalt-muted-foreground">
						Export or import all your data as a JSON file.
					</p>
				</div>
			</div>

			<div className="flex flex-wrap gap-3">
				<Button
					variant="outline"
					size="sm"
					className="gap-2"
					onClick={handleExport}
					disabled={busy}
				>
					{exporting ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
					) : (
						<Download className="h-3.5 w-3.5" strokeWidth={1.5} />
					)}
					Export Backup
				</Button>

				<input
					ref={fileInputRef}
					type="file"
					accept=".json"
					className="hidden"
					onChange={(e) => {
						const file = e.target.files?.[0];
						if (file) handleImport(file);
					}}
				/>
				<Button
					variant="outline"
					size="sm"
					className="gap-2"
					onClick={() => fileInputRef.current?.click()}
					disabled={busy}
				>
					{importing ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
					) : (
						<Upload className="h-3.5 w-3.5" strokeWidth={1.5} />
					)}
					Import Backup
				</Button>
			</div>
		</LayerCard>
	);
}

// ── Remote backup (Backy) section ──

interface BackyPushResponse {
	success: boolean;
	error?: string;
	request?: {
		url: string;
		method: string;
		environment: string;
		tag: string;
		fileName: string;
		fileSizeBytes: number;
		backupStats: {
			recordings: number;
			transcriptions: number;
			folders: number;
			tags: number;
			jobs: number;
			settings: number;
		};
	};
	response?: {
		status: number;
		body: unknown;
	};
	durationMs?: number;
}

interface BackyBackupEntry {
	id: string;
	tag: string;
	environment: string;
	file_size: number;
	is_single_json: number;
	created_at: string;
}

interface BackyHistoryData {
	project_name: string;
	environment: string | null;
	total_backups: number;
	recent_backups: BackyBackupEntry[];
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="flex items-baseline gap-2 text-xs">
			<span className="text-basalt-muted-foreground shrink-0 w-24">{label}</span>
			<span className="text-basalt-foreground font-mono break-all">{value}</span>
		</div>
	);
}

function EnvironmentBadge({ environment, className }: { environment: string; className?: string }) {
	const isProd = environment.toLowerCase() === "prod";
	return (
		<Badge variant={isProd ? "blue" : "success"} className={className}>
			{environment.toUpperCase()}
		</Badge>
	);
}

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimeAgo(dateStr: string): string {
	const now = Date.now();
	const then = new Date(dateStr).getTime();
	const diff = now - then;
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	return new Date(dateStr).toLocaleDateString();
}

function BackySection() {
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [pushing, setPushing] = useState(false);
	const [result, setResult] = useState<BackyPushResponse | null>(null);

	// Config form state
	const [webhookUrl, setWebhookUrl] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [hasApiKey, setHasApiKey] = useState(false);
	const [apiKeyChanged, setApiKeyChanged] = useState(false);
	const [showApiKey, setShowApiKey] = useState(false);
	const [saved, setSaved] = useState(false);
	const [testing, setTesting] = useState(false);
	const [testStatus, setTestStatus] = useState<"idle" | "success" | "error">("idle");
	const [testError, setTestError] = useState("");
	const [environment, setEnvironment] = useState<"prod" | "dev">("dev");

	// History state
	const [history, setHistory] = useState<BackyHistoryData | null>(null);
	const [historyLoading, setHistoryLoading] = useState(false);
	const [historyError, setHistoryError] = useState<string | null>(null);

	const loadHistory = useCallback(async () => {
		setHistoryLoading(true);
		setHistoryError(null);
		try {
			const res = await fetch("/api/settings/backy/history");
			if (res.ok) {
				const data = (await res.json()) as BackyHistoryData;
				setHistory(data);
			} else if (res.status === 400) {
				// Not configured — not an error, just no data
				setHistory(null);
			} else {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				setHistoryError(body.error ?? `HTTP ${res.status}`);
			}
		} catch {
			setHistoryError("Failed to fetch history");
		} finally {
			setHistoryLoading(false);
		}
	}, []);

	const loadSettings = useCallback(async () => {
		try {
			const res = await fetch("/api/settings/backy");
			if (res.ok) {
				const data = (await res.json()) as {
					webhookUrl: string;
					apiKey: string;
					hasApiKey: boolean;
					environment: "prod" | "dev";
				};
				setWebhookUrl(data.webhookUrl);
				setApiKey(data.apiKey);
				setHasApiKey(data.hasApiKey);
				setApiKeyChanged(false);
				setEnvironment(data.environment);
				return data.hasApiKey && !!data.webhookUrl;
			}
		} finally {
			setLoading(false);
		}
		return false;
	}, []);

	useEffect(() => {
		loadSettings().then((configured) => {
			if (configured) loadHistory();
		});
	}, [loadSettings, loadHistory]);

	const handleSave = async () => {
		setSaving(true);
		setSaved(false);
		try {
			const body: Record<string, string> = { webhookUrl };
			if (apiKeyChanged) body.apiKey = apiKey;
			const res = await fetch("/api/settings/backy", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			if (res.ok) {
				const data = (await res.json()) as {
					webhookUrl: string;
					apiKey: string;
					hasApiKey: boolean;
				};
				setWebhookUrl(data.webhookUrl);
				setApiKey(data.apiKey);
				setHasApiKey(data.hasApiKey);
				setApiKeyChanged(false);
				setSaved(true);
				setTimeout(() => setSaved(false), 2000);
			} else {
				toast.error("Failed to save Backy settings");
			}
		} catch {
			toast.error("Failed to save Backy settings");
		} finally {
			setSaving(false);
		}
	};

	const handleTest = async () => {
		if (apiKeyChanged) await handleSave();
		setTesting(true);
		setTestStatus("idle");
		setTestError("");
		try {
			const res = await fetch("/api/settings/backy/test", { method: "POST" });
			const data = (await res.json()) as { success: boolean; error?: string };
			if (data.success) {
				setTestStatus("success");
			} else {
				setTestStatus("error");
				setTestError(data.error || "Connection failed");
			}
		} catch {
			setTestStatus("error");
			setTestError("Network error");
		} finally {
			setTesting(false);
		}
		setTimeout(() => setTestStatus("idle"), 4000);
	};

	const handlePush = async () => {
		setPushing(true);
		setResult(null);
		try {
			const res = await fetch("/api/settings/backup/push", { method: "POST" });
			const data = (await res.json()) as BackyPushResponse;
			setResult(data);
			if (data.success) {
				toast.success("Backup pushed to Backy");
				// Refresh history after successful push
				loadHistory();
			} else {
				toast.error(data.error || "Push failed");
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : "Network error";
			setResult({ success: false, error: message });
			toast.error("Failed to push backup");
		} finally {
			setPushing(false);
		}
	};

	const configured = hasApiKey && !!webhookUrl;

	if (loading) {
		return (
			<LayerCard className="p-5">
				<div className="mb-4 flex items-center gap-3">
					<Skeleton className="h-9 w-9 rounded-lg" />
					<div className="space-y-1.5">
						<Skeleton className="h-4 w-32" />
						<Skeleton className="h-3 w-56" />
					</div>
				</div>
				<div className="space-y-3 mb-4">
					{Array.from({ length: 2 }, (_, i) => `backy-field-${i}`).map((key) => (
						<div key={key} className="space-y-1.5">
							<Skeleton className="h-3 w-24" />
							<Skeleton className="h-9 w-full rounded-md" />
						</div>
					))}
				</div>
				<div className="flex gap-2">
					<Skeleton className="h-8 w-20 rounded-md" />
					<Skeleton className="h-8 w-24 rounded-md" />
					<Skeleton className="h-8 w-24 rounded-md" />
				</div>
			</LayerCard>
		);
	}

	return (
		<LayerCard className="p-5">
			<div className="mb-4 flex items-center gap-3">
				<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-basalt-secondary">
					<CloudUpload className="h-4 w-4 text-basalt-muted-foreground" strokeWidth={1.5} />
				</div>
				<div className="flex-1">
					<div className="flex items-center gap-2">
						<h2 className="text-sm font-medium text-basalt-foreground">Remote Backup</h2>
						<EnvironmentBadge environment={environment} className="px-1.5 py-0 text-[10px]" />
					</div>
					<p className="text-xs text-basalt-muted-foreground">
						Push a full backup to Backy for off-site storage.
					</p>
				</div>
			</div>

			{/* Config + actions */}
			<div className="space-y-3 mb-4">
				<div>
					<Label className="text-sm" htmlFor="backy-url">
						Webhook URL
					</Label>
					<Input
						id="backy-url"
						value={webhookUrl}
						onChange={(e) => setWebhookUrl(e.target.value)}
						placeholder="https://backy.example.com/api/webhook/..."
						className="mt-1"
					/>
				</div>
				<div>
					<Label className="text-sm" htmlFor="backy-key">
						API Key
					</Label>
					<div className="relative mt-1">
						<Input
							id="backy-key"
							type={showApiKey ? "text" : "password"}
							value={apiKey}
							onChange={(e) => {
								setApiKey(e.target.value);
								setApiKeyChanged(true);
							}}
							placeholder={hasApiKey ? "••••••••••••" : "Enter your API key"}
							className="pr-9"
						/>
						<button
							type="button"
							onClick={() => setShowApiKey(!showApiKey)}
							className="absolute right-2 top-1/2 -translate-y-1/2 text-basalt-muted-foreground hover:text-basalt-foreground"
						>
							{showApiKey ? (
								<EyeOff className="h-3.5 w-3.5" strokeWidth={1.5} />
							) : (
								<Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
							)}
						</button>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						className="gap-2"
						onClick={handleSave}
						disabled={saving}
					>
						{saving ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : saved ? (
							<Check className="h-3.5 w-3.5" strokeWidth={1.5} />
						) : (
							<Save className="h-3.5 w-3.5" strokeWidth={1.5} />
						)}
						{saved ? "Saved" : "Save"}
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="gap-2"
						onClick={handleTest}
						disabled={testing || !configured}
					>
						{testing ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Plug className="h-3.5 w-3.5" strokeWidth={1.5} />
						)}
						Test Connection
					</Button>
					{testStatus === "success" && (
						<Badge variant="success" className="text-xs">
							<Check className="mr-1 h-3 w-3" />
							Connected
						</Badge>
					)}
					{testStatus === "error" && (
						<Badge variant="destructive" className="text-xs">
							<X className="mr-1 h-3 w-3" />
							{testError}
						</Badge>
					)}
					<Button
						variant="outline"
						size="sm"
						className="gap-2"
						onClick={handlePush}
						disabled={pushing || !configured}
					>
						{pushing ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<CloudUpload className="h-3.5 w-3.5" strokeWidth={1.5} />
						)}
						Push to Backy
					</Button>
				</div>
			</div>

			{/* Push result details */}
			{result && (
				<div className="space-y-3 border-t border-basalt-border pt-4">
					{/* Status banner */}
					<div
						className={cn(
							"flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
							result.success
								? "bg-green-500/10 text-green-700 dark:text-green-400"
								: "bg-basalt-destructive/10 text-basalt-destructive",
						)}
					>
						{result.success ? (
							<CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={1.5} />
						) : (
							<XCircle className="h-4 w-4 shrink-0" strokeWidth={1.5} />
						)}
						<span className="font-medium">
							{result.success ? "Backup pushed successfully" : result.error || "Push failed"}
						</span>
						{result.durationMs != null && (
							<span className="ml-auto text-xs opacity-70">{result.durationMs}ms</span>
						)}
					</div>

					{/* Request details */}
					{result.request && (
						<div className="space-y-1.5">
							<h3 className="text-xs font-medium text-basalt-muted-foreground uppercase tracking-wider">
								Request
							</h3>
							<LayerCard.Well className="space-y-1">
								<DetailRow label="URL" value={result.request.url} />
								<DetailRow label="Method" value={result.request.method} />
								<DetailRow label="Environment" value={result.request.environment} />
								<DetailRow label="Tag" value={result.request.tag} />
								<DetailRow label="File" value={result.request.fileName} />
								<DetailRow
									label="Size"
									value={`${(result.request.fileSizeBytes / 1024).toFixed(1)} KB`}
								/>
							</LayerCard.Well>
							<LayerCard.Well className="space-y-1">
								<h4 className="text-xs font-medium text-basalt-muted-foreground mb-1">
									Backup Contents
								</h4>
								<div className="grid grid-cols-3 gap-x-4 gap-y-1">
									{Object.entries(result.request.backupStats).map(([key, count]) => (
										<DetailRow key={key} label={key} value={String(count)} />
									))}
								</div>
							</LayerCard.Well>
						</div>
					)}

					{/* Response details */}
					{result.response && (
						<div className="space-y-1.5">
							<h3 className="text-xs font-medium text-basalt-muted-foreground uppercase tracking-wider">
								Response
							</h3>
							<LayerCard.Well className="space-y-1">
								<DetailRow label="Status" value={result.response.status} />
								<div className="text-xs">
									<span className="text-basalt-muted-foreground">Body</span>
									<pre className="mt-1 max-h-40 overflow-x-auto overflow-y-auto rounded p-2 font-mono text-xs text-basalt-foreground">
										{typeof result.response.body === "string"
											? result.response.body
											: JSON.stringify(result.response.body, null, 2)}
									</pre>
								</div>
							</LayerCard.Well>
						</div>
					)}
				</div>
			)}

			{/* Remote backup history */}
			{configured && (
				<div className="border-t border-basalt-border pt-4">
					<div className="flex items-center justify-between mb-3">
						<div className="flex items-center gap-1.5">
							<History className="h-3.5 w-3.5 text-basalt-muted-foreground" strokeWidth={1.5} />
							<h3 className="text-xs font-medium text-basalt-muted-foreground uppercase tracking-wider">
								Remote History
							</h3>
							{history && (
								<Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
									{history.total_backups} {history.total_backups === 1 ? "backup" : "backups"}
								</Badge>
							)}
						</div>
						<button
							type="button"
							onClick={loadHistory}
							disabled={historyLoading}
							className="text-basalt-muted-foreground hover:text-basalt-foreground disabled:opacity-40 disabled:cursor-not-allowed"
							title="Refresh"
						>
							<RefreshCw
								className={cn("h-3.5 w-3.5", historyLoading && "animate-spin")}
								strokeWidth={1.5}
							/>
						</button>
					</div>

					{historyLoading && !history && (
						<div className="flex justify-center py-4">
							<Loader2 className="h-4 w-4 animate-spin text-basalt-muted-foreground" />
						</div>
					)}

					{historyError && (
						<div className="rounded-lg bg-basalt-destructive/10 px-3 py-2 text-xs text-basalt-destructive mb-2">
							{historyError}
						</div>
					)}

					{history && history.recent_backups.length > 0 && (
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
							{history.recent_backups.map((entry) => (
								<LayerCard.Well key={entry.id} className="px-3 py-2">
									<div className="flex items-center gap-1.5 mb-1">
										<EnvironmentBadge
											environment={entry.environment}
											className="px-1 py-0 text-[10px]"
										/>
										<span className="text-[10px] text-basalt-muted-foreground ml-auto">
											{formatTimeAgo(entry.created_at)}
										</span>
									</div>
									<p
										className="text-xs text-basalt-foreground font-mono truncate"
										title={entry.tag}
									>
										{entry.tag}
									</p>
									<p className="text-[10px] text-basalt-muted-foreground mt-0.5">
										{formatFileSize(entry.file_size)}
									</p>
								</LayerCard.Well>
							))}
						</div>
					)}

					{history && history.recent_backups.length === 0 && (
						<p className="text-xs text-basalt-muted-foreground py-2 text-center">No backups yet</p>
					)}
				</div>
			)}

			{!configured && (
				<div className="border-t border-basalt-border pt-4">
					<p className="text-xs text-basalt-muted-foreground py-2 text-center">
						Configure webhook to view remote backup history
					</p>
				</div>
			)}
		</LayerCard>
	);
}

// ── Pull Webhook section ──

function PullWebhookSection() {
	const [loading, setLoading] = useState(true);
	const [hasPullKey, setHasPullKey] = useState(false);
	const [pullKey, setPullKey] = useState<string | null>(null);
	const [generating, setGenerating] = useState(false);
	const [revoking, setRevoking] = useState(false);
	const [copied, setCopied] = useState<"url" | "key" | null>(null);
	const [hasPushConfig, setHasPushConfig] = useState(false);

	const webhookUrl =
		typeof window !== "undefined" ? `${window.location.origin}/api/backy/pull` : "/api/backy/pull";

	useEffect(() => {
		(async () => {
			try {
				const res = await fetch("/api/settings/backy");
				if (res.ok) {
					const data = (await res.json()) as {
						webhookUrl: string;
						hasApiKey: boolean;
						hasPullKey: boolean;
						pullKey: string | null;
					};
					setHasPullKey(data.hasPullKey);
					setPullKey(data.pullKey);
					setHasPushConfig(!!data.webhookUrl && data.hasApiKey);
				}
			} finally {
				setLoading(false);
			}
		})();
	}, []);

	const handleGenerate = async () => {
		setGenerating(true);
		try {
			const res = await fetch("/api/settings/backy/pull-key", { method: "POST" });
			if (res.ok) {
				const data = (await res.json()) as { pullKey: string };
				setPullKey(data.pullKey);
				setHasPullKey(true);
				toast.success(hasPullKey ? "Pull key regenerated" : "Pull key generated");
			} else {
				toast.error("Failed to generate pull key");
			}
		} catch {
			toast.error("Failed to generate pull key");
		} finally {
			setGenerating(false);
		}
	};

	const handleRevoke = async () => {
		setRevoking(true);
		try {
			const res = await fetch("/api/settings/backy/pull-key", { method: "DELETE" });
			if (res.ok) {
				setPullKey(null);
				setHasPullKey(false);
				toast.success("Pull key revoked");
			} else {
				toast.error("Failed to revoke pull key");
			}
		} catch {
			toast.error("Failed to revoke pull key");
		} finally {
			setRevoking(false);
		}
	};

	const copyToClipboard = async (text: string, which: "url" | "key") => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(which);
			setTimeout(() => setCopied(null), 2000);
		} catch {
			toast.error("Failed to copy");
		}
	};

	if (loading) {
		return (
			<LayerCard className="p-5">
				<div className="mb-4 flex items-center gap-3">
					<Skeleton className="h-9 w-9 rounded-lg" />
					<div className="space-y-1.5">
						<Skeleton className="h-4 w-28" />
						<Skeleton className="h-3 w-64" />
					</div>
				</div>
				<div className="space-y-3">
					{Array.from({ length: 2 }, (_, i) => `pw-field-${i}`).map((key) => (
						<div key={key} className="space-y-1.5">
							<Skeleton className="h-3 w-24" />
							<Skeleton className="h-9 w-full rounded-md" />
						</div>
					))}
					<div className="flex gap-2 pt-2">
						<Skeleton className="h-8 w-24 rounded-md" />
						<Skeleton className="h-8 w-24 rounded-md" />
					</div>
				</div>
			</LayerCard>
		);
	}

	return (
		<LayerCard className="p-5">
			<div className="mb-4 flex items-center gap-3">
				<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-basalt-secondary">
					<Webhook className="h-4 w-4 text-basalt-muted-foreground" strokeWidth={1.5} />
				</div>
				<div className="flex-1">
					<h2 className="text-sm font-medium text-basalt-foreground">Pull Webhook</h2>
					<p className="text-xs text-basalt-muted-foreground">
						Allow Backy to trigger automatic backups via webhook.
					</p>
				</div>
			</div>

			{!hasPushConfig && (
				<div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 mb-3">
					Pull requires Push configuration. Set up the Remote Backup section above first.
				</div>
			)}

			{!hasPullKey ? (
				<div className="space-y-3">
					<p className="text-xs text-basalt-muted-foreground">
						Generate a webhook key to allow Backy to call this endpoint and trigger automatic
						backups.
					</p>
					<Button
						variant="outline"
						size="sm"
						className="gap-2"
						onClick={handleGenerate}
						disabled={generating}
					>
						{generating ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<KeyRound className="h-3.5 w-3.5" strokeWidth={1.5} />
						)}
						Generate Key
					</Button>
				</div>
			) : (
				<div className="space-y-3">
					{/* Webhook URL */}
					<div>
						<Label className="text-xs text-basalt-muted-foreground">Webhook URL</Label>
						<div className="flex items-center gap-2 mt-1">
							<code className="flex-1 rounded-md bg-basalt-secondary px-3 py-1.5 text-xs font-mono text-basalt-foreground truncate">
								{webhookUrl}
							</code>
							<button
								type="button"
								onClick={() => copyToClipboard(webhookUrl, "url")}
								className="text-basalt-muted-foreground hover:text-basalt-foreground shrink-0"
								title="Copy URL"
							>
								{copied === "url" ? (
									<Check className="h-3.5 w-3.5 text-green-500" strokeWidth={1.5} />
								) : (
									<Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
								)}
							</button>
						</div>
					</div>

					{/* Webhook Key */}
					<div>
						<Label className="text-xs text-basalt-muted-foreground">Webhook Key</Label>
						<div className="flex items-center gap-2 mt-1">
							<code className="flex-1 rounded-md bg-basalt-secondary px-3 py-1.5 text-xs font-mono text-basalt-foreground truncate">
								{pullKey}
							</code>
							<button
								type="button"
								onClick={() => pullKey && copyToClipboard(pullKey, "key")}
								className="text-basalt-muted-foreground hover:text-basalt-foreground shrink-0"
								title="Copy key"
							>
								{copied === "key" ? (
									<Check className="h-3.5 w-3.5 text-green-500" strokeWidth={1.5} />
								) : (
									<Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
								)}
							</button>
						</div>
					</div>

					{/* Usage hint */}
					<LayerCard.Well className="space-y-1 text-xs text-basalt-muted-foreground">
						<p className="font-medium text-basalt-foreground">Usage</p>
						<p>
							Configure Backy to call this URL with the key in the{" "}
							<code className="bg-basalt-background px-1 rounded">X-Webhook-Key</code> header:
						</p>
						<pre className="overflow-x-auto rounded p-2 font-mono text-[11px]">
							{`curl -X POST ${webhookUrl} \\
  -H "X-Webhook-Key: <your-key>"`}
						</pre>
					</LayerCard.Well>

					{/* Actions */}
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							className="gap-2"
							onClick={handleGenerate}
							disabled={generating}
						>
							{generating ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<RotateCw className="h-3.5 w-3.5" strokeWidth={1.5} />
							)}
							Regenerate
						</Button>
						<Button
							variant="outline"
							size="sm"
							className="gap-2 text-basalt-destructive hover:text-basalt-destructive"
							onClick={handleRevoke}
							disabled={revoking}
						>
							{revoking ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
							)}
							Revoke
						</Button>
					</div>
				</div>
			)}
		</LayerCard>
	);
}

// ── Main page ──

export default function SettingsGeneralPage() {
	useSetBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "General" }]);

	return (
		<div className="space-y-6">
			<PageHeader title="General" description="Manage folders, tags, and data backups." />
			<OrganizationSection />
			<BackupSection />
			<BackySection />
			<PullWebhookSection />
		</div>
	);
}
