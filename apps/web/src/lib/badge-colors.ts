/**
 * Shared badge color system.
 *
 * - Status badges use fixed semantic colors via Badge variants.
 * - Tag badges use hash-based color assignment from a stable palette
 *   using the "soft" pattern: `bg-{color}-500/15 text-{color}-600`.
 */

// ── Soft color palette for tags ──

export interface TagColor {
  /** Background class (soft tint) */
  bg: string;
  /** Text class */
  text: string;
}

/**
 * 12-color palette for tags.
 * Uses the "soft" pattern: translucent background + saturated text.
 * Dark mode adjusts automatically via Tailwind `dark:` variants.
 */
const TAG_PALETTE: TagColor[] = [
  { bg: "bg-blue-500/15", text: "text-blue-600 dark:text-blue-400" },
  { bg: "bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-400" },
  { bg: "bg-violet-500/15", text: "text-violet-600 dark:text-violet-400" },
  { bg: "bg-orange-500/15", text: "text-orange-600 dark:text-orange-400" },
  { bg: "bg-pink-500/15", text: "text-pink-600 dark:text-pink-400" },
  { bg: "bg-teal-500/15", text: "text-teal-600 dark:text-teal-400" },
  { bg: "bg-indigo-500/15", text: "text-indigo-600 dark:text-indigo-400" },
  { bg: "bg-amber-500/15", text: "text-amber-600 dark:text-amber-400" },
  { bg: "bg-cyan-500/15", text: "text-cyan-600 dark:text-cyan-400" },
  { bg: "bg-rose-500/15", text: "text-rose-600 dark:text-rose-400" },
  { bg: "bg-lime-500/15", text: "text-lime-600 dark:text-lime-400" },
  { bg: "bg-fuchsia-500/15", text: "text-fuchsia-600 dark:text-fuchsia-400" },
];

/**
 * Hash a string to a stable numeric index.
 * Handles Unicode (including CJK characters) via charCodeAt.
 */
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Get a stable color from the palette for a given tag name. */
export function getTagColor(name: string): TagColor {
  return TAG_PALETTE[hashString(name) % TAG_PALETTE.length]!;
}
