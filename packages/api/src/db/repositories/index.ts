/**
 * Repository barrel export.
 *
 * Each repo is a `make<Name>Repo(db)` factory that binds to a Drizzle
 * handle. Handlers receive `ctx.db` from the runtime context and call
 * `makeRepos(ctx.db)` once at the top.
 */

export { makeUsersRepo, type UsersRepo } from "./users";
export { makeRecordingsRepo, type RecordingsRepo } from "./recordings";
export { makeJobsRepo, type JobsRepo } from "./jobs";
export {
  makeTranscriptionsRepo,
  type TranscriptionsRepo,
} from "./transcriptions";
export { makeSettingsRepo, type SettingsRepo } from "./settings";
export { makeFoldersRepo, type FoldersRepo } from "./folders";
export { makeTagsRepo, type TagsRepo } from "./tags";
export { makeDeviceTokensRepo, type DeviceTokensRepo } from "./device-tokens";

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
