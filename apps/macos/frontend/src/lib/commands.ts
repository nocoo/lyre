import { invoke } from "@tauri-apps/api/core";

// Types mirroring Rust structs

export interface Config {
  server_url: string;
  token: string;
}

export interface RecordingInfo {
  path: string;
  name: string;
  size: number;
  duration_secs: number | null;
  created_at: string;
}

export interface UploadResult {
  recordingId: string;
  ossKey: string;
}

export interface UploadOptions {
  filePath: string;
  title?: string;
  folderId?: string;
  tagIds?: string[];
}

export interface UploadProgress {
  phase: "presigning" | "uploading" | "creating" | "completed" | "cancelled" | "error";
  bytesSent: number;
  bytesTotal: number;
  error?: string;
}

export interface ServerFolder {
  id: string;
  name: string;
  icon: string;
}

export interface ServerTag {
  id: string;
  name: string;
}

export interface CleanupFilter {
  before_date?: string | null;
  min_duration_secs?: number | null;
  max_duration_secs?: number | null;
  max_size_bytes?: number | null;
}

export interface CleanupResult {
  deleted_count: number;
  freed_bytes: number;
  errors: CleanupError[];
}

export interface CleanupError {
  path: string;
  error: string;
}

// Tauri command wrappers

export function getConfig(): Promise<Config> {
  return invoke<Config>("get_config");
}

export function saveConfig(serverUrl: string, token: string): Promise<void> {
  return invoke("save_config", { serverUrl, token });
}

export function testConnection(serverUrl: string, token: string): Promise<void> {
  return invoke("test_connection", { serverUrl, token });
}

export function listRecordings(): Promise<RecordingInfo[]> {
  return invoke<RecordingInfo[]>("list_recordings");
}

export function deleteRecording(filePath: string): Promise<void> {
  return invoke("delete_recording", { filePath });
}

export function revealRecording(filePath: string): Promise<void> {
  return invoke("reveal_recording", { filePath });
}

export function uploadRecording(filePath: string): Promise<UploadResult> {
  return invoke<UploadResult>("upload_recording", { filePath });
}

export function uploadRecordingWithProgress(options: UploadOptions): Promise<UploadResult> {
  return invoke<UploadResult>("upload_recording_with_progress", { options });
}

export function cancelUpload(): Promise<void> {
  return invoke("cancel_upload");
}

export function fetchFolders(): Promise<ServerFolder[]> {
  return invoke<ServerFolder[]>("fetch_folders");
}

export function fetchTags(): Promise<ServerTag[]> {
  return invoke<ServerTag[]>("fetch_tags");
}

export function previewCleanup(filter: CleanupFilter): Promise<RecordingInfo[]> {
  return invoke<RecordingInfo[]>("preview_cleanup", { filter });
}

export function batchDeleteRecordings(filePaths: string[]): Promise<CleanupResult> {
  return invoke<CleanupResult>("batch_delete_recordings", { filePaths });
}

export function getOutputDir(): Promise<string> {
  return invoke<string>("get_output_dir");
}

export function setOutputDir(path: string): Promise<void> {
  return invoke("set_output_dir", { path });
}

export function pickOutputDir(): Promise<string | null> {
  return invoke<string | null>("pick_output_dir");
}

export function openOutputDir(): Promise<void> {
  return invoke("open_output_dir");
}
