// Fork feature: name a version from the document history and show the name.
// Revisions are created by the worker a few minutes after an edit, so run this
// on a document that already has one. Args: title= (document title, required).
export default async ({ page, click, step, psql, literal, args, log }) => {
  const title = args.title;
  if (!title) throw new Error("title= is required");

  const doc = psql(`select "urlId" from documents where title = ${literal(title)} and "deletedAt" is null`)[0];
  if (!doc) throw new Error(`no document titled ${title}`);
  await page.goto(`/doc/doc-${doc}/history`);
  await page.waitForLoadState("networkidle");
  let revisions = [];
  for (let i = 0; i < 30; i++) {
    revisions = psql(`select r.id from revisions r join documents d on d.id = r."documentId" where d.title = ${literal(title)} order by r."createdAt" desc`);
    if (revisions.length) break;
    await page.waitForTimeout(1000);
  }
  log("revisions:", revisions.length);
  if (!revisions.length) throw new Error("no revision was created");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await step("history");
  const menus = page.getByRole("button", { name: "Revision options" });
  await menus.last().waitFor();
  await click(menus.last());
  await step("revision-menu");
  await click(page.getByRole("menuitem", { name: "Name version" }));
  const nameInput = page.getByRole("dialog").getByRole("textbox");
  await nameInput.fill("Approved");
  await step("name-version-dialog");
  await click(page.getByRole("dialog").getByRole("button", { name: "Save" }));
  await page.getByText("Approved", { exact: true }).first().waitFor();
  const named = psql(`select r.name from revisions r join documents d on d.id = r."documentId" where d.title = ${literal(title)} and r.name is not null`);
  log("named:", named);
  if (named[0] !== "Approved") throw new Error("revision name not saved");
  await page.reload();
  await page.getByText("Approved", { exact: true }).first().waitFor();
  await step("history-with-named-version");

  return { title };
};
