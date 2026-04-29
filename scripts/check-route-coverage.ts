/**
 * L2 route coverage gate.
 *
 * Statically extract every (method, path) declared in
 * apps/api/src/index.ts + apps/api/src/routes/**, then statically
 * extract every HTTP request made from e2e/api/**. Fail if any declared
 * route is not exercised by at least one E2E test.
 *
 * This is a structural gate, not behavioural — it only verifies that the
 * route is hit at all. Per-route assertion quality is still the test
 * author's job. But it catches the "we added a new endpoint and forgot
 * to E2E it" miss.
 *
 * Special handling:
 * - `.all()` routes: parsed via regex to extract method-conditional branches
 * - HEAD requests count as exercising GET routes (Hono auto-derivation)
 *
 * Run: `bun run scripts/check-route-coverage.ts`
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const API_SRC = join(ROOT, "apps/api/src");

type RouteMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD";
type Route = { method: RouteMethod; path: string };

// ---------------------------------------------------------------------------
// 1. Discover declared routes
// ---------------------------------------------------------------------------

function loadMountPrefixes(): Map<string, string> {
  const indexPath = join(API_SRC, "index.ts");
  const src = readFileSync(indexPath, "utf-8");
  const prefixes = new Map<string, string>();

  // app.route("/api/live", live)
  const re = /app\.route\(\s*["']([^"']+)["']\s*,\s*(\w+)\s*\)/g;
  for (const m of src.matchAll(re)) {
    const prefix = m[1];
    const varName = m[2];
    if (prefix && varName) prefixes.set(varName, prefix);
  }
  return prefixes;
}

function discoverDirectRoutes(): Route[] {
  const indexPath = join(API_SRC, "index.ts");
  const src = readFileSync(indexPath, "utf-8");
  const routes: Route[] = [];
  // app.get("/path") — direct registrations on the root app
  const re = /\bapp\.(get|post|put|delete|patch|head)\(\s*["']([^"']+)["']/g;
  for (const m of src.matchAll(re)) {
    const method = m[1];
    const path = m[2];
    if (method && path) {
      routes.push({ method: method.toUpperCase() as RouteMethod, path });
    }
  }
  return routes;
}

function discoverSubRoutes(prefixes: Map<string, string>): Route[] {
  const routesDir = join(API_SRC, "routes");
  const allFiles = readdirSync(routesDir, { recursive: true })
    .filter((f) => typeof f === "string" && f.endsWith(".ts"))
    .map((f) => f as string);
  const routes: Route[] = [];

  for (const file of allFiles) {
    const filePath = join(routesDir, file);
    const src = readFileSync(filePath, "utf-8");

    // Standard: router.get("/path") / router.post("/path") etc.
    const routeRe =
      /\b(\w+)\.(get|post|put|delete|patch|head)\(\s*["']([^"']*)["']/g;
    for (const m of src.matchAll(routeRe)) {
      const varName = m[1];
      const method = m[2];
      const localPath = m[3];
      if (!varName || !method || localPath === undefined) continue;
      const prefix = prefixes.get(varName);
      if (!prefix) continue;
      const fullPath = localPath === "/" ? prefix : `${prefix}${localPath}`;
      routes.push({
        method: method.toUpperCase() as RouteMethod,
        path: fullPath,
      });
    }

    // .all() routes — extract method branches from the handler body.
    // Pattern: if (method === "HEAD") / else if (method === "POST")
    const allRe = /\b(\w+)\.all\(\s*["']([^"']*)["']/g;
    for (const m of src.matchAll(allRe)) {
      const varName = m[1];
      const localPath = m[2];
      if (!varName || localPath === undefined) continue;
      const prefix = prefixes.get(varName);
      if (!prefix) continue;
      const fullPath = localPath === "/" ? prefix : `${prefix}${localPath}`;

      // Look for method dispatch in the handler
      const methodChecks = [
        ...src.matchAll(
          /method\s*===?\s*["'](\w+)["']|c\.req\.method\s*===?\s*["'](\w+)["']/g,
        ),
      ];
      const methods = new Set<RouteMethod>();
      for (const check of methodChecks) {
        const m2 = check[1] ?? check[2];
        if (m2) methods.add(m2.toUpperCase() as RouteMethod);
      }

      if (methods.size > 0) {
        for (const method of methods) {
          routes.push({ method, path: fullPath });
        }
      } else {
        // Fallback: if we can't detect specific methods, add HEAD + POST
        // (common pattern for backy pull endpoints)
        routes.push({ method: "HEAD", path: fullPath });
        routes.push({ method: "POST", path: fullPath });
      }
    }
  }
  return routes;
}

// ---------------------------------------------------------------------------
// 2. Discover exercised routes from e2e/api/
// ---------------------------------------------------------------------------

const HELPER_TO_METHOD: Record<string, RouteMethod> = {
  get: "GET",
  post: "POST",
  put: "PUT",
  del: "DELETE",
  patch: "PATCH",
  head: "HEAD",
};

function discoverE2ERequests(): Route[] {
  const e2eDir = join(ROOT, "e2e/api");
  const files = readdirSync(e2eDir).filter((f) => f.endsWith(".ts"));
  const requests: Route[] = [];

  for (const file of files) {
    const src = readFileSync(join(e2eDir, file), "utf-8");

    // get("/api/x", …)  or  get(`/api/x/${id}/y`, …)
    // For template literals, capture everything up to the closing backtick
    const helperRe =
      /\b(get|post|put|del|patch|head)\(\s*`([^`]+)`|\b(get|post|put|del|patch|head)\(\s*["']([^"']+)["']/g;
    for (const m of src.matchAll(helperRe)) {
      const helper = m[1] ?? m[3];
      const rawPath = m[2] ?? m[4];
      if (!helper || !rawPath) continue;
      const method = HELPER_TO_METHOD[helper];
      if (!method) continue;
      if (!rawPath.startsWith("/api/")) continue;
      requests.push({ method, path: rawPath });
    }

    // Raw fetch("...path...", { method: "GET" })
    const fetchRe =
      /fetch\([^)]*?["'`][^"'`]*?(\/api\/[^"'`?]+)[^"'`]*?["'`][^)]*?\)/gs;
    for (const m of src.matchAll(fetchRe)) {
      const rawPath = m[1];
      const block = m[0];
      if (!rawPath) continue;
      const methodMatch = block.match(/method:\s*["'`](\w+)["'`]/);
      const method = (methodMatch?.[1]?.toUpperCase() ?? "GET") as RouteMethod;
      requests.push({ method, path: rawPath });
    }
  }
  return requests;
}

// ---------------------------------------------------------------------------
// 3. Match E2E requests against declared routes
// ---------------------------------------------------------------------------

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

function normaliseRequestPath(path: string): string {
  // Strip query strings
  const withoutQuery = path.split("?")[0] ?? path;
  // Replace template literal interpolations with a placeholder segment
  return withoutQuery.replace(/\$\{[^}]+\}/g, "x");
}

function isMatch(route: Route, request: Route): boolean {
  // Hono dispatches HEAD requests to GET handlers
  const methodOk =
    route.method === request.method ||
    (route.method === "GET" && request.method === "HEAD");
  if (!methodOk) return false;
  const re = routeToRegex(route.path);
  return re.test(normaliseRequestPath(request.path));
}

// ---------------------------------------------------------------------------
// 4. Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log("=== L2 Route Coverage Gate ===\n");

  const prefixes = loadMountPrefixes();
  const declared = [...discoverDirectRoutes(), ...discoverSubRoutes(prefixes)];
  const requests = discoverE2ERequests();

  // Deduplicate declared routes
  const seen = new Set<string>();
  const uniqueDeclared = declared.filter((r) => {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`Declared routes: ${uniqueDeclared.length}`);
  console.log(`E2E requests:    ${requests.length}\n`);

  const uncovered: Route[] = [];
  for (const route of uniqueDeclared) {
    const hit = requests.some((req) => isMatch(route, req));
    if (!hit) uncovered.push(route);
  }

  if (uncovered.length === 0) {
    console.log(
      `All ${uniqueDeclared.length} routes have at least one E2E request.\n`,
    );
    return;
  }

  console.error(`${uncovered.length} route(s) have NO E2E coverage:\n`);
  for (const r of uncovered) {
    console.error(`  ${r.method.padEnd(6)} ${r.path}`);
  }
  console.error("\nAdd a request in e2e/api/ for each uncovered route.\n");
  process.exit(1);
}

main();
