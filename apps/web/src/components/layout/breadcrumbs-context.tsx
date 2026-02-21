"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsContextValue {
  items: BreadcrumbItem[];
  setItems: (items: BreadcrumbItem[]) => void;
}

const BreadcrumbsContext = createContext<BreadcrumbsContextValue>({
  items: [],
  setItems: () => {},
});

export function BreadcrumbsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Key the inner provider on pathname so state resets on navigation.
  return (
    <BreadcrumbsProviderInner key={pathname}>
      {children}
    </BreadcrumbsProviderInner>
  );
}

function BreadcrumbsProviderInner({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<BreadcrumbItem[]>([]);

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
  const serialized = JSON.stringify(items);

  useEffect(() => {
    setItems(JSON.parse(serialized) as BreadcrumbItem[]);
  }, [serialized, setItems]);
}
