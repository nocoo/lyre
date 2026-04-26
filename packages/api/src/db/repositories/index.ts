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
