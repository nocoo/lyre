"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

/** Internal state stores items tagged with the pathname they belong to. */
interface BreadcrumbState {
  pathname: string;
  items: BreadcrumbItem[];
}

interface BreadcrumbsContextValue {
  /** Returns items only if they match the current pathname, otherwise []. */
  items: BreadcrumbItem[];
  setItems: (items: BreadcrumbItem[], pathname: string) => void;
}

const BreadcrumbsContext = createContext<BreadcrumbsContextValue>({
  items: [],
  setItems: () => {},
});

export function BreadcrumbsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<BreadcrumbState>({
    pathname,
    items: [],
  });

  // Derive items: only expose them if they belong to the current pathname.
  // When navigating to a new page, stale breadcrumbs from the old page are
  // automatically ignored until the new page calls useSetBreadcrumbs().
  const items = state.pathname === pathname ? state.items : [];

  const setItems = useCallback(
    (newItems: BreadcrumbItem[], forPathname: string) => {
      setState({ pathname: forPathname, items: newItems });
    },
    [],
  );

  return (
    <BreadcrumbsContext.Provider value={{ items, setItems }}>
      {children}
    </BreadcrumbsContext.Provider>
  );
}

export function useBreadcrumbs() {
  return useContext(BreadcrumbsContext);
}

/**
 * Hook for pages to declare their breadcrumbs.
 * Call once at the top of a page component.
 */
export function useSetBreadcrumbs(items: BreadcrumbItem[]) {
  const { setItems } = useBreadcrumbs();
  const pathname = usePathname();
  const serialized = JSON.stringify(items);

  useEffect(() => {
    setItems(JSON.parse(serialized) as BreadcrumbItem[], pathname);
  }, [serialized, setItems, pathname]);
}
