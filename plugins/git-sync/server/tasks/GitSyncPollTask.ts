import { CollectionGitSync } from "@server/models";
import { TaskPriority } from "@server/queues/tasks/base/BaseTask";
import {
  CronTask,
  TaskInterval,
  type Props,
} from "@server/queues/tasks/base/CronTask";
import GitSyncTask from "./GitSyncTask";

/**
 * Schedules a run of every enabled Git sync once an hour. Runs keep polling on
 * their own, this restarts them after an outage and catches missed changes.
 */
export default class GitSyncPollTask extends CronTask {
  public async perform({ partition }: Props) {
    await CollectionGitSync.findAllInBatches<CollectionGitSync>(
      {
        attributes: ["id"],
        where: {
          enabled: true,
          ...this.getPartitionWhereClause("id", partition),
        },
        order: [["id", "ASC"]],
        batchLimit: 100,
      },
      async (syncs) => {
        for (const sync of syncs) {
          await GitSyncTask.scheduleRun(sync.id);
        }
      }
    );
  }

  public get cron() {
    return {
      interval: TaskInterval.Hour,
    };
  }

  public get options() {
    return {
      attempts: 1,
      priority: TaskPriority.Background,
    };
  }
}
