import { z } from "zod";
import { GitSyncDirection } from "@server/models/CollectionGitSync";
import { BaseSchema } from "@server/routes/api/schema";

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((value) => (value?.trim() ? value.trim() : null));

const settings = {
  /** The HTTPS clone URL of the repository. */
  repositoryUrl: z.string().trim().min(1).max(2048),
  /** The branch to commit to. */
  branch: z.string().trim().min(1).max(255).prefault("main"),
  /** The folder in the repository, empty for the root. */
  path: z.string().trim().max(1024).prefault(""),
  /** The user name for HTTPS authentication. */
  username: optionalText(255),
  /** The direction of the sync. */
  direction: z.enum(GitSyncDirection).prefault(GitSyncDirection.Bidirectional),
  /** The name of the commit author. */
  authorName: optionalText(255),
  /** The email of the commit author. */
  authorEmail: z
    .email()
    .max(255)
    .nullish()
    .or(z.literal("").transform(() => null)),
  /** Whether the sync is active. */
  enabled: z.boolean().optional(),
};

export const GitSyncListSchema = BaseSchema.extend({
  body: z.object({}).prefault({}),
});

export type GitSyncListReq = z.infer<typeof GitSyncListSchema>;

export const GitSyncInfoSchema = BaseSchema.extend({
  body: z.object({
    collectionId: z.uuid(),
  }),
});

export type GitSyncInfoReq = z.infer<typeof GitSyncInfoSchema>;

export const GitSyncCreateSchema = BaseSchema.extend({
  body: z.object({
    collectionId: z.uuid(),
    ...settings,
    /**
     * The access token for HTTPS authentication. Not named "token", which the
     * authentication middleware reads as an API key.
     */
    accessToken: z.string().max(4096).nullish(),
  }),
});

export type GitSyncCreateReq = z.infer<typeof GitSyncCreateSchema>;

export const GitSyncUpdateSchema = BaseSchema.extend({
  body: z.object({
    id: z.uuid(),
    repositoryUrl: settings.repositoryUrl.optional(),
    branch: z.string().trim().min(1).max(255).optional(),
    path: z.string().trim().max(1024).optional(),
    username: settings.username.optional(),
    direction: z.enum(GitSyncDirection).optional(),
    authorName: settings.authorName.optional(),
    authorEmail: settings.authorEmail.optional(),
    enabled: z.boolean().optional(),
    /** A new token, null to remove it, or undefined to keep the current one. */
    accessToken: z.string().max(4096).nullish(),
  }),
});

export type GitSyncUpdateReq = z.infer<typeof GitSyncUpdateSchema>;

export const GitSyncIdSchema = BaseSchema.extend({
  body: z.object({
    id: z.uuid(),
  }),
});

export type GitSyncIdReq = z.infer<typeof GitSyncIdSchema>;

export const GitSyncTagsCreateSchema = BaseSchema.extend({
  body: z.object({
    id: z.uuid(),
    /** The name of the tag, for example "v1.0.0". */
    name: z.string().trim().min(1).max(255),
    /** The message of the annotated tag. */
    message: z.string().max(10000).prefault(""),
  }),
});

export type GitSyncTagsCreateReq = z.infer<typeof GitSyncTagsCreateSchema>;

export const GitSyncTagsDeleteSchema = BaseSchema.extend({
  body: z.object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(255),
  }),
});

export type GitSyncTagsDeleteReq = z.infer<typeof GitSyncTagsDeleteSchema>;
