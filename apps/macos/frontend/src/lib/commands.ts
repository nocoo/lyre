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
