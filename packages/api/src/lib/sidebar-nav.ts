export interface NavItem {
  href: string;
  label: string;
  exact: boolean;
}

/** Determine if a nav item is active based on exact vs prefix matching. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

/** Check if a path is under the recordings section. */
export function isRecordingsPath(pathname: string): boolean {
  return pathname.startsWith("/recordings");
}

/** Check if a path is under the settings section. */
export function isSettingsPath(pathname: string): boolean {
  return pathname.startsWith("/settings");
}

/**
 * "All Recordings" is active when on /recordings without a folder filter.
 * Used by folder sidebar to highlight the default view.
 */
export function isAllRecordingsActive(
  pathname: string,
  folderParam: string | null,
): boolean {
  return pathname.startsWith("/recordings") && folderParam === null;
}
