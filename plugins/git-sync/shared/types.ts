/**
 * A collection git sync as returned by the API.
 */
export interface GitSyncData {
  id: string;
  collectionId: string;
  repositoryUrl: string;
  branch: string;
  path: string;
  username: string | null;
  hasToken: boolean;
  direction: "push" | "bidirectional";
  authorName: string | null;
  authorEmail: string | null;
  enabled: boolean;
  status: "pending" | "running" | "success" | "error";
  lastError: string | null;
  lastResult: {
    exported: number;
    removed: number;
    created: number;
    updated: number;
    deleted: number;
    conflicts: string[];
    commitSha?: string | null;
  } | null;
  lastCommitSha: string | null;
  lastSyncedAt: string | null;
  webhookUrl: string;
}

/**
 * A Git tag as returned by the API.
 */
export interface GitTagData {
  name: string;
  commitSha: string;
  message: string;
  author: string;
  createdAt: string | null;
}
