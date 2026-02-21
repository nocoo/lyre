# 02 - AI Summary Feature

AI-powered meeting minutes summarization from transcribed audio recordings.

## Overview

After a recording is transcribed (ASR → full text), users can generate a plain-text
summary using an Anthropic-compatible LLM API. Supports 4 providers with configurable
base URL, API key, and model. Configuration is stored per-user in the settings table.

## Providers

| Provider | Base URL | Default Model |
| -------- | -------- | ------------- |
| Anthropic | `https://api.anthropic.com/v1` | `claude-sonnet-4-20250514` |
| GLM (Zhipu) | `https://open.bigmodel.cn/api/anthropic` | `glm-4` |
| MiniMax | `https://api.minimaxi.com/anthropic` | `MiniMax-M1` |
| AIHubMix | `https://aihubmix.com/v1` | `claude-sonnet-4-20250514` |

## Settings Keys (per-user, stored in `settings` table)

| Key | Type | Default | Description |
| --- | ---- | ------- | ----------- |
| `ai.provider` | `string` | `""` (unconfigured) | Provider ID |
| `ai.apiKey` | `string` | `""` | API key |
| `ai.model` | `string` | `""` | Model name (falls back to provider default) |
| `ai.autoSummarize` | `"true" \| "false"` | `"false"` | Auto-generate summary after transcription |

## Implementation Phases

### Phase 1: AI Service Module (`src/services/ai.ts`)
- `AiProvider` type (union of provider IDs)
- `AiConfig` interface (provider, baseURL, apiKey, model)
- `getProviderConfig(providerId)` → returns base URL + default model
- `createAiClient(config)` → Vercel AI SDK anthropic provider instance
- `generateSummary(client, model, transcript)` → plain text summary
- Mock provider for testing (returns canned summary)

### Phase 2: AI Settings Storage (API)
- `GET /api/settings/ai` → read AI config for current user
- `PUT /api/settings/ai` → save AI config (upsert multiple keys)
- `POST /api/settings/ai/test` → test connection (send a short prompt)

### Phase 3: Summarize API
- `POST /api/recordings/[id]/summarize` → generate + store summary
  - Reads transcription full text
  - Loads user's AI config from settings
  - Calls LLM, saves result to `recordings.ai_summary`
  - Returns `{ summary }`

### Phase 4: Settings UI — AI Configuration Section
- New section in Settings page with:
  - Provider selector (dropdown)
  - API Key input (password field)
  - Model input (text, placeholder shows provider default)
  - Auto-summarize toggle (default off)
  - Save button + Test Connection button

### Phase 5: Recording Detail — AI Summary Display
- New card between job info and transcription
- Shows summary text (or empty state with "Generate Summary" button)
- "Regenerate" button when summary exists
- Loading state during generation

### Phase 6: Auto-summarize on Transcription Complete
- In job polling endpoint, after transcription succeeds:
  - Check user's `ai.autoSummarize` setting
  - If enabled and AI is configured, trigger summary generation

### Phase 7: E2E Tests

## Stack

- `@ai-sdk/anthropic` — Vercel AI SDK Anthropic provider
- `ai` — Vercel AI SDK core (`generateText`)
- Settings stored via existing `settingsRepo`
- Summary stored in existing `recordings.ai_summary` column

## Prompt (v1, minimal)

```
Summarize the following transcript concisely in the same language as the transcript.

<transcript>
{fullText}
</transcript>
```
