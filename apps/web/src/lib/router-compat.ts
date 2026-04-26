/**
 * Tiny compatibility helpers to bridge legacy Next.js navigation patterns
 * to react-router 7 semantics.
 */
import { useLocation } from "react-router";

/** Drop-in replacement for Next's `usePathname()`. */
export function useLocationPathname(): string {
  return useLocation().pathname;
}
