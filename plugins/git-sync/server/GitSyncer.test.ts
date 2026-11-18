import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import documentUpdater from "@server/commands/documentUpdater";
import { createContext } from "@server/context";
import { Collection, CollectionGitSync, Document } from "@server/models";
import type { User } from "@server/models";
import { GitSyncDirection } from "@server/models/CollectionGitSync";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { sequelize } from "@server/storage/database";
import {
  buildAdmin,
  buildCollection,
  buildDocument,
  buildTeam,
} from "@server/test/factories";
import { GitMarkdown } from "./GitMarkdown";
import { GitRepository } from "./GitRepository";
import { GitSyncer } from "./GitSyncer";
import env from "./env";

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Git User",
  GIT_AUTHOR_EMAIL: "git-user@example.com",
  GIT_COMMITTER_NAME: "Git User",
  GIT_COMMITTER_EMAIL: "git-user@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, env: gitEnv }).toString();
}

let tmp: string;

beforeAll(() => {
  env.GIT_SYNC_ALLOW_INSECURE_URLS = true;
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "git-sync-test-"));
  env.GIT_SYNC_CACHE_DIR = path.join(tmp, "cache");
});

afterEach(async () => {
  await fs.remove(tmp);
});

/**
 * Creates an empty bare repository and a collection connected to it.
 */
async function setup(
  options: { direction?: GitSyncDirection; folder?: string } = {}
) {
  const remote = path.join(tmp, "remote.git");
  await fs.ensureDir(remote);
  git(remote, "init", "--bare", "--quiet", "--initial-branch=main");

  const team = await buildTeam();
  const user = await buildAdmin({ teamId: team.id });
  const collection = await buildCollection({
    teamId: team.id,
    userId: user.id,
    name: "Handbook",
  });
  const sync = await CollectionGitSync.create({
    repositoryUrl: `file://${remote}`,
    branch: "main",
    path: options.folder ?? "",
    direction: options.direction ?? GitSyncDirection.Bidirectional,
    collectionId: collection.id,
    teamId: team.id,
    createdById: user.id,
  });

  return { remote, team, user, collection, sync };
}

async function addDocument(
  collection: Collection,
  user: User,
  overrides: Partial<Document> = {}
) {
  const document = await buildDocument({
    teamId: collection.teamId,
    userId: user.id,
    collectionId: collection.id,
    ...overrides,
  });
  const fresh = await Collection.findByPk(collection.id, {
    includeDocumentStructure: true,
    rejectOnEmpty: true,
  });
  await fresh.addDocumentToStructure(document);
  return document;
}

/** Clones the remote into a new folder, as a user working in Git would. */
function clone(remote: string) {
  const dir = path.join(tmp, `clone-${Math.random().toString(36).slice(2)}`);
  execFileSync("git", ["clone", "--quiet", remote, dir], { env: gitEnv });
  return dir;
}

function commitAndPush(dir: string, message: string) {
  git(dir, "add", "--all");
  git(dir, "commit", "--quiet", "-m", message);
  git(dir, "push", "--quiet", "origin", "HEAD:main");
}

async function updateText(document: Document, user: User, text: string) {
  await sequelize.transaction(async (transaction) => {
    const doc = await Document.findByPk(document.id, {
      includeState: true,
      transaction,
      rejectOnEmpty: true,
    });
    await documentUpdater(createContext({ user, transaction }), {
      document: doc,
      text,
    });
  });
}

describe("GitSyncer", () => {
  describe("layout", () => {
    it("nests child documents and deduplicates titles", () => {
      const layout = GitSyncer.layout(
        [
          {
            id: "1",
            title: "Guide",
            url: "/doc/guide-1",
            children: [
              { id: "2", title: "Setup", url: "/doc/setup-2", children: [] },
            ],
          },
          { id: "3", title: "Guide", url: "/doc/guide-3", children: [] },
          { id: "4", title: "A/B", url: "/doc/ab-4", children: [] },
        ],
        "docs"
      );

      expect(layout.files.get("1")).toEqual("docs/Guide.md");
      expect(layout.files.get("2")).toEqual("docs/Guide/Setup.md");
      expect(layout.files.get("3")).toEqual("docs/Guide (1).md");
      expect(layout.files.get("4")).toEqual("docs/A%2FB.md");
      expect(layout.folders.get("docs/Guide")).toEqual("1");
    });

    it("normalizes folders", () => {
      expect(GitSyncer.normalizeFolder("/docs/wiki/")).toEqual("docs/wiki");
      expect(GitSyncer.normalizeFolder("")).toEqual("");
      expect(GitSyncer.normalizeFolder("./")).toEqual("");
      expect(() => GitSyncer.normalizeFolder("../etc")).toThrow();
    });
  });

  it("exports documents to an empty repository", async () => {
    const { remote, collection, user, sync } = await setup({ folder: "wiki" });
    const parent = await addDocument(collection, user, {
      title: "Guide",
      text: "Parent text",
    });
    await addDocument(collection, user, {
      title: "Setup",
      text: "Child text",
      parentDocumentId: parent.id,
    });

    const result = await GitSyncer.perform(sync);
    expect(result.exported).toEqual(2);
    expect(result.commitSha).toBeTruthy();

    const dir = clone(remote);
    const parentFile = await fs.readFile(
      path.join(dir, "wiki", "Guide.md"),
      "utf8"
    );
    const childFile = await fs.readFile(
      path.join(dir, "wiki", "Guide", "Setup.md"),
      "utf8"
    );
    expect(GitMarkdown.parse(parentFile).frontmatter.id).toEqual(parent.id);
    expect(GitMarkdown.parse(parentFile).body).toEqual("Parent text");
    expect(GitMarkdown.parse(childFile).frontmatter.parent).toEqual(parent.id);
    expect(GitMarkdown.parse(childFile).frontmatter.collection).toEqual(
      "Handbook"
    );
    expect(git(dir, "log", "-1", "--format=%an")).toContain("Outline");

    await sync.reload();
    expect(sync.status).toEqual("success");
    expect(sync.lastCommitSha).toEqual(result.commitSha);
    expect(sync.lastSyncedAt).toBeTruthy();

    // A second run without changes does not create a commit.
    const second = await GitSyncer.perform(sync);
    expect(second.commitSha).toBeNull();
    expect(second.exported).toEqual(0);
  });

  it("imports changes, new files and deletions made in Git", async () => {
    const { remote, collection, user, sync } = await setup();
    const doc = await addDocument(collection, user, {
      title: "Guide",
      text: "Original",
    });
    const removed = await addDocument(collection, user, {
      title: "Obsolete",
      text: "Remove me",
    });
    await GitSyncer.perform(sync);

    const dir = clone(remote);
    const guidePath = path.join(dir, "Guide.md");
    const parsed = GitMarkdown.parse(await fs.readFile(guidePath, "utf8"));
    await fs.writeFile(
      guidePath,
      GitMarkdown.serialize(
        { ...parsed.frontmatter, tags: ["release"] },
        "Guide renamed",
        "Edited **in Git**"
      )
    );
    await fs.ensureDir(path.join(dir, "Guide"));
    await fs.writeFile(
      path.join(dir, "Guide", "new-page.md"),
      "# New page\n\nWritten in Git"
    );
    await fs.remove(path.join(dir, "Obsolete.md"));
    commitAndPush(dir, "Edit in Git");

    const result = await GitSyncer.perform(sync);
    expect(result.updated).toEqual(1);
    expect(result.created).toEqual(1);
    expect(result.deleted).toEqual(1);
    expect(result.conflicts).toEqual([]);

    const updated = await Document.findByPk(doc.id, { rejectOnEmpty: true });
    expect(updated.title).toEqual("Guide renamed");
    expect(
      await DocumentHelper.toMarkdown(updated, { includeTitle: false })
    ).toEqual("Edited **in Git**");

    const created = await Document.findOne({
      where: { collectionId: collection.id, title: "New page" },
    });
    expect(created).toBeTruthy();
    expect(created?.parentDocumentId).toEqual(doc.id);
    expect(created?.publishedAt).toBeTruthy();

    const trashed = await Document.findByPk(removed.id, { paranoid: false });
    expect(trashed?.deletedAt).toBeTruthy();

    // The export writes the new state back, including a frontmatter for the
    // new document under its title, and keeps the tags added in Git.
    git(dir, "pull", "--quiet", "origin", "main");
    expect(await fs.pathExists(path.join(dir, "Guide", "new-page.md"))).toBe(
      false
    );
    expect(await fs.pathExists(path.join(dir, "Guide.md"))).toBe(false);
    const renamed = GitMarkdown.parse(
      await fs.readFile(path.join(dir, "Guide renamed.md"), "utf8")
    );
    expect(renamed.frontmatter.tags).toEqual(["release"]);
    const newFile = GitMarkdown.parse(
      await fs.readFile(path.join(dir, "Guide renamed", "New page.md"), "utf8")
    );
    expect(newFile.frontmatter.id).toEqual(created?.id);
  });

  it("attributes changes to the Outline user with the commit email", async () => {
    const { remote, collection, user, sync, team } = await setup();
    const editor = await buildAdmin({
      teamId: team.id,
      email: "git-user@example.com",
    });
    const doc = await addDocument(collection, user, { title: "Guide" });
    await GitSyncer.perform(sync);

    const dir = clone(remote);
    const parsed = GitMarkdown.parse(
      await fs.readFile(path.join(dir, "Guide.md"), "utf8")
    );
    await fs.writeFile(
      path.join(dir, "Guide.md"),
      GitMarkdown.serialize(parsed.frontmatter, "Guide", "By editor")
    );
    commitAndPush(dir, "Edit");

    await GitSyncer.perform(sync);
    const updated = await Document.findByPk(doc.id, { rejectOnEmpty: true });
    expect(updated.lastModifiedById).toEqual(editor.id);
  });

  it("keeps the Outline version when both sides changed", async () => {
    const { remote, collection, user, sync } = await setup();
    const doc = await addDocument(collection, user, {
      title: "Guide",
      text: "Original",
    });
    await GitSyncer.perform(sync);

    const dir = clone(remote);
    const parsed = GitMarkdown.parse(
      await fs.readFile(path.join(dir, "Guide.md"), "utf8")
    );
    await fs.writeFile(
      path.join(dir, "Guide.md"),
      GitMarkdown.serialize(parsed.frontmatter, "Guide", "Changed in Git")
    );
    commitAndPush(dir, "Edit in Git");

    await new Promise((resolve) => setTimeout(resolve, 10));
    await updateText(doc, user, "Changed in Outline");

    const result = await GitSyncer.perform(sync);
    expect(result.conflicts).toEqual(["Guide"]);
    expect(result.updated).toEqual(0);

    const reloaded = await Document.findByPk(doc.id, { rejectOnEmpty: true });
    expect(
      await DocumentHelper.toMarkdown(reloaded, { includeTitle: false })
    ).toEqual("Changed in Outline");

    git(dir, "pull", "--quiet", "origin", "main");
    expect(
      GitMarkdown.parse(await fs.readFile(path.join(dir, "Guide.md"), "utf8"))
        .body
    ).toEqual("Changed in Outline");
    expect(git(dir, "log", "--format=%s")).toContain("Edit in Git");
  });

  it("removes files of documents deleted in Outline", async () => {
    const { remote, collection, user, sync } = await setup();
    const doc = await addDocument(collection, user, { title: "Guide" });
    await addDocument(collection, user, { title: "Other" });
    await GitSyncer.perform(sync);

    const dir = clone(remote);
    await fs.writeFile(path.join(dir, "README.md"), "Not managed by Outline");
    commitAndPush(dir, "Add readme");

    await sequelize.transaction(async (transaction) => {
      const locked = await Document.findByPk(doc.id, {
        transaction,
        rejectOnEmpty: true,
      });
      await locked.destroyWithCtx(createContext({ user, transaction }));
    });

    const result = await GitSyncer.perform(sync);
    expect(result.removed).toEqual(1);

    git(dir, "pull", "--quiet", "origin", "main");
    expect(await fs.pathExists(path.join(dir, "Guide.md"))).toBe(false);
    expect(await fs.pathExists(path.join(dir, "Other.md"))).toBe(true);

    // The README has no Outline frontmatter, it was imported as a document
    // and is now managed by Outline.
    const readme = await Document.findOne({
      where: { collectionId: collection.id, title: "README" },
    });
    expect(readme).toBeTruthy();
  });

  it("does not import changes when pushing only", async () => {
    const { remote, collection, user, sync } = await setup({
      direction: GitSyncDirection.Push,
    });
    const doc = await addDocument(collection, user, {
      title: "Guide",
      text: "Original",
    });
    await GitSyncer.perform(sync);

    const dir = clone(remote);
    const parsed = GitMarkdown.parse(
      await fs.readFile(path.join(dir, "Guide.md"), "utf8")
    );
    await fs.writeFile(
      path.join(dir, "Guide.md"),
      GitMarkdown.serialize(parsed.frontmatter, "Guide", "Changed in Git")
    );
    await fs.writeFile(path.join(dir, "Unrelated.md"), "Keep me");
    commitAndPush(dir, "Edit in Git");

    const result = await GitSyncer.perform(sync);
    expect(result.updated).toEqual(0);
    expect(result.created).toEqual(0);

    const reloaded = await Document.findByPk(doc.id, { rejectOnEmpty: true });
    expect(
      await DocumentHelper.toMarkdown(reloaded, { includeTitle: false })
    ).toEqual("Original");

    git(dir, "pull", "--quiet", "origin", "main");
    expect(
      GitMarkdown.parse(await fs.readFile(path.join(dir, "Guide.md"), "utf8"))
        .body
    ).toEqual("Original");
    expect(await fs.readFile(path.join(dir, "Unrelated.md"), "utf8")).toEqual(
      "Keep me"
    );
  });

  it("imports existing files on the first sync", async () => {
    const { remote, collection, sync } = await setup();
    const seed = path.join(tmp, "seed");
    execFileSync("git", ["init", "--quiet", "--initial-branch=main", seed], {
      env: gitEnv,
    });
    git(seed, "remote", "add", "origin", remote);
    await fs.writeFile(path.join(seed, "Existing.md"), "# Existing\n\nHello");
    commitAndPush(seed, "Initial");

    const result = await GitSyncer.perform(sync);
    expect(result.created).toEqual(1);

    const created = await Document.findOne({
      where: { collectionId: collection.id, title: "Existing" },
    });
    expect(created).toBeTruthy();
  });

  it("records errors on the sync", async () => {
    const { sync } = await setup();
    sync.repositoryUrl = `file://${path.join(tmp, "missing.git")}`;
    await sync.save();

    await expect(GitSyncer.perform(sync)).rejects.toThrow();
    await sync.reload();
    expect(sync.status).toEqual("error");
    expect(sync.lastError).toContain("git");
  });
});

describe("GitRepository", () => {
  it("creates, lists and deletes tags", async () => {
    const { remote, collection, user, sync } = await setup();
    await addDocument(collection, user, { title: "Guide" });
    await GitSyncer.perform(sync);

    const repo = await GitRepository.open(sync.id, {
      url: sync.repositoryUrl,
      branch: "main",
    });
    await repo.reset();
    await repo.createTag("v1.0.0", "First release", {
      name: "Tagger",
      email: "tagger@example.com",
    });

    const tags = await repo.listTags();
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toEqual("v1.0.0");
    expect(tags[0].message).toEqual("First release");
    expect(tags[0].commitSha).toEqual(sync.lastCommitSha);
    expect(tags[0].author).toEqual("Tagger");

    // Tags created in Git show up too.
    const dir = clone(remote);
    git(dir, "tag", "v2.0.0");
    git(dir, "push", "--quiet", "origin", "v2.0.0");
    await repo.reset();
    expect((await repo.listTags()).map((tag) => tag.name).sort()).toEqual([
      "v1.0.0",
      "v2.0.0",
    ]);

    await repo.deleteTag("v1.0.0");
    expect(git(dir, "ls-remote", "--tags", "origin")).not.toContain("v1.0.0");
  });

  it("validates URLs and reference names", async () => {
    env.GIT_SYNC_ALLOW_INSECURE_URLS = false;
    try {
      expect(() =>
        GitRepository.assertValidUrl("https://github.com/a/b.git")
      ).not.toThrow();
      expect(() => GitRepository.assertValidUrl("file:///etc")).toThrow();
      expect(() =>
        GitRepository.assertValidUrl("https://user:pass@github.com/a/b.git")
      ).toThrow();
      expect(() => GitRepository.assertValidUrl("not a url")).toThrow();
    } finally {
      env.GIT_SYNC_ALLOW_INSECURE_URLS = true;
    }

    await expect(
      GitRepository.assertValidRefName("v1.0.0", "tag")
    ).resolves.toBeUndefined();
    await expect(
      GitRepository.assertValidRefName("bad..name", "tag")
    ).rejects.toThrow();
    await expect(
      GitRepository.assertValidRefName("-x", "tag")
    ).rejects.toThrow();
  });
});
