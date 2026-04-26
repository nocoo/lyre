/**
 * RequireAuth — top-level auth gate.
 *
 * Cloudflare Access handles SSO at the edge. This component just ensures we
 * have a user from /api/me before rendering the app. While loading, show a
 * loading screen. On 401 the api layer triggers `location.reload()` which
 * Access intercepts → redirect to SSO. Children are rendered as soon as `me`
 * is defined.
 */

import type { ReactNode } from "react";
import { useMe } from "@/hooks/use-me";
import LoadingScreen from "@/components/loading-screen";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { me, isLoading } = useMe();

  if (isLoading || !me) {
    return <LoadingScreen />;
  }

  return <>{children}</>;
}
