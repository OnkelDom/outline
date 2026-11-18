import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { ValidationError } from "@server/errors";
import env from "./env";

/**
 * A tag in a Git repository.
 */
export interface GitTag {
  /** The tag name, for example "v1.0.0". */
  name: string;
  /** The commit the tag points to. */
  commitSha: string;
  /** The tag message, or the commit subject for lightweight tags. */
  message: string;
  /** The name of the tagger, or commit author for lightweight tags. */
  author: string;
  /** When the tag was created. */
  createdAt: string | null;
}

/**
 * A change to a file between two commits.
 */
export interface GitFileChange {
  /** A (added), M (modified), D (deleted) or R (renamed). */
  status: "A" | "M" | "D" | "R";
  /** The path of the file after the change. */
  path: string;
  /** The path of the file before the change, for renames and deletes. */
  previousPath?: string;
}

/**
 * Options to connect to a remote repository.
 */
export interface GitRemoteOptions {
  /** The clone URL of the repository. */
  url: string;
  /** The branch to work on. */
  branch: string;
  /** The user name for HTTPS authentication. */
  username?: string | null;
  /** The access token for HTTPS authentication. */
  token?: string | null;
}

/**
 * Raised when the remote branch moved on while a push was prepared.
 */
export class GitPushRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitPushRejectedError";
  }
}

const maxBuffer = 64 * 1024 * 1024;
const commandTimeout = 5 * 60 * 1000;

/**
 * A thin wrapper around the git command line for a working copy that Outline
 * keeps in a cache directory. Credentials are only passed through the
 * environment of each command and never written to disk.
 */
export class GitRepository {
  /**
   * Validates that the URL can be used as a remote, which is https:// unless
   * insecure URLs are explicitly allowed.
   *
   * @param url The clone URL to validate.
   * @throws ValidationError when the URL is not allowed.
   */
  public static assertValidUrl(url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (_err) {
      throw ValidationError("The repository URL is not a valid URL");
    }

    const allowed = env.GIT_SYNC_ALLOW_INSECURE_URLS
      ? ["https:", "http:", "file:"]
      : ["https:"];
    if (!allowed.includes(parsed.protocol)) {
      throw ValidationError("The repository URL must start with https://");
    }
    if (parsed.username || parsed.password) {
      throw ValidationError(
        "Do not put credentials in the repository URL, use the token field instead"
      );
    }
  }

  /**
   * Validates a branch or tag name with git's own rules.
   *
   * @param name The reference name.
   * @param kind What the name is used for, shown in the error.
   * @throws ValidationError when the name is not a valid reference.
   */
  public static async assertValidRefName(name: string, kind: string) {
    try {
      await GitRepository.exec(
        ["check-ref-format", "--allow-onelevel", name],
        os.tmpdir(),
        {}
      );
    } catch (_err) {
      throw ValidationError(`"${name}" is not a valid ${kind} name`);
    }
    if (name.startsWith("-")) {
      throw ValidationError(`"${name}" is not a valid ${kind} name`);
    }
  }

  /**
   * Opens the cached working copy for a sync, cloning it on first use, and
   * fetches the latest state of the remote.
   *
   * @param id A stable identifier for the working copy.
   * @param remote How to reach the remote repository.
   * @returns The repository.
   */
  public static async open(id: string, remote: GitRemoteOptions) {
    const baseDir =
      env.GIT_SYNC_CACHE_DIR ?? path.join(os.tmpdir(), "outline-git-sync");
    const dir = path.join(baseDir, id);
    const repo = new GitRepository(dir, remote);
    await repo.prepare();
    return repo;
  }

  /**
   * Removes the cached working copy for a sync.
   *
   * @param id The identifier the repository was opened with.
   */
  public static async remove(id: string) {
    const baseDir =
      env.GIT_SYNC_CACHE_DIR ?? path.join(os.tmpdir(), "outline-git-sync");
    await fs.remove(path.join(baseDir, id));
  }

  /** The working directory. */
  public readonly dir: string;

  /** The commit the remote branch pointed to when it was last fetched. */
  public remoteHead: string | null = null;

  /**
   * Runs a git command in the working copy.
   *
   * @param args The arguments to git.
   * @returns The standard output.
   */
  public run(args: string[]) {
    return GitRepository.exec(args, this.dir, this.environment());
  }

  /**
   * Fetches the remote and resets the working copy to the remote branch,
   * discarding anything that was not pushed.
   */
  public async reset() {
    await this.run(["fetch", "--prune", "--tags", "--force", "origin"]);
    this.remoteHead = await this.resolve(
      `refs/remotes/origin/${this.remote.branch}`
    );

    if (this.remoteHead) {
      await this.run([
        "checkout",
        "--force",
        "-B",
        this.remote.branch,
        this.remoteHead,
      ]);
    } else {
      // An empty repository or a new branch, start without history.
      const ref = `refs/heads/${this.remote.branch}`;
      await this.run(["symbolic-ref", "HEAD", ref]);
      await this.run(["update-ref", "-d", ref]).catch(() => undefined);
      await this.run([
        "rm",
        "-r",
        "--cached",
        "--quiet",
        "--ignore-unmatch",
        ".",
      ]);
    }
    await this.run(["clean", "-fdx", "--quiet"]);
  }

  /**
   * Resolves a reference to a commit.
   *
   * @param ref The reference.
   * @returns The commit SHA, or null when the reference does not exist.
   */
  public async resolve(ref: string): Promise<string | null> {
    try {
      const out = await this.run([
        "rev-parse",
        "--verify",
        "--quiet",
        `${ref}^{commit}`,
      ]);
      return out.trim() || null;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Lists the files that changed between two commits below a folder.
   *
   * @param from The older commit.
   * @param to The newer commit.
   * @param folder The folder to limit the changes to, empty for the root.
   * @returns The changed files.
   */
  public async diff(
    from: string,
    to: string,
    folder: string
  ): Promise<GitFileChange[]> {
    const out = await this.run([
      "diff",
      "--name-status",
      "-z",
      "-M",
      "--no-ext-diff",
      from,
      to,
      "--",
      folder || ".",
    ]);
    const parts = out.split("\0").filter((part) => part !== "");
    const changes: GitFileChange[] = [];

    for (let i = 0; i < parts.length; i++) {
      const code = parts[i];
      const kind = code[0];
      if (kind === "R" || kind === "C") {
        const previousPath = parts[++i];
        const filePath = parts[++i];
        changes.push(
          kind === "R"
            ? { status: "R", path: filePath, previousPath }
            : { status: "A", path: filePath }
        );
      } else if (kind === "D") {
        const filePath = parts[++i];
        changes.push({ status: "D", path: filePath, previousPath: filePath });
      } else if (kind === "A" || kind === "M" || kind === "T") {
        changes.push({ status: kind === "A" ? "A" : "M", path: parts[++i] });
      } else {
        i++;
      }
    }

    return changes;
  }

  /**
   * Reads a file as it was in a commit.
   *
   * @param commit The commit.
   * @param filePath The path of the file relative to the repository root.
   * @returns The content, or null when the file did not exist.
   */
  public async show(commit: string, filePath: string): Promise<string | null> {
    try {
      return await this.run(["show", `${commit}:${filePath}`]);
    } catch (_err) {
      return null;
    }
  }

  /**
   * Lists the tracked and untracked files below a folder.
   *
   * @param folder The folder, empty for the repository root.
   * @returns The paths relative to the repository root.
   */
  public async listFiles(folder: string): Promise<string[]> {
    const out = await this.run([
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      folder || ".",
    ]);
    return Array.from(new Set(out.split("\0").filter((part) => part !== "")));
  }

  /**
   * Stages everything below a folder and commits it when anything changed.
   *
   * @param folder The folder to stage, empty for the repository root.
   * @param message The commit message.
   * @param author The commit author.
   * @returns The new commit SHA, or null when nothing changed.
   */
  public async commit(
    folder: string,
    message: string,
    author: { name: string; email: string }
  ): Promise<string | null> {
    await this.run(["add", "--all", "--", folder || "."]);
    const status = await this.run(["status", "--porcelain", "-z"]);
    if (!status.trim()) {
      return null;
    }

    await GitRepository.exec(
      ["commit", "--quiet", "--no-verify", "--file", "-"],
      this.dir,
      {
        ...this.environment(),
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_NAME: author.name,
        GIT_COMMITTER_EMAIL: author.email,
      },
      message
    );
    return this.resolve("HEAD");
  }

  /**
   * Pushes the local branch to the remote branch.
   *
   * @throws GitPushRejectedError when the remote has commits that are missing locally.
   */
  public async push() {
    try {
      await this.run([
        "push",
        "--porcelain",
        "origin",
        `HEAD:refs/heads/${this.remote.branch}`,
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/rejected|non-fast-forward|fetch first/i.test(message)) {
        throw new GitPushRejectedError(message);
      }
      throw err;
    }
  }

  /**
   * Lists the tags of the repository, newest first.
   *
   * @returns The tags.
   */
  public async listTags(): Promise<GitTag[]> {
    const separator = "\u001f";
    const out = await this.run([
      "for-each-ref",
      "--sort=-creatordate",
      `--format=${[
        "%(refname:strip=2)",
        "%(*objectname)",
        "%(objectname)",
        "%(contents:subject)",
        "%(taggername)",
        "%(authorname)",
        "%(creatordate:iso-strict)",
      ].join(separator)}`,
      "refs/tags",
    ]);

    return out
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        const [name, peeled, sha, subject, tagger, author, date] =
          line.split(separator);
        return {
          name,
          commitSha: peeled || sha,
          message: subject ?? "",
          author: tagger || author || "",
          createdAt: date || null,
        };
      });
  }

  /**
   * Creates an annotated tag on the current commit and pushes it.
   *
   * @param name The tag name.
   * @param message The tag message.
   * @param author The tagger.
   */
  public async createTag(
    name: string,
    message: string,
    author: { name: string; email: string }
  ) {
    await GitRepository.exec(
      ["tag", "--annotate", "--file", "-", name, "HEAD"],
      this.dir,
      {
        ...this.environment(),
        GIT_COMMITTER_NAME: author.name,
        GIT_COMMITTER_EMAIL: author.email,
      },
      message || name
    );
    try {
      await this.run(["push", "--porcelain", "origin", `refs/tags/${name}`]);
    } catch (err) {
      await this.run(["tag", "--delete", name]);
      throw err;
    }
  }

  /**
   * Deletes a tag locally and on the remote.
   *
   * @param name The tag name.
   */
  public async deleteTag(name: string) {
    await this.run(["push", "--porcelain", "origin", `:refs/tags/${name}`]);
    await this.run(["tag", "--delete", name]).catch(() => undefined);
  }

  private remote: GitRemoteOptions;

  private constructor(dir: string, remote: GitRemoteOptions) {
    this.dir = dir;
    this.remote = remote;
  }

  /**
   * Makes sure a working copy with the right remote exists.
   */
  private async prepare() {
    const isRepo = await fs.pathExists(path.join(this.dir, ".git"));
    if (isRepo) {
      const url = await this.run(["remote", "get-url", "origin"]).catch(
        () => ""
      );
      if (url.trim() === this.remote.url) {
        return;
      }
      await fs.remove(this.dir);
    }

    await fs.ensureDir(this.dir);
    await this.run(["init", "--quiet"]);
    await this.run(["remote", "add", "origin", this.remote.url]);
  }

  private environment(): NodeJS.ProcessEnv {
    const config: [string, string][] = [
      ["core.hooksPath", "/dev/null"],
      ["core.quotePath", "false"],
      ["core.autocrlf", "false"],
      ["http.followRedirects", "false"],
      ["commit.gpgSign", "false"],
      ["tag.gpgSign", "false"],
      ["init.defaultBranch", this.remote.branch],
    ];

    if (this.remote.token) {
      const credentials = Buffer.from(
        `${this.remote.username || "git"}:${this.remote.token}`
      ).toString("base64");
      config.push(["http.extraHeader", `Authorization: Basic ${credentials}`]);
    }

    const result: NodeJS.ProcessEnv = {
      GIT_CONFIG_COUNT: String(config.length),
    };
    config.forEach(([key, value], index) => {
      result[`GIT_CONFIG_KEY_${index}`] = key;
      result[`GIT_CONFIG_VALUE_${index}`] = value;
    });
    return result;
  }

  private static exec(
    args: string[],
    cwd: string,
    extraEnv: NodeJS.ProcessEnv,
    input?: string
  ): Promise<string> {
    const allowProtocol = env.GIT_SYNC_ALLOW_INSECURE_URLS
      ? "https:http:file"
      : "https";

    return new Promise((resolve, reject) => {
      const child = execFile(
        "git",
        args,
        {
          cwd,
          maxBuffer,
          timeout: commandTimeout,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME ?? os.tmpdir(),
            LANG: "C",
            LC_ALL: "C",
            GIT_TERMINAL_PROMPT: "0",
            GIT_ASKPASS: "echo",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_ALLOW_PROTOCOL: allowProtocol,
            HTTPS_PROXY: process.env.HTTPS_PROXY,
            HTTP_PROXY: process.env.HTTP_PROXY,
            NO_PROXY: process.env.NO_PROXY,
            GIT_SSL_CAINFO: process.env.GIT_SSL_CAINFO,
            ...extraEnv,
          },
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(
              new Error(
                `git ${args[0]} failed: ${GitRepository.redact(
                  String(stderr || error.message)
                ).trim()}`
              )
            );
            return;
          }
          resolve(String(stdout));
        }
      );

      if (input !== undefined) {
        child.stdin?.end(input);
      }
    });
  }

  /**
   * Removes anything that looks like credentials from git output.
   *
   * @param text The output.
   * @returns The output without credentials.
   */
  private static redact(text: string) {
    return text
      .replace(/Authorization: Basic [A-Za-z0-9+/=]+/g, "Authorization: ***")
      .replace(/\/\/[^/@\s]+@/g, "//***@");
  }
}
