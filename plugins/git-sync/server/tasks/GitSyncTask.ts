import { Minute, Second } from "@shared/utils/time";
import Logger from "@server/logging/Logger";
import { CollectionGitSync } from "@server/models";
import { BaseTask, TaskPriority } from "@server/queues/tasks/base/BaseTask";
import { MutexLock } from "@server/utils/MutexLock";
import { GitSyncer } from "../GitSyncer";
import env from "../env";

interface Props {
  /** The ID of the collection git sync to run. */
  syncId: string;
}

/**
 * Runs the synchronization of a collection with its Git repository. Bidirectional
 * syncs schedule their next poll of the repository when they finish.
 */
export default class GitSyncTask extends BaseTask<Props> {
  /**
   * Schedules a run of a sync after a delay. Requests within the same time
   * window are merged into a single run.
   *
   * @param syncId The ID of the sync.
   * @param delay The delay in milliseconds before the run starts.
   * @returns A promise that resolves once the run is scheduled.
   */
  public static async scheduleRun(syncId: string, delay = 0) {
    const window = Math.max(env.GIT_SYNC_DEBOUNCE, 5) * Second.ms;
    const bucket = Math.ceil((Date.now() + delay) / window);
    const runAt = bucket * window;

    await new GitSyncTask().scheduleOptional(
      { syncId },
      {
        jobId: `GitSyncTask-${syncId}-${bucket}`,
        delay: Math.max(runAt - Date.now(), 0),
      }
    );
  }

  public async perform({ syncId }: Props) {
    const sync = await CollectionGitSync.findByPk(syncId);
    if (!sync || !sync.enabled) {
      return;
    }

    const ran = await MutexLock.tryUsing(
      `git-sync:${syncId}`,
      2 * Minute.ms,
      async () => {
        await GitSyncer.perform(sync);
        return true;
      }
    );

    if (!ran) {
      Logger.debug("task", "Git sync is already running, trying again later", {
        syncId,
      });
      await GitSyncTask.scheduleRun(syncId, env.GIT_SYNC_DEBOUNCE * Second.ms);
      return;
    }

    if (sync.isBidirectional) {
      await GitSyncTask.scheduleRun(
        syncId,
        env.GIT_SYNC_POLL_INTERVAL * Second.ms
      );
    }
  }

  public async onFailed({ syncId }: Props) {
    // Keep polling after a failure, the repository may be reachable again.
    const sync = await CollectionGitSync.findByPk(syncId);
    if (sync?.enabled && sync.isBidirectional) {
      await GitSyncTask.scheduleRun(
        syncId,
        env.GIT_SYNC_POLL_INTERVAL * Second.ms
      );
    }
  }

  public get options() {
    return {
      priority: TaskPriority.Background,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: Minute.ms,
      },
    };
  }
}
