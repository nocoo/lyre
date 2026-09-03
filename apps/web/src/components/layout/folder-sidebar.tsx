import type { Folder } from "@lyre/api/contracts/recordings";
import { isRecordingsPath } from "@lyre/api/lib/sidebar-nav";
import {
	Archive,
	Bookmark,
	BookOpen,
	Briefcase,
	FileAudio,
	FolderClosed,
	FolderOpen,
	FolderPlus,
	Headphones,
	Heart,
	Inbox,
	type LucideIcon,
	Mic,
	MoreHorizontal,
	Music,
	Pencil,
	Radio,
	Star,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Input,
	Label,
	SidebarIconItem,
	SidebarItem,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nocoo/basalt";
import { useLocationPathname } from "@/lib/router-compat";
import { cn } from "@/lib/utils";

// ── Icon registry ──

const FOLDER_ICONS: Record<string, LucideIcon> = {
	folder: FolderClosed,
	"folder-open": FolderOpen,
	music: Music,
	"book-open": BookOpen,
	briefcase: Briefcase,
	heart: Heart,
	star: Star,
	bookmark: Bookmark,
	archive: Archive,
	"file-audio": FileAudio,
	headphones: Headphones,
	radio: Radio,
};

const ICON_OPTIONS = Object.entries(FOLDER_ICONS).map(([name, Icon]) => ({
	name,
	Icon,
}));

/** Render a folder icon by name. Returns JSX, not a component reference. */
function renderFolderIcon(iconName: string, className = "h-4 w-4 shrink-0") {
	const Icon = FOLDER_ICONS[iconName] ?? FolderClosed;
	return <Icon className={className} strokeWidth={1.5} />;
}

// ── Icon Picker ──

function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
	return (
		<div className="grid grid-cols-6 gap-1.5">
			{ICON_OPTIONS.map(({ name, Icon }) => (
				<button
					key={name}
					type="button"
					onClick={() => onChange(name)}
					className={cn(
						"flex h-9 w-9 items-center justify-center rounded-md transition-colors",
						value === name
							? "bg-basalt-accent text-basalt-foreground ring-2 ring-basalt-ring"
							: "text-basalt-muted-foreground hover:bg-basalt-accent hover:text-basalt-foreground",
					)}
				>
					<Icon className="h-4 w-4" strokeWidth={1.5} />
				</button>
			))}
		</div>
	);
}

// ── Folder Item ──

function FolderItem({
	folder,
	isActive,
	onSelect,
	onRename,
	onDelete,
}: {
	folder: Folder;
	isActive: boolean;
	onSelect: () => void;
	onRename: (folder: Folder) => void;
	onDelete: (folder: Folder) => void;
}) {
	return (
		<div className="group relative">
			<SidebarItem active={isActive} onClick={onSelect}>
				{renderFolderIcon(isActive ? "folder-open" : folder.icon)}
				<span className="flex-1 truncate text-left">{folder.name}</span>
			</SidebarItem>
			<div className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							className="flex h-6 w-6 items-center justify-center rounded-md text-basalt-muted-foreground transition-colors hover:bg-basalt-accent hover:text-basalt-foreground"
							onClick={(e) => e.stopPropagation()}
						>
							<MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent side="right" align="start" sideOffset={4}>
						<DropdownMenuItem onClick={() => onRename(folder)}>
							<Pencil className="h-4 w-4" />
							Rename
						</DropdownMenuItem>
						<DropdownMenuItem
							className="text-basalt-destructive"
							onClick={() => onDelete(folder)}
						>
							<Trash2 className="h-4 w-4" />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}

// ── Create / Rename Dialog ──

function FolderDialog({
	open,
	onOpenChange,
	folder,
	onSave,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	folder: Folder | null; // null = create mode
	onSave: (name: string, icon: string) => Promise<void>;
}) {
	const [name, setName] = useState("");
	const [icon, setIcon] = useState("folder");
	const [saving, setSaving] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const isEdit = folder !== null;

	useEffect(() => {
		if (open) {
			setName(folder?.name ?? "");
			setIcon(folder?.icon ?? "folder");
			setSaving(false);
			// Focus input after dialog animation
			setTimeout(() => inputRef.current?.focus(), 100);
		}
	}, [open, folder]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) return;
		setSaving(true);
		try {
			await onSave(trimmed, icon);
			onOpenChange(false);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="sm">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>{isEdit ? "Rename Folder" : "New Folder"}</DialogTitle>
						<DialogDescription>
							{isEdit
								? "Update the folder name and icon."
								: "Give your folder a name and pick an icon."}
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="folder-name">Name</Label>
							<Input
								ref={inputRef}
								id="folder-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g. Interviews"
								maxLength={50}
							/>
						</div>
						<div className="grid gap-2">
							<Label>Icon</Label>
							<IconPicker value={icon} onChange={setIcon} />
						</div>
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={!name.trim() || saving}>
							{saving ? "Saving..." : isEdit ? "Save" : "Create"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

// ── Delete Confirmation ──

function DeleteFolderDialog({
	open,
	onOpenChange,
	folder,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	folder: Folder | null;
	onConfirm: () => Promise<void>;
}) {
	const [deleting, setDeleting] = useState(false);

	const handleDelete = async () => {
		setDeleting(true);
		try {
			await onConfirm();
			onOpenChange(false);
		} finally {
			setDeleting(false);
		}
	};

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent size="sm">
				<AlertDialogHeader>
					<AlertDialogTitle>Delete folder?</AlertDialogTitle>
					<AlertDialogDescription>
						&ldquo;{folder?.name}&rdquo; will be deleted. Recordings inside will become unfiled.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={handleDelete} disabled={deleting}>
						{deleting ? "Deleting..." : "Delete"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

// ── Main: Expanded folder sidebar ──

export function FolderSidebar() {
	const navigate = useNavigate();
	const pathname = useLocationPathname();
	const [searchParams] = useSearchParams();
	const folderParam = searchParams.get("folder");
	const isRecordingsPage = isRecordingsPath(pathname);

	const [folders, setFolders] = useState<Folder[]>([]);

	// Dialog state
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null);

	// ── Fetch folders ──

	const fetchFolders = useCallback(async () => {
		try {
			const res = await fetch("/api/folders");
			if (res.ok) {
				const data = (await res.json()) as { items: Folder[] };
				setFolders(data.items);
			}
		} catch {
			// silently ignore — folders are optional UI
		}
	}, []);

	useEffect(() => {
		// Fetch on mount — async fetch in effect is fine since setState happens
		// in the async callback, not synchronously in the effect body.
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch("/api/folders");
				if (res.ok && !cancelled) {
					const data = (await res.json()) as { items: Folder[] };
					setFolders(data.items);
				}
			} catch {
				// silently ignore
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	// ── Navigation ──

	const handleFolderSelect = (folderId: string | null) => {
		const params = new URLSearchParams(searchParams.toString());
		if (folderId === null) {
			params.delete("folder");
		} else {
			params.set("folder", folderId);
		}
		const query = params.toString();
		navigate(`/recordings${query ? `?${query}` : ""}`);
	};

	// ── CRUD handlers ──

	const handleCreate = () => {
		setEditingFolder(null);
		setDialogOpen(true);
	};

	const handleRename = (folder: Folder) => {
		setEditingFolder(folder);
		setDialogOpen(true);
	};

	const handleDeleteRequest = (folder: Folder) => {
		setDeletingFolder(folder);
		setDeleteDialogOpen(true);
	};

	const handleSave = async (name: string, icon: string) => {
		if (editingFolder) {
			// Update
			await fetch(`/api/folders/${editingFolder.id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name, icon }),
			});
		} else {
			// Create
			await fetch("/api/folders", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name, icon }),
			});
		}
		await fetchFolders();
	};

	const handleDeleteConfirm = async () => {
		if (!deletingFolder) return;
		await fetch(`/api/folders/${deletingFolder.id}`, { method: "DELETE" });
		// If the deleted folder was active, reset to all
		if (folderParam === deletingFolder.id) {
			handleFolderSelect(null);
		}
		await fetchFolders();
	};

	return (
		<>
			<SidebarItem
				active={isRecordingsPage && folderParam === null}
				onClick={() => handleFolderSelect(null)}
			>
				<Mic className="h-4 w-4 shrink-0" strokeWidth={1.5} />
				<span className="truncate">All Recordings</span>
			</SidebarItem>

			<SidebarItem active={folderParam === "unfiled"} onClick={() => handleFolderSelect("unfiled")}>
				<Inbox className="h-4 w-4 shrink-0" strokeWidth={1.5} />
				<span className="truncate">Unfiled</span>
			</SidebarItem>

			{/* Dynamic folders */}
			{folders.map((folder) => (
				<FolderItem
					key={folder.id}
					folder={folder}
					isActive={folderParam === folder.id}
					onSelect={() => handleFolderSelect(folder.id)}
					onRename={handleRename}
					onDelete={handleDeleteRequest}
				/>
			))}

			<SidebarItem onClick={handleCreate}>
				<FolderPlus className="h-4 w-4 shrink-0" strokeWidth={1.5} />
				<span className="truncate">New Folder</span>
			</SidebarItem>

			{/* Dialogs */}
			<FolderDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				folder={editingFolder}
				onSave={handleSave}
			/>
			<DeleteFolderDialog
				open={deleteDialogOpen}
				onOpenChange={setDeleteDialogOpen}
				folder={deletingFolder}
				onConfirm={handleDeleteConfirm}
			/>
		</>
	);
}

// ── Collapsed: icon-only folder list ──

export function FolderSidebarCollapsed() {
	const navigate = useNavigate();
	const pathname = useLocationPathname();
	const [searchParams] = useSearchParams();
	const folderParam = searchParams.get("folder");
	const isRecordingsPage = isRecordingsPath(pathname);

	const [folders, setFolders] = useState<Folder[]>([]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch("/api/folders");
				if (res.ok && !cancelled) {
					const data = (await res.json()) as { items: Folder[] };
					setFolders(data.items);
				}
			} catch {
				// silently ignore
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const handleFolderSelect = (folderId: string | null) => {
		const params = new URLSearchParams(searchParams.toString());
		if (folderId === null) {
			params.delete("folder");
		} else {
			params.set("folder", folderId);
		}
		const query = params.toString();
		navigate(`/recordings${query ? `?${query}` : ""}`);
	};

	return (
		<div className="mt-2 flex flex-1 flex-col items-center gap-1 overflow-y-auto border-t border-basalt-border pt-2">
			<Tooltip delayDuration={0}>
				<TooltipTrigger asChild>
					<SidebarIconItem
						active={isRecordingsPage && folderParam === null}
						aria-label="All Recordings"
						className="self-center"
						onClick={() => handleFolderSelect(null)}
					>
						<Mic className="h-4 w-4" strokeWidth={1.5} />
					</SidebarIconItem>
				</TooltipTrigger>
				<TooltipContent side="right" sideOffset={8}>
					All Recordings
				</TooltipContent>
			</Tooltip>

			<Tooltip delayDuration={0}>
				<TooltipTrigger asChild>
					<SidebarIconItem
						active={folderParam === "unfiled"}
						aria-label="Unfiled"
						className="self-center"
						onClick={() => handleFolderSelect("unfiled")}
					>
						<Inbox className="h-4 w-4" strokeWidth={1.5} />
					</SidebarIconItem>
				</TooltipTrigger>
				<TooltipContent side="right" sideOffset={8}>
					Unfiled
				</TooltipContent>
			</Tooltip>

			{folders.map((folder) => (
				<Tooltip key={folder.id} delayDuration={0}>
					<TooltipTrigger asChild>
						<SidebarIconItem
							active={folderParam === folder.id}
							aria-label={folder.name}
							className="self-center"
							onClick={() => handleFolderSelect(folder.id)}
						>
							{renderFolderIcon(folderParam === folder.id ? "folder-open" : folder.icon, "h-4 w-4")}
						</SidebarIconItem>
					</TooltipTrigger>
					<TooltipContent side="right" sideOffset={8}>
						{folder.name}
					</TooltipContent>
				</Tooltip>
			))}
		</div>
	);
}
