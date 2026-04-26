/**
 * Repository barrel export.
 *
 * Exports both the legacy singleton repos (bound to the global SQLite
 * handle) AND the per-db factories `make<Name>Repo(db)`. Wave B.6.b is
 * migrating handlers to call the factories with `ctx.db`; once that's
 * done the singletons can go away.
 */

export { usersRepo, makeUsersRepo, type UsersRepo } from "./users";
export {
  recordingsRepo,
  makeRecordingsRepo,
  type RecordingsRepo,
} from "./recordings";
export { jobsRepo, makeJobsRepo, type JobsRepo } from "./jobs";
export {
  transcriptionsRepo,
  makeTranscriptionsRepo,
  type TranscriptionsRepo,
} from "./transcriptions";
export {
  settingsRepo,
  makeSettingsRepo,
  type SettingsRepo,
} from "./settings";
export {
  foldersRepo,
  makeFoldersRepo,
  type FoldersRepo,
} from "./folders";
export { tagsRepo, makeTagsRepo, type TagsRepo } from "./tags";
export {
  deviceTokensRepo,
  makeDeviceTokensRepo,
  type DeviceTokensRepo,
} from "./device-tokens";

import type { LyreDb } from "../types";
import { makeUsersRepo, type UsersRepo } from "./users";
import { makeRecordingsRepo, type RecordingsRepo } from "./recordings";
import { makeJobsRepo, type JobsRepo } from "./jobs";
import {
  makeTranscriptionsRepo,
  type TranscriptionsRepo,
} from "./transcriptions";
import { makeSettingsRepo, type SettingsRepo } from "./settings";
import { makeFoldersRepo, type FoldersRepo } from "./folders";
import { makeTagsRepo, type TagsRepo } from "./tags";
import {
  makeDeviceTokensRepo,
  type DeviceTokensRepo,
} from "./device-tokens";

/**
 * The whole repo bundle bound to a single Drizzle handle.
 *
 * Handlers receive `ctx.db` and call `makeRepos(ctx.db)` once at the top —
 * cheap (just object construction) and keeps the handler signature short
 * while removing the global-singleton dependency.
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
