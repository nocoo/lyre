import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

type Page = { path: string };

function discoverClientRoutes(): Page[] {
  const src = readFileSync(join(ROOT, "apps/web/src/App.tsx"), "utf-8");
  const re = /<Route\s+path=["']([^"']+)["']/g;
  const pages: Page[] = [];
  for (const m of src.matchAll(re)) {
    const path = m[1];
    if (path) pages.push({ path });
  }
  return pages;
}

function discoverBddTargets(): string[] {
  const bddDir = join(ROOT, "e2e/bdd");
  const files = readdirSync(bddDir).filter((f) => f.endsWith(".spec.ts"));
  const targets: string[] = [];

  for (const file of files) {
    const src = readFileSync(join(bddDir, file), "utf-8");

    const literalRe = /[`"'](\/[a-zA-Z0-9_\-/:${}]*)[`"']/g;
    for (const m of src.matchAll(literalRe)) {
      const raw = m[1];
      if (!raw) continue;
      const normalised =
        raw.replace(/\$\{[^}]+\}/g, "x").split(/[?#]/)[0] ?? "";
      if (normalised) targets.push(normalised);
    }

    const hasURLRe = /toHaveURL\(\s*\/((?:\\\/|[^/\\])+)\//g;
    for (const m of src.matchAll(hasURLRe)) {
      const reSrc = m[1];
      if (!reSrc) continue;
      const literal = reSrc
        .replace(/\\\//g, "/")
        .replace(/\[[^\]]+\][+*?]?/g, "x")
        .replace(/\(\?:[^)]+\)[+*?]?/g, "x")
        .replace(/[\^$]/g, "");
      if (literal.startsWith("/")) targets.push(literal);
    }
  }
  return targets;
}

function routeToRegex(path: string): RegExp {
  const escaped = path
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) return "[^/]+";
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${escaped}$`);
}

function isCovered(page: Page, targets: string[]): boolean {
  const re = routeToRegex(page.path);
  return targets.some((t) => re.test(t));
}

function main(): void {
  console.log("=== L3 Page Coverage Gate ===\n");

  const pages = discoverClientRoutes();
  const targets = discoverBddTargets();

  console.log(`Declared pages: ${pages.length}`);
  console.log(`BDD targets:    ${targets.length}\n`);

  const uncovered = pages.filter((p) => !isCovered(p, targets));

  if (uncovered.length === 0) {
    console.log(`All ${pages.length} pages have at least one BDD spec.\n`);
    return;
  }

  console.error(`${uncovered.length} page(s) have NO BDD coverage:\n`);
  for (const p of uncovered) {
    console.error(`  ${p.path}`);
  }
  console.error("\nAdd a page.goto(...) in e2e/bdd/ for each uncovered page.\n");
  process.exit(1);
}

main();
