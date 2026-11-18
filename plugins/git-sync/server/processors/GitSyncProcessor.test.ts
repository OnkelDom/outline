import { CollectionGitSync } from "@server/models";
import { buildAdmin, buildCollection } from "@server/test/factories";
import type { Event } from "@server/types";
import GitSyncTask from "../tasks/GitSyncTask";
import GitSyncProcessor from "./GitSyncProcessor";

describe("GitSyncProcessor", () => {
  it("only queues events of synchronized collections", async () => {
    const admin = await buildAdmin();
    const synced = await buildCollection({ teamId: admin.teamId });
    const other = await buildCollection({ teamId: admin.teamId });
    const sync = await CollectionGitSync.create({
      repositoryUrl: "https://example.com/repo.git",
      collectionId: synced.id,
      teamId: admin.teamId,
      createdById: admin.id,
    });

    const event = (collectionId: string) =>
      ({
        name: "documents.publish",
        documentId: "00000000-0000-4000-8000-000000000000",
        collectionId,
        teamId: admin.teamId,
        actorId: admin.id,
        ip: null,
      }) as Event;

    expect(await GitSyncProcessor.shouldQueue(event(synced.id))).toBe(true);
    expect(await GitSyncProcessor.shouldQueue(event(other.id))).toBe(false);

    const spy = vi.spyOn(GitSyncTask, "scheduleRun").mockResolvedValue();
    await new GitSyncProcessor().perform(event(synced.id));
    expect(spy).toHaveBeenCalledWith(sync.id);

    await sync.update({ enabled: false });
    expect(await GitSyncProcessor.shouldQueue(event(synced.id))).toBe(false);
    spy.mockRestore();
  });

  it("reads both collections of a move", () => {
    expect(
      GitSyncProcessor.collectionIds({
        name: "documents.move",
        documentId: "x",
        collectionId: "a",
        data: { collectionIds: ["a", "b"], documentIds: ["x"] },
      } as unknown as Event)
    ).toEqual(["a", "b"]);
  });
});
