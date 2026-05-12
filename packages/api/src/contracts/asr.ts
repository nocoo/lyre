export const ASR_FILETRANS_MODELS = [
  "qwen3-asr-flash-filetrans",
  "qwen3-asr-flash-filetrans-2025-11-17",
] as const;

export type AsrFiletransModel = (typeof ASR_FILETRANS_MODELS)[number];

export const DEFAULT_ASR_MODEL: AsrFiletransModel = "qwen3-asr-flash-filetrans";

export function isValidAsrModel(model: string): model is AsrFiletransModel {
  return (ASR_FILETRANS_MODELS as readonly string[]).includes(model);
}
