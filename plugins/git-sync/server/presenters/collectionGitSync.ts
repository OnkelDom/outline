import type { CollectionGitSync } from "@server/models";

/**
 * Presents a collection git sync for the API. The access token is never
 * returned, only whether one is set.
 *
 * @param sync The sync to present.
 * @returns The presented sync.
 */
export default function presentCollectionGitSync(sync: CollectionGitSync) {
  return {
    id: sync.id,
    collectionId: sync.collectionId,
    repositoryUrl: sync.repositoryUrl,
    branch: sync.branch,
    path: sync.path,
    username: sync.username,
    hasToken: !!sync.token,
    direction: sync.direction,
    authorName: sync.authorName,
    authorEmail: sync.authorEmail,
    enabled: sync.enabled,
    status: sync.status,
    lastError: sync.lastError,
    lastResult: sync.lastResult,
    lastCommitSha: sync.lastCommitSha,
    lastSyncedAt: sync.lastSyncedAt,
    createdById: sync.createdById,
    createdAt: sync.createdAt,
    updatedAt: sync.updatedAt,
  };
}
