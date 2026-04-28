/**
 * Router compatibility shim for react-router.
 */
import { useLocation } from "react-router";

/** Returns the current pathname. */
export function useLocationPathname(): string {
  return useLocation().pathname;
}
