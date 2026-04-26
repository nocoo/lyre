/**
 * Bootstrap: wire the legacy NextAuth `auth()` into `@lyre/api/lib/api-auth`.
 *
 * Importing this module has a side effect: it registers a session provider
 * with `setAuthSessionProvider`. Every entry point that relies on
 * `getCurrentUser` (i.e. the legacy handler adapter) imports this module
 * so the provider is guaranteed to be registered before any request is
 * served — even when the route handler module graph never reaches `@/auth`
 * directly.
 *
 * The Worker build will use a parallel `bootstrap-auth-worker.ts` to inject
 * a different provider (e.g. Cloudflare Access JWT verification).
 */

import { setAuthSessionProvider } from "@lyre/api/lib/api-auth";
import { auth } from "@/auth";

setAuthSessionProvider(auth);
