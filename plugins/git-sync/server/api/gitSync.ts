import crypto from "node:crypto";
import Router from "@koa/router";
import { Minute } from "@shared/utils/time";
import { UserRole } from "@shared/types";
import env from "@server/env";
import { NotFoundError, ValidationError } from "@server/errors";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import { Collection, CollectionGitSync, type User } from "@server/models";
import { authorize } from "@server/policies";
import type { APIContext } from "@server/types";
import { AuthenticationType } from "@server/types";
import { MutexLock } from "@server/utils/MutexLock";
import { GitRepository } from "../GitRepository";
import { GitSyncer } from "../GitSyncer";
import presentCollectionGitSync from "../presenters/collectionGitSync";
import GitSyncTask from "../tasks/GitSyncTask";
import * as T from "./schema";

const router = new Router();

const authentication = auth({
  role: UserRole.Admin,
  type: [AuthenticationType.API, AuthenticationType.APP],
});

/**
 * Loads a sync of the user's team and checks that the user may manage the
 * collection it belongs to.
 *
 * @param user The acting user.
 * @param id The ID of the sync.
 * @returns The sync.
 */
async function loadSync(user: User, id: string) {
  const sync = await CollectionGitSync.findOne({
    where: { id, teamId: user.teamId },
  });
  if (!sync) {
    throw NotFoundError("Git sync not found");
  }
  const collection = await Collection.findByPk(sync.collectionId, {
    userId: user.id,
  });
  authorize(user, "update", collection);
  return sync;
}

/**
 * Presents a sync together with the URL that triggers it from a Git host.
 *
 * @param sync The sync.
 * @returns The presented sync.
 */
function present(sync: CollectionGitSync) {
  return {
    ...presentCollectionGitSync(sync),
    webhookUrl: `${env.URL}/api/gitSync.webhook?id=${sync.id}&secret=${sync.webhookSecret}`,
  };
}

/**
 * Runs a routine with exclusive access to the working copy of a sync.
 *
 * @param sync The sync.
 * @param routine The routine.
 * @returns The result of the routine.
 */
function withLock<T>(sync: CollectionGitSync, routine: () => Promise<T>) {
  return MutexLock.using(`git-sync:${sync.id}`, 2 * Minute.ms, routine);
}

/**
 * Opens the working copy of a sync and fetches the remote.
 *
 * @param sync The sync.
 * @returns The repository.
 */
async function openRepository(sync: CollectionGitSync) {
  const repo = await GitRepository.open(sync.id, {
    url: sync.repositoryUrl,
    branch: sync.branch,
    username: sync.username,
    token: sync.token,
  });
  await repo.reset();
  return repo;
}

async function validateSettings(settings: {
  repositoryUrl?: string;
  branch?: string;
  path?: string;
}) {
  if (settings.repositoryUrl !== undefined) {
    GitRepository.assertValidUrl(settings.repositoryUrl);
  }
  if (settings.branch !== undefined) {
    await GitRepository.assertValidRefName(settings.branch, "branch");
  }
  if (settings.path !== undefined) {
    try {
      return GitSyncer.normalizeFolder(settings.path);
    } catch (err) {
      throw ValidationError(
        err instanceof Error ? err.message : "Invalid folder"
      );
    }
  }
  return undefined;
}

router.post(
  "gitSync.list",
  authentication,
  validate(T.GitSyncListSchema),
  async (ctx: APIContext<T.GitSyncListReq>) => {
    const { user } = ctx.state.auth;
    const syncs = await CollectionGitSync.findAll({
      where: { teamId: user.teamId },
      order: [["createdAt", "ASC"]],
    });

    ctx.body = {
      data: syncs.map(present),
    };
  }
);

router.post(
  "gitSync.info",
  authentication,
  validate(T.GitSyncInfoSchema),
  async (ctx: APIContext<T.GitSyncInfoReq>) => {
    const { collectionId } = ctx.input.body;
    const { user } = ctx.state.auth;

    const collection = await Collection.findByPk(collectionId, {
      userId: user.id,
    });
    authorize(user, "update", collection);

    const sync = await CollectionGitSync.findOne({
      where: { collectionId, teamId: user.teamId },
    });

    ctx.body = {
      data: sync ? present(sync) : null,
    };
  }
);

router.post(
  "gitSync.create",
  authentication,
  validate(T.GitSyncCreateSchema),
  async (ctx: APIContext<T.GitSyncCreateReq>) => {
    const { collectionId, accessToken, ...settings } = ctx.input.body;
    const { user } = ctx.state.auth;

    const collection = await Collection.findByPk(collectionId, {
      userId: user.id,
    });
    authorize(user, "update", collection);

    const path = await validateSettings(settings);
    const existing = await CollectionGitSync.count({
      where: { collectionId },
    });
    if (existing) {
      throw ValidationError("This collection is already connected to Git");
    }

    const sync = await CollectionGitSync.create({
      ...settings,
      path: path ?? "",
      enabled: settings.enabled ?? true,
      token: accessToken?.trim() || null,
      collectionId,
      teamId: user.teamId,
      createdById: user.id,
    });

    if (sync.enabled) {
      await GitSyncTask.scheduleRun(sync.id);
    }

    ctx.body = {
      data: present(sync),
    };
  }
);

router.post(
  "gitSync.update",
  authentication,
  validate(T.GitSyncUpdateSchema),
  async (ctx: APIContext<T.GitSyncUpdateReq>) => {
    const { id, accessToken, ...settings } = ctx.input.body;
    const { user } = ctx.state.auth;
    const sync = await loadSync(user, id);

    const path = await validateSettings(settings);
    const remoteChanged =
      (settings.repositoryUrl !== undefined &&
        settings.repositoryUrl !== sync.repositoryUrl) ||
      (settings.branch !== undefined && settings.branch !== sync.branch) ||
      (path !== undefined && path !== sync.path);

    sync.set({
      ...Object.fromEntries(
        Object.entries(settings).filter(([, value]) => value !== undefined)
      ),
      ...(path !== undefined ? { path } : {}),
      ...(accessToken !== undefined
        ? { token: accessToken?.trim() || null }
        : {}),
      // A new remote or folder has no shared history with the old one.
      ...(remoteChanged ? { lastCommitSha: null, lastSyncedAt: null } : {}),
      // Take over the sync, the documents are now changed as this user.
      createdById: user.id,
    });
    await sync.save();

    if (remoteChanged) {
      await GitRepository.remove(sync.id);
    }
    if (sync.enabled) {
      await GitSyncTask.scheduleRun(sync.id);
    }

    ctx.body = {
      data: present(sync),
    };
  }
);

router.post(
  "gitSync.delete",
  authentication,
  validate(T.GitSyncIdSchema),
  async (ctx: APIContext<T.GitSyncIdReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const sync = await loadSync(user, id);

    await sync.destroy();
    await GitRepository.remove(sync.id);

    ctx.body = {
      success: true,
    };
  }
);

router.post(
  "gitSync.run",
  authentication,
  validate(T.GitSyncIdSchema),
  async (ctx: APIContext<T.GitSyncIdReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const sync = await loadSync(user, id);

    if (!sync.enabled) {
      throw ValidationError("The sync is paused");
    }

    const result = await withLock(sync, () => GitSyncer.perform(sync));

    ctx.body = {
      data: present(sync),
      result,
    };
  }
);

router.post(
  "gitSync.tags.list",
  authentication,
  validate(T.GitSyncIdSchema),
  async (ctx: APIContext<T.GitSyncIdReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const sync = await loadSync(user, id);

    const tags = await withLock(sync, async () => {
      const repo = await openRepository(sync);
      return repo.listTags();
    });

    ctx.body = {
      data: tags,
    };
  }
);

router.post(
  "gitSync.tags.create",
  authentication,
  validate(T.GitSyncTagsCreateSchema),
  async (ctx: APIContext<T.GitSyncTagsCreateReq>) => {
    const { id, name, message } = ctx.input.body;
    const { user } = ctx.state.auth;
    const sync = await loadSync(user, id);
    await GitRepository.assertValidRefName(name, "tag");

    const tags = await withLock(sync, async () => {
      // Sync first, so that the tag includes the latest state of the collection.
      if (sync.enabled) {
        await GitSyncer.perform(sync);
      }
      const repo = await openRepository(sync);
      if (!repo.remoteHead) {
        throw ValidationError("The branch has no commits to tag yet");
      }
      const existing = await repo.listTags();
      if (existing.some((tag) => tag.name === name)) {
        throw ValidationError(`The tag "${name}" already exists`);
      }
      await repo.createTag(name, message.trim(), {
        name: user.name,
        email: user.email ?? sync.authorEmail ?? "outline@localhost",
      });
      return repo.listTags();
    });

    ctx.body = {
      data: tags,
    };
  }
);

router.post(
  "gitSync.tags.delete",
  authentication,
  validate(T.GitSyncTagsDeleteSchema),
  async (ctx: APIContext<T.GitSyncTagsDeleteReq>) => {
    const { id, name } = ctx.input.body;
    const { user } = ctx.state.auth;
    const sync = await loadSync(user, id);
    await GitRepository.assertValidRefName(name, "tag");

    const tags = await withLock(sync, async () => {
      const repo = await openRepository(sync);
      await repo.deleteTag(name);
      return repo.listTags();
    });

    ctx.body = {
      data: tags,
    };
  }
);

/**
 * Called by a Git host, such as GitHub, GitLab or Gitea, after a push so that
 * changes are imported right away instead of at the next poll. The secret is
 * passed as query parameter, or in the X-Gitlab-Token header.
 */
router.post("gitSync.webhook", async (ctx: APIContext) => {
  const id = String(ctx.request.query.id ?? "");
  const header = ctx.request.headers["x-gitlab-token"];
  const secret = String(
    ctx.request.query.secret ??
      (Array.isArray(header) ? header[0] : header) ??
      ""
  );

  const sync = /^[0-9a-f-]{36}$/i.test(id)
    ? await CollectionGitSync.findByPk(id)
    : null;

  const expected = Buffer.from(sync?.webhookSecret ?? "");
  const actual = Buffer.from(secret);
  if (
    !sync ||
    expected.length === 0 ||
    expected.length !== actual.length ||
    !crypto.timingSafeEqual(expected, actual)
  ) {
    throw NotFoundError("Git sync not found");
  }

  if (sync.enabled) {
    await GitSyncTask.scheduleRun(sync.id);
  }

  ctx.status = 202;
  ctx.body = { success: true };
});

export default router;
