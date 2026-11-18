import path from "node:path";
import fs from "fs-extra";
import isUUID from "validator/lib/isUUID";
import type { NavigationNode } from "@shared/types";
import { errToString } from "@shared/utils/error";
import documentCreator from "@server/commands/documentCreator";
import documentUpdater from "@server/commands/documentUpdater";
import { createContext } from "@server/context";
import Logger from "@server/logging/Logger";
import { Collection, Document, Team, User } from "@server/models";
import type CollectionGitSync from "@server/models/CollectionGitSync";
import type { GitSyncResult } from "@server/models/CollectionGitSync";
import { GitSyncStatus } from "@server/models/CollectionGitSync";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { can } from "@server/policies";
import { sequelize } from "@server/storage/database";
import { serializeFilename } from "@server/utils/fs";
import { GitMarkdown, type GitFrontmatter } from "./GitMarkdown";
import {
  GitPushRejectedError,
  GitRepository,
  type GitFileChange,
} from "./GitRepository";

/**
 * Where each document of a collection lives in the repository.
 */
interface Layout {
  /** Document ID to file path, relative to the repository root. */
  files: Map<string, string>;
  /** Folder of a document's children, relative to the repository root, to its ID. */
  folders: Map<string, string>;
}

const maxPushAttempts = 3;

/**
 * Synchronizes one collection with its Git repository.
 *
 * A run fetches the remote branch, applies commits made in Git since the last
 * run to the collection (bidirectional syncs only), writes every published
 * document as a Markdown file, commits and pushes. When a document changed on
 * both sides since the last run, the Outline version is kept and the Git
 * version stays available in the history.
 */
export class GitSyncer {
  /**
   * Normalizes the folder of a sync to a relative POSIX path.
   *
   * @param folder The folder as entered by the user.
   * @returns The normalized folder, empty for the repository root.
   */
  public static normalizeFolder(folder: string | null | undefined): string {
    const normalized = path.posix
      .normalize((folder ?? "").replace(/\\/g, "/"))
      .replace(/^\/+|\/+$/g, "");
    if (normalized === "." || normalized === "") {
      return "";
    }
    if (normalized.split("/").includes("..")) {
      throw new Error("The folder must be inside the repository");
    }
    return normalized;
  }

  /**
   * Builds the repository layout of a collection: one file per document named
   * after its title, with nested documents in a folder of the same name.
   *
   * @param nodes The document structure of the collection.
   * @param folder The folder of the sync in the repository.
   * @returns The layout.
   */
  public static layout(nodes: NavigationNode[], folder: string): Layout {
    const layout: Layout = { files: new Map(), folders: new Map() };
    const used = new Set<string>();

    const walk = (children: NavigationNode[], dir: string) => {
      for (const node of children) {
        const title = serializeFilename(node.title) || "Untitled";
        let name = title;
        let i = 0;
        while (used.has(path.posix.join(dir, `${name}.md`).toLowerCase())) {
          name = `${title} (${++i})`;
        }
        const filePath = path.posix.join(dir, `${name}.md`);
        used.add(filePath.toLowerCase());
        layout.files.set(node.id, filePath);

        const childDir = path.posix.join(dir, name);
        layout.folders.set(childDir, node.id);
        if (node.children?.length) {
          walk(node.children, childDir);
        }
      }
    };

    walk(nodes, folder);
    return layout;
  }

  /**
   * Runs a synchronization.
   *
   * @param sync The sync to run.
   * @returns What the run changed.
   */
  public static async perform(sync: CollectionGitSync): Promise<GitSyncResult> {
    const syncer = new GitSyncer(sync);
    await sync.update({ status: GitSyncStatus.Running });

    try {
      const result = await syncer.run();
      await sync.update({
        status: GitSyncStatus.Success,
        lastError: null,
        lastResult: result,
      });
      return result;
    } catch (err) {
      const message = errToString(err);
      Logger.warn("Git sync failed", {
        syncId: sync.id,
        collectionId: sync.collectionId,
        error: message,
      });
      await sync.update({
        status: GitSyncStatus.Error,
        lastError: message.slice(0, 4000),
      });
      throw err;
    }
  }

  private sync: CollectionGitSync;

  private folder: string;

  private constructor(sync: CollectionGitSync) {
    this.sync = sync;
    this.folder = GitSyncer.normalizeFolder(sync.path);
  }

  private async run(): Promise<GitSyncResult> {
    const { sync } = this;
    const [team, user] = await Promise.all([
      Team.findByPk(sync.teamId, { rejectOnEmpty: true }),
      User.findByPk(sync.createdById),
    ]);
    if (!user || user.isSuspended) {
      throw new Error(
        "The user that connected the repository is suspended or deleted, reconnect it"
      );
    }

    const repo = await GitRepository.open(sync.id, {
      url: sync.repositoryUrl,
      branch: sync.branch,
      username: sync.username,
      token: sync.token,
    });

    for (let attempt = 1; ; attempt++) {
      const result: GitSyncResult = {
        exported: 0,
        removed: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        conflicts: [],
        commitSha: null,
      };

      await repo.reset();
      const claimed = new Set<string>();

      if (sync.isBidirectional && repo.remoteHead) {
        await this.importChanges(repo, team, user, result, claimed);
      }

      // Changes made in Outline after this moment are picked up by the next run.
      const syncedAt = new Date();
      const changedTitles = await this.exportDocuments(
        repo,
        team,
        result,
        claimed
      );

      const commitSha = await repo.commit(
        this.folder,
        this.commitMessage(result, changedTitles),
        {
          name: sync.authorName || "Outline",
          email: sync.authorEmail || `outline@${new URL(team.url).hostname}`,
        }
      );

      if (commitSha) {
        try {
          await repo.push();
        } catch (err) {
          if (
            err instanceof GitPushRejectedError &&
            attempt < maxPushAttempts
          ) {
            Logger.info("task", "Git push rejected, retrying sync", {
              syncId: sync.id,
            });
            continue;
          }
          throw err;
        }
      }

      result.commitSha = commitSha;
      await sync.update({
        lastCommitSha: commitSha ?? repo.remoteHead,
        lastSyncedAt: syncedAt,
      });
      return result;
    }
  }

  /**
   * Applies the commits made in Git since the last run to the collection.
   */
  private async importChanges(
    repo: GitRepository,
    team: Team,
    defaultUser: User,
    result: GitSyncResult,
    claimed: Set<string>
  ) {
    const { sync } = this;
    const remoteHead = repo.remoteHead;
    if (!remoteHead) {
      return;
    }

    const base = sync.lastCommitSha
      ? await repo.resolve(sync.lastCommitSha)
      : null;
    if (base === remoteHead) {
      return;
    }

    // Without a known base (first run, or the history was rewritten) it is not
    // possible to tell which side changed a document, so only new files are
    // imported and existing documents keep their Outline version.
    const initial = !base;
    const changes: GitFileChange[] = base
      ? await repo.diff(base, remoteHead, this.folder)
      : (await repo.listFiles(this.folder)).map((filePath) => ({
          status: "A" as const,
          path: filePath,
        }));

    const markdownChanges = changes
      .filter((change) => this.isDocumentFile(change.path))
      .sort(
        (a, b) =>
          a.path.split("/").length - b.path.split("/").length ||
          a.path.localeCompare(b.path)
      );
    if (!markdownChanges.length) {
      return;
    }

    let collection = await this.loadCollection();
    const layout = GitSyncer.layout(
      collection.documentStructure ?? [],
      this.folder
    );
    const idsInTree = new Set<string>();
    const files = new Map<string, ReturnType<typeof GitMarkdown.parse>>();

    for (const filePath of await repo.listFiles(this.folder)) {
      if (!this.isDocumentFile(filePath)) {
        continue;
      }
      const content = await this.readFile(repo, filePath);
      if (content === null) {
        continue;
      }
      const parsed = GitMarkdown.parse(content);
      files.set(filePath, parsed);
      if (parsed.frontmatter.id) {
        idsInTree.add(parsed.frontmatter.id);
      }
    }

    for (const change of markdownChanges) {
      try {
        if (change.status === "D") {
          await this.importDeletion(
            repo,
            base,
            change,
            idsInTree,
            defaultUser,
            result
          );
          continue;
        }

        const parsed = files.get(change.path);
        if (!parsed) {
          continue;
        }
        const author = await this.authorOf(
          repo,
          base,
          remoteHead,
          change.path,
          team,
          defaultUser
        );
        const created = await this.importFile(
          collection,
          layout,
          change.path,
          parsed,
          initial,
          author,
          team,
          result
        );
        if (created) {
          claimed.add(change.path);
          collection = await this.loadCollection();
          layout.folders.set(change.path.replace(/\.md$/i, ""), created.id);
        }
      } catch (err) {
        Logger.warn("Failed to import file from Git", {
          syncId: sync.id,
          path: change.path,
          error: errToString(err),
        });
        result.conflicts.push(`${change.path}: ${errToString(err)}`);
      }
    }
  }

  /**
   * Applies one added or modified file to the collection.
   *
   * @returns The document when a new one was created.
   */
  private async importFile(
    collection: Collection,
    layout: Layout,
    filePath: string,
    parsed: ReturnType<typeof GitMarkdown.parse>,
    initial: boolean,
    user: User,
    team: Team,
    result: GitSyncResult
  ): Promise<Document | undefined> {
    const { sync } = this;
    const id = parsed.frontmatter.id;
    const title = (
      parsed.heading ??
      (typeof parsed.frontmatter.title === "string"
        ? parsed.frontmatter.title
        : undefined) ??
      path.posix.basename(filePath).replace(/\.md$/i, "")
    ).slice(0, 255);
    const text = GitMarkdown.fromPortable(parsed.body, team.url);

    const found =
      id && isUUID(id)
        ? await Document.findByPk(id, { userId: user.id })
        : null;
    const existing = found?.collectionId === collection.id ? found : null;

    if (existing) {
      if (initial) {
        return undefined;
      }

      const current = await DocumentHelper.toMarkdown(existing, {
        includeTitle: false,
      });
      if (
        existing.title === title &&
        GitMarkdown.normalize(current) === GitMarkdown.normalize(text)
      ) {
        return undefined;
      }

      if (sync.lastSyncedAt && existing.updatedAt > sync.lastSyncedAt) {
        result.conflicts.push(existing.title);
        return undefined;
      }

      const actor = can(user, "update", existing) ? user : await this.owner();
      await sequelize.transaction(async (transaction) => {
        const document = await Document.findByPk(existing.id, {
          includeState: true,
          transaction,
          rejectOnEmpty: true,
        });
        await documentUpdater(createContext({ user: actor, transaction }), {
          document,
          title,
          text,
        });
      });
      result.updated++;
      return undefined;
    }

    const parentDocumentId =
      layout.folders.get(path.posix.dirname(filePath)) ?? null;
    const collectionForUser = await Collection.findByPk(collection.id, {
      userId: user.id,
    });
    const actor = can(user, "createDocument", collectionForUser)
      ? user
      : await this.owner();

    const document = await sequelize.transaction(async (transaction) =>
      documentCreator(createContext({ user: actor, transaction }), {
        title,
        text,
        collectionId: collection.id,
        parentDocumentId,
        publish: true,
      })
    );
    result.created++;
    return document;
  }

  /**
   * Moves the document of a file that was deleted in Git to the trash, unless
   * it changed in Outline since the last run or still exists under another path.
   */
  private async importDeletion(
    repo: GitRepository,
    base: string | null,
    change: GitFileChange,
    idsInTree: Set<string>,
    user: User,
    result: GitSyncResult
  ) {
    if (!base || !change.previousPath) {
      return;
    }
    const previous = await repo.show(base, change.previousPath);
    if (previous === null) {
      return;
    }
    const id = GitMarkdown.parse(previous).frontmatter.id;
    if (!id || !isUUID(id) || idsInTree.has(id)) {
      return;
    }

    const document = await Document.findByPk(id, { userId: user.id });
    if (!document || document.collectionId !== this.sync.collectionId) {
      return;
    }
    if (this.sync.lastSyncedAt && document.updatedAt > this.sync.lastSyncedAt) {
      result.conflicts.push(document.title);
      return;
    }

    const actor = can(user, "delete", document) ? user : await this.owner();
    await sequelize.transaction(async (transaction) => {
      const locked = await Document.findByPk(document.id, {
        transaction,
        rejectOnEmpty: true,
      });
      await locked.destroyWithCtx(createContext({ user: actor, transaction }));
    });
    result.deleted++;
  }

  /**
   * Writes every published document of the collection to the working copy
   * and removes files of documents that no longer exist.
   *
   * @returns The titles of documents whose file changed.
   */
  private async exportDocuments(
    repo: GitRepository,
    team: Team,
    result: GitSyncResult,
    claimed: Set<string>
  ): Promise<string[]> {
    const collection = await this.loadCollection();
    const layout = GitSyncer.layout(
      collection.documentStructure ?? [],
      this.folder
    );
    const parents = new Map<string, string | null>();
    const visit = (nodes: NavigationNode[], parentId: string | null) => {
      for (const node of nodes) {
        parents.set(node.id, parentId);
        visit(node.children ?? [], node.id);
      }
    };
    visit(collection.documentStructure ?? [], null);

    // Index the files that are already in the repository by document ID, so
    // that extra frontmatter added in Git survives and stale files are found.
    const existingById = new Map<string, string>();
    const existingFiles = new Map<string, string>();
    for (const filePath of await repo.listFiles(this.folder)) {
      if (!this.isDocumentFile(filePath)) {
        continue;
      }
      const content = await this.readFile(repo, filePath);
      if (content === null) {
        continue;
      }
      existingFiles.set(filePath, content);
      const id = GitMarkdown.parse(content).frontmatter.id;
      if (id) {
        existingById.set(id, filePath);
      }
    }

    const changedTitles: string[] = [];
    const desired = new Set<string>();
    const ids = Array.from(layout.files.keys());

    for (let i = 0; i < ids.length; i += 100) {
      const documents = await Document.findAll({
        where: { id: ids.slice(i, i + 100), collectionId: collection.id },
      });

      for (const document of documents) {
        const filePath = layout.files.get(document.id);
        if (!filePath) {
          continue;
        }
        desired.add(filePath);

        const previousPath = existingById.get(document.id);
        const previous =
          existingFiles.get(filePath) ??
          (previousPath ? existingFiles.get(previousPath) : undefined);
        const extra = previous ? this.extraFrontmatter(previous) : {};

        const body = GitMarkdown.toPortable(
          await DocumentHelper.toMarkdown(document, { includeTitle: false }),
          team.url
        );
        const frontmatter: GitFrontmatter = {
          ...extra,
          id: document.id,
          title: document.title,
          url: `${team.url}${document.path}`,
          collection: collection.name,
          parent: parents.get(document.id) ?? null,
          createdAt: document.createdAt.toISOString(),
          updatedAt: document.updatedAt.toISOString(),
          createdBy: document.createdBy?.name,
          updatedBy: document.updatedBy?.name,
        };
        const content = GitMarkdown.serialize(
          frontmatter,
          document.title || "Untitled",
          body
        );

        if (existingFiles.get(filePath) !== content) {
          const absolute = path.join(repo.dir, filePath);
          await fs.ensureDir(path.dirname(absolute));
          await fs.writeFile(absolute, content);
          result.exported++;
          changedTitles.push(document.title || "Untitled");
        }
      }
    }

    // Remove files that belong to Outline but are no longer wanted: documents
    // that were deleted, archived, moved or renamed, and files from Git that
    // were imported as new documents under another name.
    for (const [filePath, content] of existingFiles) {
      if (desired.has(filePath)) {
        continue;
      }
      const managed =
        claimed.has(filePath) || !!GitMarkdown.parse(content).frontmatter.id;
      if (!managed) {
        continue;
      }
      await fs.remove(path.join(repo.dir, filePath));
      result.removed++;
    }

    return changedTitles;
  }

  /**
   * Finds the Outline user that made the latest change to a file in Git, by
   * the email of the commit author.
   */
  private async authorOf(
    repo: GitRepository,
    base: string | null,
    head: string,
    filePath: string,
    team: Team,
    fallback: User
  ): Promise<User> {
    try {
      const email = (
        await repo.run([
          "log",
          "-1",
          "--format=%ae",
          base ? `${base}..${head}` : head,
          "--",
          filePath,
        ])
      ).trim();
      if (!email) {
        return fallback;
      }
      const user = await User.findOne({
        where: { teamId: team.id, email: email.toLowerCase() },
      });
      return user && !user.isSuspended ? user : fallback;
    } catch (_err) {
      return fallback;
    }
  }

  private async owner(): Promise<User> {
    return User.findByPk(this.sync.createdById, { rejectOnEmpty: true });
  }

  private async loadCollection(): Promise<Collection> {
    const collection = await Collection.findByPk(this.sync.collectionId, {
      includeDocumentStructure: true,
    });
    if (!collection || collection.archivedAt || collection.deletedAt) {
      throw new Error("The collection is archived or was deleted");
    }
    return collection;
  }

  private isDocumentFile(filePath: string) {
    return (
      /\.md$/i.test(filePath) &&
      !path.posix.basename(filePath).startsWith(".") &&
      (!this.folder ||
        filePath === this.folder ||
        filePath.startsWith(`${this.folder}/`))
    );
  }

  private async readFile(repo: GitRepository, filePath: string) {
    try {
      return await fs.readFile(path.join(repo.dir, filePath), "utf8");
    } catch (_err) {
      return null;
    }
  }

  /**
   * Returns frontmatter keys of an existing file that Outline does not manage,
   * such as tags added in Git, so that they are kept on export.
   */
  private extraFrontmatter(content: string): GitFrontmatter {
    const managedKeys = [
      "id",
      "title",
      "url",
      "collection",
      "parent",
      "createdAt",
      "updatedAt",
      "createdBy",
      "updatedBy",
    ];
    const { frontmatter } = GitMarkdown.parse(content);
    return Object.fromEntries(
      Object.entries(frontmatter).filter(([key]) => !managedKeys.includes(key))
    );
  }

  private commitMessage(result: GitSyncResult, titles: string[]) {
    const parts: string[] = [];
    if (result.exported) {
      parts.push(
        `${result.exported} document${result.exported === 1 ? "" : "s"} updated`
      );
    }
    if (result.removed) {
      parts.push(
        `${result.removed} document${result.removed === 1 ? "" : "s"} removed`
      );
    }
    const subject = `Outline: ${parts.join(", ") || "sync"}`;
    const body = titles
      .slice(0, 50)
      .map((title) => `- ${title}`)
      .join("\n");
    return body ? `${subject}\n\n${body}\n` : `${subject}\n`;
  }
}
