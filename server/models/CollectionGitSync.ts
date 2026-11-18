import crypto from "node:crypto";
import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  AllowNull,
  BeforeCreate,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  IsIn,
  Table,
} from "sequelize-typescript";
import Collection from "./Collection";
import Team from "./Team";
import User from "./User";
import IdModel from "./base/IdModel";
import Encrypted from "./decorators/Encrypted";
import Length from "./validators/Length";

/**
 * The direction in which a collection is synchronized with its Git repository.
 */
export enum GitSyncDirection {
  /** Changes in Outline are committed to Git, the repository is never read back. */
  Push = "push",
  /** Changes flow in both directions, Outline wins when both sides changed. */
  Bidirectional = "bidirectional",
}

/**
 * The outcome of the most recent synchronization run.
 */
export enum GitSyncStatus {
  Pending = "pending",
  Running = "running",
  Success = "success",
  Error = "error",
}

/**
 * Summary of what a synchronization run changed.
 */
export interface GitSyncResult {
  /** Files written or updated in the repository. */
  exported: number;
  /** Files removed from the repository. */
  removed: number;
  /** Documents created in Outline from new files. */
  created: number;
  /** Documents updated in Outline from changed files. */
  updated: number;
  /** Documents moved to the trash because their file was deleted. */
  deleted: number;
  /** Documents changed on both sides, where the Outline version was kept. */
  conflicts: string[];
  /** The commit created by this run, if any. */
  commitSha?: string | null;
}

/**
 * Connects a collection to a Git repository. Documents in the collection are
 * written as Markdown files and kept in sync in the background.
 */
@Table({ tableName: "collection_git_syncs", modelName: "collection_git_sync" })
class CollectionGitSync extends IdModel<
  InferAttributes<CollectionGitSync>,
  Partial<InferCreationAttributes<CollectionGitSync>>
> {
  /** The HTTPS clone URL of the repository. */
  @Length({ max: 2048, msg: "repositoryUrl must be 2048 characters or less" })
  @Column(DataType.STRING)
  repositoryUrl: string;

  /** The branch documents are committed to. */
  @Default("main")
  @Length({ max: 255, msg: "branch must be 255 characters or less" })
  @Column(DataType.STRING)
  branch: string;

  /** The folder inside the repository that holds the documents, empty for the root. */
  @Default("")
  @Length({ max: 1024, msg: "path must be 1024 characters or less" })
  @Column(DataType.STRING)
  path: string;

  /** The user name used for HTTPS authentication. */
  @AllowNull
  @Length({ max: 255, msg: "username must be 255 characters or less" })
  @Column(DataType.STRING)
  username: string | null;

  /** The access token used for HTTPS authentication. */
  @Column(DataType.BLOB)
  @Encrypted
  token: string | null;

  @Default(GitSyncDirection.Bidirectional)
  @IsIn([Object.values(GitSyncDirection)])
  @Column(DataType.STRING)
  direction: GitSyncDirection;

  /** The name of the commit author, defaults to "Outline". */
  @AllowNull
  @Length({ max: 255, msg: "authorName must be 255 characters or less" })
  @Column(DataType.STRING)
  authorName: string | null;

  /** The email of the commit author. */
  @AllowNull
  @Length({ max: 255, msg: "authorEmail must be 255 characters or less" })
  @Column(DataType.STRING)
  authorEmail: string | null;

  @Default(true)
  @Column(DataType.BOOLEAN)
  enabled: boolean;

  /** A secret that authorizes calls to the push webhook of this sync. */
  @Column(DataType.STRING)
  webhookSecret: string;

  @Default(GitSyncStatus.Pending)
  @Column(DataType.STRING)
  status: GitSyncStatus;

  @AllowNull
  @Column(DataType.TEXT)
  lastError: string | null;

  @AllowNull
  @Column(DataType.JSONB)
  lastResult: GitSyncResult | null;

  /** The commit on the remote branch that Outline last synchronized with. */
  @AllowNull
  @Column(DataType.STRING)
  lastCommitSha: string | null;

  /** When the documents were last read for a synchronization. */
  @AllowNull
  @Column(DataType.DATE)
  lastSyncedAt: Date | null;

  // associations

  @BelongsTo(() => Collection, "collectionId")
  collection: Collection;

  @ForeignKey(() => Collection)
  @Column(DataType.UUID)
  collectionId: string;

  @BelongsTo(() => User, "createdById")
  createdBy: User;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  createdById: string;

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  // hooks

  @BeforeCreate
  static setWebhookSecret(model: CollectionGitSync) {
    if (!model.webhookSecret) {
      model.webhookSecret = crypto.randomBytes(24).toString("hex");
    }
  }

  /**
   * Whether the repository is read back into Outline.
   *
   * @returns true if changes in Git are applied to the collection.
   */
  get isBidirectional() {
    return this.direction === GitSyncDirection.Bidirectional;
  }
}

export default CollectionGitSync;
