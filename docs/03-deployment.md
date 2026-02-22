# Deployment Guide

This guide walks you through setting up Lyre from scratch — getting all the required API keys, configuring environment variables, and deploying to production.

## Prerequisites

- [Bun](https://bun.sh) v1.0+ (runtime & package manager)
- A Google account (for OAuth setup)
- An Aliyun account (for OSS storage and ASR transcription)

## 1. Google OAuth Setup

Lyre uses Google OAuth for authentication with an email allowlist for access control.

### Create OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth client ID**
5. If prompted, configure the **OAuth consent screen** first:
   - User Type: **External** (or Internal if using Google Workspace)
   - Fill in the required fields (App name, User support email, Developer contact)
   - Scopes: add `email` and `profile`
   - Test users: add your own email (required for External type while in testing mode)
6. Back in Credentials, create the OAuth client ID:
   - Application type: **Web application**
   - Authorized redirect URIs: add the callback URL for your environment

| Environment | Redirect URI |
|---|---|
| Local dev | `http://localhost:7025/api/auth/callback/google` |
| Production | `https://your-domain.com/api/auth/callback/google` |

7. Copy the **Client ID** and **Client Secret**

### Environment Variables

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-client-secret
```

## 2. NextAuth Configuration

### Generate Auth Secret

```bash
openssl rand -base64 32
```

### Access Control

Set a comma-separated list of email addresses allowed to log in:

```bash
AUTH_SECRET=your-generated-secret
ALLOWED_EMAILS=alice@gmail.com,bob@example.com
```

Only emails in this list can sign in. If the list is empty, no one can log in.

### Reverse Proxy (Optional)

If Lyre runs behind an HTTPS reverse proxy in development:

```bash
USE_SECURE_COOKIES=true
```

Not needed in production — `NODE_ENV=production` enables secure cookies automatically.

## 3. Aliyun OSS Setup

Lyre stores audio files in [Aliyun OSS](https://www.alibabacloud.com/product/object-storage-service) (Object Storage Service). The integration uses zero SDK — all requests are signed with a custom V1 signature implementation.

### Create an OSS Bucket

1. Log in to [Aliyun Console](https://home.console.aliyun.com/)
2. Go to **Object Storage Service (OSS)**
3. Click **Create Bucket**
   - Bucket name: `lyre` (for production) or `lyre-dev` (for development)
   - Region: choose a region close to your users (e.g. `oss-cn-beijing`)
   - Storage class: **Standard**
   - Access control: **Private** (recommended)
4. Note the **Region ID** (e.g. `oss-cn-beijing`) and **Endpoint** (e.g. `https://oss-cn-beijing.aliyuncs.com`)

> **Tip**: Create two buckets — `lyre` for production, `lyre-dev` for development. Lyre auto-selects the bucket based on `NODE_ENV`, so you never accidentally mix dev and prod data.

### Create a RAM User

1. Go to **RAM (Resource Access Management)** in Aliyun Console
2. Navigate to **Users → Create User**
3. Check **OpenAPI Access** to generate an AccessKey pair
4. Save the **AccessKey ID** and **AccessKey Secret** immediately (the secret is only shown once)

### Grant OSS Permissions

1. Go to the RAM user you just created
2. Click **Add Permissions**
3. Attach the policy: **AliyunOSSFullAccess** (or create a custom policy scoped to your buckets)

<details>
<summary>Custom policy example (principle of least privilege)</summary>

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "oss:*",
      "Resource": [
        "acs:oss:*:*:lyre",
        "acs:oss:*:*:lyre/*",
        "acs:oss:*:*:lyre-dev",
        "acs:oss:*:*:lyre-dev/*"
      ]
    }
  ]
}
```

</details>

### Configure CORS (Required for Browser Uploads)

In the OSS Console, go to your bucket → **Access Control → Cross-Origin Resource Sharing** and add:

| Field | Value |
|---|---|
| Allowed Origins | `http://localhost:7025`, `https://your-domain.com` |
| Allowed Methods | `GET, PUT, HEAD` |
| Allowed Headers | `*` |
| Expose Headers | `ETag` |

### Environment Variables

```bash
OSS_ACCESS_KEY_ID=your-access-key-id
OSS_ACCESS_KEY_SECRET=your-access-key-secret
OSS_REGION=oss-cn-beijing
OSS_ENDPOINT=https://oss-cn-beijing.aliyuncs.com
```

`OSS_BUCKET` is optional — Lyre auto-resolves the bucket name:
- `NODE_ENV=production` → `lyre`
- Otherwise → `lyre-dev`

To override, set `OSS_BUCKET=your-custom-bucket`.

## 4. Aliyun DashScope ASR Setup

Lyre uses [DashScope](https://dashscope.aliyuncs.com/) for speech-to-text transcription with the `qwen3-asr-flash-filetrans` model.

### Get a DashScope API Key

1. Go to [DashScope Console](https://dashscope.console.aliyun.com/)
2. If you don't have DashScope activated, click **Activate** (free to activate, pay-per-use)
3. Navigate to **API-KEY Management**
4. Click **Create API Key**
5. Copy the generated key

### Environment Variables

```bash
DASHSCOPE_API_KEY=sk-your-dashscope-api-key
```

> **Note**: This variable is optional. If omitted or empty, Lyre uses a mock ASR provider that returns placeholder transcriptions — useful for development and testing without incurring API costs.

## 5. Database

Lyre uses SQLite — no external database server needed. The database file is created automatically.

```bash
# Initialize the schema
bun run db:push
```

Default path: `apps/web/database/lyre.db` (gitignored).

To override (e.g. for Docker volume mounts):

```bash
LYRE_DB=/data/lyre.db
```

## 6. Complete Configuration

Here is the full `.env.local` template with all required variables:

```bash
# ── Auth ──
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-client-secret
AUTH_SECRET=your-generated-secret
ALLOWED_EMAILS=your-email@gmail.com

# ── Aliyun OSS ──
OSS_ACCESS_KEY_ID=your-access-key-id
OSS_ACCESS_KEY_SECRET=your-access-key-secret
OSS_REGION=oss-cn-beijing
OSS_ENDPOINT=https://oss-cn-beijing.aliyuncs.com

# ── ASR (optional, omit for mock mode) ──
DASHSCOPE_API_KEY=sk-your-dashscope-api-key
```

## 7. Run Locally

```bash
# Install dependencies
bun install

# Initialize database
bun run db:push

# Start development server
bun dev
```

Open [http://localhost:7025](http://localhost:7025) and sign in with a Google account listed in `ALLOWED_EMAILS`.

## 8. Deploy with Docker

Lyre ships with a multi-stage Dockerfile optimized for production.

### Build & Run

```bash
docker build -t lyre .

docker run -p 7025:7025 \
  -v lyre-data:/data \
  -e LYRE_DB=/data/lyre.db \
  -e NODE_ENV=production \
  -e GOOGLE_CLIENT_ID=... \
  -e GOOGLE_CLIENT_SECRET=... \
  -e AUTH_SECRET=... \
  -e ALLOWED_EMAILS=... \
  -e OSS_ACCESS_KEY_ID=... \
  -e OSS_ACCESS_KEY_SECRET=... \
  -e OSS_REGION=... \
  -e OSS_ENDPOINT=... \
  -e DASHSCOPE_API_KEY=... \
  lyre
```

> **Important**: Mount a persistent volume at `/data` for SQLite database durability. Without it, your data is lost when the container restarts.

### Deploy to Railway

1. Connect your GitHub repo to [Railway](https://railway.com/)
2. Add a persistent volume mounted at `/data`
3. Set `LYRE_DB=/data/lyre.db` and all other environment variables above
4. Railway auto-deploys on push to `main`

## Environment Variable Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes | — | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | — | Google OAuth Client Secret |
| `AUTH_SECRET` | Yes | — | NextAuth JWT signing secret |
| `ALLOWED_EMAILS` | Yes | `""` | Comma-separated login allowlist |
| `OSS_ACCESS_KEY_ID` | Yes | — | Aliyun RAM AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | Yes | — | Aliyun RAM AccessKey Secret |
| `OSS_REGION` | Yes | — | OSS region (e.g. `oss-cn-beijing`) |
| `OSS_ENDPOINT` | Yes | — | OSS endpoint URL |
| `OSS_BUCKET` | No | Auto (`lyre` / `lyre-dev`) | Override bucket name |
| `DASHSCOPE_API_KEY` | No | — (mock mode) | DashScope API key for ASR |
| `LYRE_DB` | No | `database/lyre.db` | SQLite database file path |
| `USE_SECURE_COOKIES` | No | `false` | Enable secure cookies behind HTTPS proxy |
