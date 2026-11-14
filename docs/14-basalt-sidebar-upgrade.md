# Basalt 3.3.4 sidebar acceptance

The web workspace keeps its exact dependency constraint and resolves
`@nocoo/basalt@3.3.4` in `bun.lock`. Mobile navigation now uses the published
`SidebarDrawer` API. Basalt owns modal scroll locking, hidden title/description,
focus restoration, padding, and the forced-expanded provider. The application
retains navigation data, session identity, routing and close-on-navigation.

## User-approved geometry

The user approved changing acceptance from an outer 260px drawer to an outer
320px drawer, with the inner sidebar remaining 260px. This is an acceptance
amendment, not a Basalt geometry fix or evidence that the old outer-260px
criterion passed. No consumer CSS, inline geometry repair or package patch is
used.

`e2e/bdd/sidebar-geometry.spec.ts` adds ten real Chromium cases:

- Light and dark themes at desktop widths 1024px and 1440px: expanded sidebar
  260px, collapsed rail 68px, avatar 36×36px with exactly equal y coordinates,
  email line-height 16px, hidden collapsed brand copy, stable 24px logo, Access
  sign-out destination and settings navigation.
- Both themes at mobile widths 390px, 640px and 767px: outer drawer 320px,
  inner sidebar 260px, zero padding, one sidebar, expanded brand, avatar and
  email geometry, accessible title/description and trigger state, dismiss
  button, internal keyboard focus, first Escape, focus restoration, route
  closure and retained active navigation.

All original browser tests and assertions remain. The original mobile case also
checks Escape with the drawer's natural opening focus. No tests were removed,
skipped or given a lower quality threshold. Actual signed-in production avatar
acceptance remains a manual owner check.

## Retained application customizations

- FolderSidebar, GlobalSearch and mobile-close context preserve recording,
  folder and search behavior, including navigation within the same pathname.
- Session avatar fallback and the Access sign-out URL preserve authenticated
  identity and the existing logout provider. Avatar size uses Basalt defaults.
- The existing logo resource and build-derived version preserve accepted artwork
  and accurate product version; Basalt owns the 24px logo slot.
- ProjectLinks, ThemeToggle, PageHeader and scroll-to-top preserve framework
  actions, page hierarchy and content scrolling.

## Missing-tool self-test repair

The former native negative probe removed PATH directory names containing
`swiftlint`. On this Mac the executable is `/opt/homebrew/bin/swiftlint`, so no
entry was removed and the real healthy hook passed, incorrectly failing the
negative probe.

The self-test now constructs an owned temporary PATH from symlinks to actual
executables, preserving PATH precedence. With all native tools present it first
runs the unchanged production pre-commit gate successfully. It then removes
only its own link for each required native tool, confirms that executable
lookup really fails, and requires the actual gate to reject with the matching
`Missing required tool` diagnostic. An unrelated failure is not accepted as
proof. Hosts already missing a native tool retain the direct rejection probe.
Machine executables, global PATH, production checks and quality floors are not
changed.

Three Python regressions cover PATH precedence/cleanup, real production-gate
rejection with an absent native tool, and rejection of unrelated failures or
unexpected acceptance. They run alongside the original gate unit tests through
`bun run gate:l1-selftest`; all existing negative probes remain.
