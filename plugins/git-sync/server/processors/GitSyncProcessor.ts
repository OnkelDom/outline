import { Op } from "sequelize";
import { CollectionGitSync } from "@server/models";
import BaseProcessor from "@server/queues/processors/BaseProcessor";
import type { Event } from "@server/types";
import GitSyncTask from "../tasks/GitSyncTask";

/**
 * Schedules a Git sync when documents in a synchronized collection change.
 */
export default class GitSyncProcessor extends BaseProcessor {
  static applicableEvents: Event["name"][] = [
    "documents.publish",
    "documents.unpublish",
    "documents.update.debounced",
    "documents.title_change",
    "documents.archive",
    "documents.unarchive",
    "documents.delete",
    "documents.restore",
    "documents.move",
    "collections.update",
  ];

  static shouldQueue = async (event: Event) => {
    const collectionIds = GitSyncProcessor.collectionIds(event);
    if (!collectionIds.length) {
      return false;
    }
    const count = await CollectionGitSync.count({
      where: { collectionId: { [Op.in]: collectionIds }, enabled: true },
    });
    return count > 0;
  };

  /**
   * Returns the collections an event affects.
   *
   * @param event The event.
   * @returns The IDs of the affected collections.
   */
  static collectionIds(event: Event): string[] {
    if (event.name === "documents.move") {
      return event.data.collectionIds;
    }
    if ("collectionId" in event && event.collectionId) {
      return [event.collectionId];
    }
    return [];
  }

  async perform(event: Event) {
    const collectionIds = GitSyncProcessor.collectionIds(event);
    if (!collectionIds.length) {
      return;
    }

    const syncs = await CollectionGitSync.findAll({
      attributes: ["id"],
      where: { collectionId: { [Op.in]: collectionIds }, enabled: true },
    });

    for (const sync of syncs) {
      await GitSyncTask.scheduleRun(sync.id);
    }
  }
}
