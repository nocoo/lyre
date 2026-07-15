/**
 * Repository barrel export.
 *
 * Each repo is a `make<Name>Repo(db)` factory that binds to a Drizzle
 * handle. Handlers receive `ctx.db` from the runtime context and call
 * `makeRepos(ctx.db)` once at the top.
 */

export { type DeviceTokensRepo, makeDeviceTokensRepo } from "./device-tokens";
export { type FoldersRepo, makeFoldersRepo } from "./folders";
export { type JobsRepo, makeJobsRepo } from "./jobs";
export { makeRecordingsRepo, type RecordingsRepo } from "./recordings";
export { makeSettingsRepo, type SettingsRepo } from "./settings";
export { makeTagsRepo, type TagsRepo } from "./tags";
export {
	makeTranscriptionsRepo,
	type TranscriptionsRepo,
} from "./transcriptions";
export { makeUsersRepo, type UsersRepo } from "./users";

import type { LyreDb } from "../types";
import { type DeviceTokensRepo, makeDeviceTokensRepo } from "./device-tokens";
import { type FoldersRepo, makeFoldersRepo } from "./folders";
import { type JobsRepo, makeJobsRepo } from "./jobs";
import { makeRecordingsRepo, type RecordingsRepo } from "./recordings";
import { makeSettingsRepo, type SettingsRepo } from "./settings";
import { makeTagsRepo, type TagsRepo } from "./tags";
import { makeTranscriptionsRepo, type TranscriptionsRepo } from "./transcriptions";
import { makeUsersRepo, type UsersRepo } from "./users";

/**
 * The whole repo bundle bound to a single Drizzle handle.
 */
export interface Repos {
	users: UsersRepo;
	recordings: RecordingsRepo;
	jobs: JobsRepo;
	transcriptions: TranscriptionsRepo;
	settings: SettingsRepo;
	folders: FoldersRepo;
	tags: TagsRepo;
	deviceTokens: DeviceTokensRepo;
}

export function makeRepos(db: LyreDb): Repos {
	return {
		users: makeUsersRepo(db),
		recordings: makeRecordingsRepo(db),
		jobs: makeJobsRepo(db),
		transcriptions: makeTranscriptionsRepo(db),
		settings: makeSettingsRepo(db),
		folders: makeFoldersRepo(db),
		tags: makeTagsRepo(db),
		deviceTokens: makeDeviceTokensRepo(db),
	};
}
