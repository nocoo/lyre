# Backy Remote Backup Integration

Lyre integrates with [Backy](https://backy.dev) for off-site backup storage. Backy provides a webhook-based API that accepts JSON backup files and stores them with environment tagging, versioning, and history retrieval.

## Overview

The integration is **bidirectional**:

| Direction | Flow | Description |
|---|---|---|
| **Push** | Lyre → Backy | User-initiated backup upload |
| **Pull** | Backy → Lyre → Backy | Backy triggers a backup via webhook, Lyre auto-pushes |

### Push Operations

| Operation | HTTP Method | Description |
|---|---|---|
| **Push backup** | `POST` webhook URL | Upload a full JSON backup |
| **Test connection** | `HEAD` webhook URL | Verify webhook reachability |
| **Fetch history** | `GET` webhook URL | Retrieve backup count and recent entries |

All Push requests are authenticated with a Bearer token in the `Authorization` header.

### Pull Operation

| Operation | HTTP Method | Description |
|---|---|---|
| **Pull webhook** | `POST /api/backy/pull` | Backy calls Lyre to trigger an auto-push |
| **Pull health check** | `HEAD /api/backy/pull` | Verify pull key validity |

Pull requests are authenticated with an `X-Webhook-Key` header (no NextAuth session required).

## Setup

### 1. Get Your Backy Webhook

1. Sign in to your Backy dashboard
2. Create a new project (or select an existing one)
3. Copy the **Webhook URL** (e.g., `https://backy.example.com/api/webhook/xxxx`)
4. Copy the **API Key**

### 2. Configure Push in Lyre

1. Navigate to **Settings → General**
2. Scroll to the **Remote Backup** section
3. Enter the Webhook URL and API Key
4. Click **Save**
5. Click **Test Connection** to verify

### 3. Configure Pull Webhook (Optional)

The Pull direction allows Backy to trigger automatic backups by calling Lyre's webhook endpoint.

1. Navigate to **Settings → General**
2. Scroll to the **Pull Webhook** section
3. Click **Generate Key** to create a pull key
4. Copy the **Webhook URL** and **Key**
5. Configure these in your Backy project's outgoing webhook settings

**Prerequisites:** Push configuration (webhook URL + API key) must be set first. Pull uses the existing Push config to send the backup.

## Webhook API

### Push Backup (POST)

Uploads a full JSON backup as `multipart/form-data`.

**Request:**

```http
POST {webhookUrl}
Authorization: Bearer {apiKey}
Content-Type: multipart/form-data

Fields:
  file: <backup.json>            (application/json)
  environment: "prod" | "dev"    (derived from NODE_ENV)
  tag: "v1.5.2-2026-02-23-10rec-5tr-3fld-2tag"
```

**Tag format:** `v{version}-{date}-{recordings}rec-{transcriptions}tr-{folders}fld-{tags}tag`

**Response (200):**

```json
{
  "id": "Tg_jn9aYOt4e_QaaN4iKv",
  "project_name": "lyre",
  "tag": "v1.5.2-2026-02-23-10rec-5tr-3fld-2tag",
  "environment": "prod",
  "file_size": 974787,
  "is_single_json": 1,
  "created_at": "2026-02-23T07:08:10.708Z"
}
```

### Test Connection (HEAD)

Verifies the webhook URL is reachable and the API key is valid.

```http
HEAD {webhookUrl}
Authorization: Bearer {apiKey}
```

Returns `200` if successful.

### Fetch History (GET)

Retrieves the total backup count and the most recent entries.

```http
GET {webhookUrl}
Authorization: Bearer {apiKey}
```

**Response (200):**

```json
{
  "project_name": "lyre",
  "environment": null,
  "total_backups": 3,
  "recent_backups": [
    {
      "id": "Tg_jn9aYOt4e_QaaN4iKv",
      "tag": "v1.5.1-2026-02-23-10rec-10tr-1fld-5tag",
      "environment": "prod",
      "file_size": 974787,
      "is_single_json": 1,
      "created_at": "2026-02-23T07:08:10.708Z"
    }
  ]
}
```

## Pull Webhook API

The Pull webhook allows external systems (Backy) to trigger Lyre backups remotely. Authentication is via the `X-Webhook-Key` header — no NextAuth session is required.

### Health Check (HEAD)

Verifies the pull key is valid without triggering a backup.

```http
HEAD /api/backy/pull
X-Webhook-Key: {pullKey}
```

Returns `200` if the key is valid, `401` otherwise.

### Trigger Backup (POST)

Triggers a full backup push using the user's existing Push configuration.

```http
POST /api/backy/pull
X-Webhook-Key: {pullKey}
```

**Flow:**
1. Validate `X-Webhook-Key` → find userId
2. Read the user's Push config (webhookUrl + apiKey)
3. Export all user data and push to Backy
4. Return the push result

**Response (200 — success):**

```json
{
  "ok": true,
  "message": "Backup pushed successfully (1234ms)",
  "durationMs": 1234,
  "tag": "v1.5.2-2026-02-23-10rec-5tr-3fld-2tag",
  "fileName": "backup.json",
  "stats": { "recordings": 10, "transcriptions": 5, "folders": 3, "tags": 2 }
}
```

**Error responses:**

| Status | Condition |
|---|---|
| `401` | Missing or invalid `X-Webhook-Key` |
| `422` | Push config not set (webhook URL or API key missing) |
| `502` | Backup push to Backy failed |

**curl example:**

```bash
curl -X POST https://your-lyre-instance.com/api/backy/pull \
  -H "X-Webhook-Key: your-64-char-hex-pull-key"
```

## Lyre Internal API

The Lyre web app exposes these internal API routes for the Settings UI:

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/settings/backy` | `GET` | Session | Read Backy config (URL, masked key, environment, pull key info) |
| `/api/settings/backy` | `PUT` | Session | Save Backy config (URL and/or API key) |
| `/api/settings/backy/test` | `POST` | Session | Test connection to Backy webhook |
| `/api/settings/backy/history` | `GET` | Session | Fetch remote backup history |
| `/api/settings/backy/pull-key` | `POST` | Session | Generate (or regenerate) a pull key |
| `/api/settings/backy/pull-key` | `DELETE` | Session | Revoke the pull key |
| `/api/settings/backup/push` | `POST` | Session | Export data and push to Backy |
| `/api/backy/pull` | `HEAD` | Webhook Key | Verify pull key validity |
| `/api/backy/pull` | `POST` | Webhook Key | Trigger a full backup push |

Session-authenticated endpoints require NextAuth login and return `401` if unauthorized. Webhook Key endpoints authenticate via the `X-Webhook-Key` header (machine-to-machine). The `test`, `history`, and `push` endpoints return `400` if the webhook URL or API key is not configured.

## Architecture

```
Push Direction (User-initiated):
  Settings UI (BackySection)
    ├── Save config     → PUT  /api/settings/backy     → settingsRepo (SQLite)
    ├── Test connection → POST /api/settings/backy/test → HEAD webhookUrl
    ├── Push backup     → POST /api/settings/backup/push
    │                     ├── exportBackup(user)         → Full JSON export
    │                     └── POST webhookUrl (multipart) → Backy service
    └── View history    → GET  /api/settings/backy/history
                          └── GET webhookUrl              → Backy service

Pull Direction (Backy-initiated):
  Backy                                     Lyre
    │                                         │
    ├── POST /api/backy/pull ───────────────→ │
    │   (X-Webhook-Key header)                │
    │                                         ├── Validate pull key → find userId
    │                                         ├── Read push config (webhookUrl + apiKey)
    │                                         ├── exportBackup(user) → Full JSON export
    │                                         └── POST webhookUrl (multipart) → Backy ←─┐
    │                                                                                    │
    └────────────────────────────────────── receives backup ─────────────────────────────┘

Pull Key Lifecycle:
  Settings UI (PullWebhookSection)
    ├── Generate key  → POST   /api/settings/backy/pull-key → crypto.randomBytes(32)
    ├── Revoke key    → DELETE /api/settings/backy/pull-key  → settingsRepo.delete
    └── View status   → GET    /api/settings/backy           → hasPullKey, pullKey
```

### Key Files

| File | Purpose |
|---|---|
| `services/backy.ts` | Service layer: `readBackySettings`, `maskApiKey`, `getEnvironment`, `fetchBackyHistory`, pull key CRUD (`generatePullKey`, `readPullKey`, `savePullKey`, `deletePullKey`, `findUserIdByPullKey`) |
| `services/backup.ts` | Backup export/import/push: `exportBackup`, `importBackup`, `pushBackupToBacky` |
| `api/settings/backy/route.ts` | GET/PUT config (includes pull key info in GET response) |
| `api/settings/backy/test/route.ts` | POST test connection |
| `api/settings/backy/history/route.ts` | GET remote history |
| `api/settings/backy/pull-key/route.ts` | POST generate / DELETE revoke pull key |
| `api/settings/backup/push/route.ts` | POST push backup |
| `api/backy/pull/route.ts` | HEAD health check / POST trigger pull-initiated backup |

### Configuration Storage

Backy settings are stored in the SQLite `settings` table (key-value store):

| Key | Value |
|---|---|
| `backy.webhookUrl` | Webhook URL |
| `backy.apiKey` | API key (stored in plain text, masked in API responses) |
| `backy.pullKey` | Pull webhook key (64-char hex string, used for `X-Webhook-Key` auth) |

### Environment Detection

The `environment` field sent with each backup is derived from `NODE_ENV`:

- `production` → `"prod"`
- Anything else → `"dev"`

### Backup Contents

Each backup includes all user data (metadata only, no audio files):

- Folders and tags
- Recordings (metadata + OSS keys)
- Transcription jobs and transcriptions
- Recording-tag associations
- Device tokens
- User settings

## Integrating Backy in Other Projects

To integrate Backy in a new project, you need:

1. **A webhook URL and API key** from the Backy dashboard
2. **A push endpoint** that:
   - Exports your data as JSON
   - Builds a `FormData` with `file`, `environment`, and `tag` fields
   - POSTs to the webhook URL with `Authorization: Bearer {apiKey}`
3. **A history endpoint** (optional) that GETs the webhook URL to display backup count and recent entries

Minimal push example:

```typescript
const form = new FormData();
const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
form.append("file", blob, "backup.json");
form.append("environment", "prod");
form.append("tag", "v1.0.0-2026-02-23");

const res = await fetch(webhookUrl, {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}` },
  body: form,
});
```

**Note on Node.js compatibility:** Use `new Blob()` + `form.append(name, blob, filename)` rather than `new File()`, which may not be available in all Node.js versions.

### TLS with Self-Signed Certificates

If your Backy instance uses mkcert or other self-signed certificates (common in development), add the CA certificate to the Node.js trust store:

```bash
NODE_EXTRA_CA_CERTS="$HOME/Library/Application Support/mkcert/rootCA.pem" node server.js
```

This must be set before the process starts — it cannot be loaded from `.env` files at runtime.
