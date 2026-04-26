# @lyre/web

Vite + React 19 + react-router 7 SPA — Wave D of the Cloudflare Worker
migration (`docs/03-cf-worker-migration-plan.md`).

## Stack

- **Bundler**: Vite 6
- **UI**: React 19 + react-router 7
- **Data**: SWR + custom `apiFetch` / `apiJson` wrapper (`src/lib/api.ts`)
- **Auth**: Cloudflare Access (SSO at the edge). The SPA itself only consumes
  `/api/me`; on 401 we trigger `window.location.reload()` so Access can bounce
  through SSO.
- **Theme**: in-house `theme-utils` + `<ThemeToggle>` (no `next-themes`). FOUC
  prevention via inline `<head>` script in `index.html`.
- **Output**: `vite build` writes to `../api/static/` so the Hono Worker
  (`apps/api`) serves it via `[assets]`.

## Scripts

```
bun run dev         # vite on :7016 (proxies /api → :7017 worker)
bun run build       # production build → ../api/static
bun run typecheck   # tsc --noEmit
bun run lint        # eslint
bun run test        # bun test (api / theme / utils unit tests)
```

## Routes

```
/                    Dashboard
/recordings          Recording list
/recordings/:id      Recording detail (audio + transcript + AI summary)
/settings            General settings
/settings/ai         AI provider config
/settings/storage    OSS storage audit
/settings/tokens     Device token CRUD
```

There is no `/login` — Cloudflare Access handles authentication at the edge.
Logout uses
`https://nocoo.cloudflareaccess.com/cdn-cgi/access/logout` (see
`src/lib/access.ts`).

## Component testing

Component-level tests are deliberately deferred to **Wave E (Playwright)** —
React Testing Library + jsdom adds bulk that the small SPA team would have
to maintain alongside Playwright. The data layer has full unit coverage
(`src/__tests__/api.test.ts`).
