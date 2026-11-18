// Fork: Git sync end to end. The server must run with
// GIT_SYNC_ALLOW_INSECURE_URLS=true (add it to in_instance in verify-outline.sh)
// and a short GIT_SYNC_POLL_INTERVAL, e.g. 20. Needs a collection "Handbuch" with a
// document. Args: remote=<path to an empty bare repo> work=<scratch dir>.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Git User",
  GIT_AUTHOR_EMAIL: "someone@example.com",
  GIT_COMMITTER_NAME: "Git User",
  GIT_COMMITTER_EMAIL: "someone@example.com",
};
const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, env: gitEnv }).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async ({ page, click, step, psql, literal, args, log }) => {
  const remote = args.remote;
  const work = args.work;
  const collection = args.collection ?? "Handbuch";

  await page.goto("/settings/integrations/git-sync");
  await page.getByRole("heading", { name: "Git Sync" }).waitFor();
  await step("settings-empty");

  const card = page.locator("div", { hasText: collection }).filter({
    has: page.getByRole("button", { name: "Connect" }),
  }).last();
  await click(card.getByRole("button", { name: "Connect" }));
  await page.getByLabel("Repository URL").fill(`file://${remote}`);
  await page.getByLabel("Folder").fill("docs");
  await page.getByLabel("Commit author").fill("Outline Bot");
  await step("connect-form");
  await click(page.getByRole("button", { name: "Connect" }).last());
  await page.getByText("Collection connected to Git").waitFor();

  // Wait for the background job to export.
  let head = "";
  for (let i = 0; i < 60 && !head; i++) {
    await sleep(1000);
    try {
      head = git(remote, "rev-parse", "main").trim();
    } catch {
      head = "";
    }
  }
  if (!head) throw new Error("no commit was pushed to the repository");
  await page.reload();
  await page.getByText("Synced").first().waitFor({ timeout: 30000 });
  await step("synced");

  fs.rmSync(work, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", remote, work], { env: gitEnv });
  const files = git(work, "ls-files").trim().split("\n");
  log("files:", files);
  const file = files.find((f) => f.startsWith("docs/") && f.endsWith(".md"));
  if (!file) throw new Error("no markdown file exported");
  const content = fs.readFileSync(path.join(work, file), "utf8");
  log("exported:", content.slice(0, 400));
  const id = content.match(/^id: (.+)$/m)?.[1];
  if (!id) throw new Error("no id in frontmatter");

  // Change the document in Git and add a new one.
  fs.writeFileSync(
    path.join(work, file),
    content.replace(/\n# (.+)\n[\s\S]*$/, "\n# $1\n\nEdited in Git by E2E\n")
  );
  fs.writeFileSync(
    path.join(work, "docs", "Aus Git.md"),
    "# Aus Git\n\nNeu in Git angelegt\n"
  );
  git(work, "add", "-A");
  git(work, "commit", "-qm", "Edit from Git");
  git(work, "push", "-q", "origin", "main");

  let rows = [];
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    rows = psql(
      `select title from documents where text like '%Edited in Git by E2E%' and id = ${literal(id)}`
    );
    const created = psql(
      `select id from documents where title = 'Aus Git' and "deletedAt" is null`
    );
    if (rows.length && created.length) break;
  }
  log("imported:", rows);
  if (!rows.length) throw new Error("change from Git was not imported");

  // Create a tag from the UI.
  await page.reload();
  await click(page.getByRole("button", { name: "Tags" }).first());
  await page.getByLabel("New tag").fill("v1.0.0");
  await page.getByLabel("Message").fill("Erstes Release");
  await click(page.getByRole("button", { name: "Create tag" }));
  await page.getByText("Tag created").waitFor({ timeout: 60000 });
  await step("tag-created");

  const tags = git(work, "ls-remote", "--tags", "origin");
  log("remote tags:", tags);
  if (!tags.includes("refs/tags/v1.0.0")) throw new Error("tag not pushed");

  git(work, "pull", "-q", "origin", "main");
  const newFile = fs.readFileSync(path.join(work, "docs", "Aus Git.md"), "utf8");
  log("new file after sync:", newFile.slice(0, 200));
  if (!/^id: /m.test(newFile)) throw new Error("new file did not get frontmatter");

  return { file, id, tags };
};
