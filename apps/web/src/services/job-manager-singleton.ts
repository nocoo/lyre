/**
 * Job Manager singleton.
 *
 * Follows the same pattern as asr-provider.ts — a lazily-initialized
 * module-level singleton with reset/override helpers for testing.
 */

import { JobManager } from "./job-manager";
import { getAsrProvider } from "./asr-provider";
import { jobsRepo } from "@/db/repositories";

let instance: JobManager | null = null;

/**
 * Get the global JobManager singleton.
 * Creates and starts it on first call.
 */
export function getJobManager(): JobManager {
  if (instance) return instance;

  instance = new JobManager({
    getProvider: () => getAsrProvider(),
    findActiveJobs: () => jobsRepo.findActive(),
    findJobById: (id) => jobsRepo.findById(id),
  });

  instance.start();
  return instance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetJobManager(): void {
  if (instance) {
    instance.stop();
    instance = null;
  }
}

/**
 * Set a custom JobManager instance (for testing).
 */
export function setJobManager(custom: JobManager): void {
  if (instance) instance.stop();
  instance = custom;
}
