/**
 * Handlers for `/api/settings/oss` and `/api/settings/oss/cleanup`.
 */

import {
  usersRepo,
  recordingsRepo,
  jobsRepo,
} from "../db/repositories";
import { listObjects, deleteObjects, type OssObject } from "../services/oss";
import type { RuntimeContext } from "../runtime/context";
import {
  json,
  badRequest,
  unauthorized,
  type HandlerResponse,
} from "./http";

interface FileInfo {
  key: string;
  size: number;
  lastModified: string;
  hasDbRecord: boolean;
}
interface TaskFolder {
  id: string;
  files: FileInfo[];
  totalSize: number;
  hasDbRecord: boolean;
}
interface UserBucket {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  uploads: {
    folders: TaskFolder[];
    totalSize: number;
    totalFiles: number;
    orphanFolders: number;
    orphanSize: number;
  };
  results: {
    folders: TaskFolder[];
    totalSize: number;
    totalFiles: number;
    orphanFolders: number;
    orphanSize: number;
  };
}

function groupByPrefix(
  objects: OssObject[],
  depth: number,
): Map<string, OssObject[]> {
  const groups = new Map<string, OssObject[]>();
  for (const obj of objects) {
    const parts = obj.key.split("/");
    if (parts.length <= depth) continue;
    const prefix = parts.slice(0, depth).join("/");
    const group = groups.get(prefix) ?? [];
    group.push(obj);
    groups.set(prefix, group);
  }
  return groups;
}

export async function ossScanHandler(
  ctx: RuntimeContext,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const [uploadObjects, resultObjects] = await Promise.all([
    listObjects("uploads/", undefined, ctx.env),
    listObjects("results/", undefined, ctx.env),
  ]);
  const allUsers = usersRepo.findAll();
  const userMap = new Map(allUsers.map((u) => [u.id, u]));
  const jobUserMap = new Map<string, string>();
  const recordingIdSet = new Set<string>();
  for (const u of allUsers) {
    const recs = recordingsRepo.findAll(u.id);
    for (const rec of recs) {
      recordingIdSet.add(rec.id);
      for (const job of jobsRepo.findByRecordingId(rec.id)) {
        jobUserMap.set(job.id, u.id);
      }
    }
  }

  const uploadsByUser = new Map<string, OssObject[]>();
  for (const obj of uploadObjects) {
    const parts = obj.key.split("/");
    if (parts.length < 4) continue;
    const userId = parts[1]!;
    const list = uploadsByUser.get(userId) ?? [];
    list.push(obj);
    uploadsByUser.set(userId, list);
  }

  const resultsByJobId = groupByPrefix(resultObjects, 2);
  const resultsByUser = new Map<string, TaskFolder[]>();
  const unlinkedResults: TaskFolder[] = [];

  for (const [prefix, objects] of resultsByJobId) {
    const jobId = prefix.split("/")[1]!;
    const folder: TaskFolder = {
      id: jobId,
      files: objects.map((o) => ({
        key: o.key,
        size: o.size,
        lastModified: o.lastModified,
        hasDbRecord: jobsRepo.findById(jobId) !== undefined,
      })),
      totalSize: objects.reduce((s, o) => s + o.size, 0),
      hasDbRecord: jobsRepo.findById(jobId) !== undefined,
    };
    const userId = jobUserMap.get(jobId);
    if (userId) {
      const list = resultsByUser.get(userId) ?? [];
      list.push(folder);
      resultsByUser.set(userId, list);
    } else {
      unlinkedResults.push(folder);
    }
  }

  const allUserIds = new Set([
    ...uploadsByUser.keys(),
    ...resultsByUser.keys(),
  ]);
  const userBuckets: UserBucket[] = [];
  let totalSize = 0;
  let totalFiles = 0;
  let totalOrphanFiles = 0;
  let totalOrphanSize = 0;

  for (const userId of allUserIds) {
    const dbUser = userMap.get(userId);
    const userUploads = uploadsByUser.get(userId) ?? [];
    const uploadFolderMap = groupByPrefix(userUploads, 3);
    const uploadFolders: TaskFolder[] = [];
    let uploadTotalSize = 0;
    let uploadTotalFiles = 0;
    let uploadOrphanFolders = 0;
    let uploadOrphanSize = 0;
    for (const [prefix, objects] of uploadFolderMap) {
      const recordingId = prefix.split("/")[2]!;
      const hasRecord = recordingIdSet.has(recordingId);
      const folderSize = objects.reduce((s, o) => s + o.size, 0);
      uploadFolders.push({
        id: recordingId,
        files: objects.map((o) => ({
          key: o.key,
          size: o.size,
          lastModified: o.lastModified,
          hasDbRecord: hasRecord,
        })),
        totalSize: folderSize,
        hasDbRecord: hasRecord,
      });
      uploadTotalSize += folderSize;
      uploadTotalFiles += objects.length;
      if (!hasRecord) {
        uploadOrphanFolders++;
        uploadOrphanSize += folderSize;
      }
    }

    const userResults = resultsByUser.get(userId) ?? [];
    let resultTotalSize = 0;
    let resultTotalFiles = 0;
    let resultOrphanFolders = 0;
    let resultOrphanSize = 0;
    for (const folder of userResults) {
      resultTotalSize += folder.totalSize;
      resultTotalFiles += folder.files.length;
      if (!folder.hasDbRecord) {
        resultOrphanFolders++;
        resultOrphanSize += folder.totalSize;
      }
    }

    userBuckets.push({
      userId,
      userName: dbUser?.name ?? null,
      userEmail: dbUser?.email ?? null,
      uploads: {
        folders: uploadFolders,
        totalSize: uploadTotalSize,
        totalFiles: uploadTotalFiles,
        orphanFolders: uploadOrphanFolders,
        orphanSize: uploadOrphanSize,
      },
      results: {
        folders: userResults,
        totalSize: resultTotalSize,
        totalFiles: resultTotalFiles,
        orphanFolders: resultOrphanFolders,
        orphanSize: resultOrphanSize,
      },
    });

    totalSize += uploadTotalSize + resultTotalSize;
    totalFiles += uploadTotalFiles + resultTotalFiles;
    totalOrphanFiles +=
      (uploadOrphanFolders > 0
        ? uploadFolders
            .filter((f) => !f.hasDbRecord)
            .reduce((n, f) => n + f.files.length, 0)
        : 0) +
      (resultOrphanFolders > 0
        ? userResults
            .filter((f) => !f.hasDbRecord)
            .reduce((n, f) => n + f.files.length, 0)
        : 0);
    totalOrphanSize += uploadOrphanSize + resultOrphanSize;
  }

  for (const folder of unlinkedResults) {
    totalSize += folder.totalSize;
    totalFiles += folder.files.length;
    totalOrphanFiles += folder.files.length;
    totalOrphanSize += folder.totalSize;
  }

  userBuckets.sort(
    (a, b) =>
      b.uploads.totalSize +
      b.results.totalSize -
      (a.uploads.totalSize + a.results.totalSize),
  );

  return json({
    users: userBuckets,
    unlinkedResults,
    summary: {
      totalSize,
      totalFiles,
      totalOrphanFiles,
      totalOrphanSize,
    },
  });
}

export interface OssCleanupInput {
  keys?: unknown;
}

export async function ossCleanupHandler(
  ctx: RuntimeContext,
  body: OssCleanupInput,
): Promise<HandlerResponse> {
  if (!ctx.user) return unauthorized();
  const { keys } = body;
  if (!Array.isArray(keys) || keys.length === 0) {
    return badRequest("keys must be a non-empty array");
  }
  if (keys.length > 5000) {
    return badRequest("Too many keys (max 5000 per request)");
  }
  const confirmedOrphans: string[] = [];
  const skipped: unknown[] = [];
  for (const key of keys) {
    if (typeof key !== "string" || !key) {
      skipped.push(key);
      continue;
    }
    if (key.startsWith("uploads/")) {
      const parts = key.split("/");
      if (parts.length < 4) {
        skipped.push(key);
        continue;
      }
      const recordingId = parts[2]!;
      if (recordingsRepo.findById(recordingId)) skipped.push(key);
      else confirmedOrphans.push(key);
    } else if (key.startsWith("results/")) {
      const parts = key.split("/");
      if (parts.length < 3) {
        skipped.push(key);
        continue;
      }
      const jobId = parts[1]!;
      if (jobsRepo.findById(jobId)) skipped.push(key);
      else confirmedOrphans.push(key);
    } else {
      skipped.push(key);
    }
  }

  let deleted = 0;
  if (confirmedOrphans.length > 0) {
    deleted = await deleteObjects(confirmedOrphans, undefined, ctx.env);
  }
  return json({
    deleted,
    requested: (keys as unknown[]).length,
    confirmed: confirmedOrphans.length,
    skipped: skipped.length,
  });
}
