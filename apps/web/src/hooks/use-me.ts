/**
 * useMe — SWR hook for the authenticated user from /api/me.
 *
 * Returns `undefined` while loading. On 401 the api layer triggers a full
 * page reload so Cloudflare Access can intercept and bounce through SSO.
 */

import useSWR from "swr";
import { apiJson } from "@/lib/api";

export interface MeResponse {
  email: string;
  name: string;
  avatarUrl: string | null;
}

const fetcher = (path: string) => apiJson<MeResponse>(path);

export function useMe() {
  const { data, error, isLoading } = useSWR<MeResponse>("/api/me", fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  return { me: data, error, isLoading };
}

/**
 * Adapter that provides a `useSession()`-like API for sidebar components.
 * Returns `session.user.{name,email,image}` shape.
 */
export interface SessionUserShape {
  name: string;
  email: string;
  image: string | null;
}

export function useSession(): { data: { user: SessionUserShape } | null } {
  const { me } = useMe();
  if (!me) return { data: null };
  return {
    data: {
      user: { name: me.name, email: me.email, image: me.avatarUrl },
    },
  };
}
