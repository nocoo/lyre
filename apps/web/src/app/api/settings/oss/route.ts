/**
 * OSS storage audit API.
 *
 * GET /api/settings/oss — Scan all objects in OSS, cross-reference with DB,
 * and return structured per-user breakdown with orphan detection.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/api-auth";
import { listObjects, type OssObject } from "@/services/oss";
import {
  usersRepo,
  recordingsRepo,
  jobsRepo,
} from "@/db/repositories";

export const dynamic = "force-dynamic";

// ── Types ──

interface FileInfo {
  key: string;
  size: number;
  lastModified: string;
  /** Whether a matching DB record exists */
  hasDbRecord: boolean;
}

interface TaskFolder {
  /** The recordingId (for uploads) or jobId (for results) */
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
  /** Results linked to this user (resolved via job → recording → userId) */
  results: {
    folders: TaskFolder[];
    totalSize: number;
    totalFiles: number;
    orphanFolders: number;
    orphanSize: number;
  };
}

interface OssScanResult {
  users: UserBucket[];
  /** Results folders that cannot be resolved to any user */
  unlinkedResults: TaskFolder[];
  summary: {
    totalSize: number;
    totalFiles: number;
    totalOrphanFiles: number;
    totalOrphanSize: number;
  };
}

// ── Helpers ──

function groupByPrefix(
  objects: OssObject[],
  depth: number,
): Map<string, OssObject[]> {
  const groups = new Map<string, OssObject[]>();
  for (const obj of objects) {
    const parts = obj.key.split("/");
    if (parts.length <= depth) continue; // skip malformed keys
    const prefix = parts.slice(0, depth).join("/");
    const group = groups.get(prefix) ?? [];
    group.push(obj);
    groups.set(prefix, group);
  }
  return groups;
}

// ── Handler ──

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch all OSS objects (both prefixes in parallel)
  const [uploadObjects, resultObjects] = await Promise.all([
    listObjects("uploads/"),
    listObjects("results/"),
  ]);

  // Load all users for display names
  const allUsers = usersRepo.findAll();
  const userMap = new Map(allUsers.map((u) => [u.id, u]));

  // Build a set of known recording IDs and a map of jobId → userId
  const jobUserMap = new Map<string, string>();
  const recordingIdSet = new Set<string>();

  // Pre-load all recordings grouped by user
  for (const u of allUsers) {
    const recs = recordingsRepo.findAll(u.id);
    for (const rec of recs) {
      recordingIdSet.add(rec.id);
      // Also load jobs for this recording to map jobId → userId
      const jobs = jobsRepo.findByRecordingId(rec.id);
      for (const job of jobs) {
        jobUserMap.set(job.id, u.id);
      }
    }
  }

  // ── Process uploads: uploads/{userId}/{recordingId}/... ──
  // Group by userId
  const uploadsByUser = new Map<string, OssObject[]>();
  for (const obj of uploadObjects) {
    const parts = obj.key.split("/");
    // uploads/{userId}/{recordingId}/{file}
    if (parts.length < 4) continue;
    const userId = parts[1]!;
    const list = uploadsByUser.get(userId) ?? [];
    list.push(obj);
    uploadsByUser.set(userId, list);
  }

  // ── Process results: results/{jobId}/... ──
  // Group by jobId first, then resolve to userId
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

  // ── Build per-user buckets ──
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

    // Build upload folders for this user
    const userUploads = uploadsByUser.get(userId) ?? [];
    const uploadFolderMap = groupByPrefix(
      userUploads.map((o) => ({
        ...o,
        // Strip the "uploads/{userId}/" prefix for grouping by recordingId
        key: o.key,
      })),
      3, // uploads/{userId}/{recordingId}
    );

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

    // Results for this user
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
    totalOrphanFiles += (uploadOrphanFolders > 0 ? uploadFolders.filter((f) => !f.hasDbRecord).reduce((n, f) => n + f.files.length, 0) : 0)
      + (resultOrphanFolders > 0 ? userResults.filter((f) => !f.hasDbRecord).reduce((n, f) => n + f.files.length, 0) : 0);
    totalOrphanSize += uploadOrphanSize + resultOrphanSize;
  }

  // Account for unlinked results in totals
  for (const folder of unlinkedResults) {
    totalSize += folder.totalSize;
    totalFiles += folder.files.length;
    totalOrphanFiles += folder.files.length;
    totalOrphanSize += folder.totalSize;
  }

  // Sort user buckets by total size descending
  userBuckets.sort(
    (a, b) =>
      b.uploads.totalSize +
      b.results.totalSize -
      (a.uploads.totalSize + a.results.totalSize),
  );

  const result: OssScanResult = {
    users: userBuckets,
    unlinkedResults,
    summary: {
      totalSize,
      totalFiles,
      totalOrphanFiles,
      totalOrphanSize,
    },
  };

  return NextResponse.json(result);
}
