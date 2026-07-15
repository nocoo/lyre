/**
 * Build a `RuntimeContext` for the cron `scheduled()` handler.
 *
 * No request, no headers, no user — just env + DB.
 */

import type { RuntimeContext } from "@lyre/api/runtime/context";
import type { Bindings } from "../bindings";
import { openD1 } from "./d1";
import { buildLyreEnv } from "./env";

export function buildCronCtx(env: Bindings): RuntimeContext {
	return {
		env: buildLyreEnv(env),
		db: openD1(env.DB),
		user: null,
		headers: new Headers(),
	};
}
