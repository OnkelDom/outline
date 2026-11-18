// Fork features: text color, Markdown source editing and Word export, driven
// through the UI of a fresh document. Named versions: see fork-name-version.mjs.
// Args: collection= (name of an existing collection, required).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export default async ({ page, click, step, psql, literal, args, log }) => {
  if (!args.collection) {
    throw new Error("collection= is required; run create-collection.mjs first");
  }
  const title = `Fork Features ${Date.now()}`;

  await page.goto("/home");
  await page.waitForLoadState("networkidle");
  await click(page.getByRole("link", { name: `Expand ${args.collection}` }));
  await page.waitForURL(/\/collection\//);
  const main = page.getByRole("main");
  await click(main.getByRole("link", { name: "New doc" }).or(main.getByRole("button", { name: "New doc" })).first());
  await page.waitForURL(/\/doc\//);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);

  const titleBox = page.getByRole("textbox", { name: "Document title" });
  await titleBox.click();
  await page.keyboard.type(title, { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("Plain words and colored words", { delay: 10 });

  // 1. Text color: select the last word and pick "Red" in the toolbar.
  for (let i = 0; i < "words".length; i++) {
    await page.keyboard.press("Shift+ArrowLeft");
  }
  const colorButton = page.getByRole("button", { name: "Text color" });
  await colorButton.waitFor();
  await step("toolbar-with-text-color");
  await click(colorButton);
  await step("text-color-menu");
  await click(page.getByRole("menuitem", { name: "Red" }));
  const colored = page.getByRole("textbox", { name: "Editor content" }).locator('span[data-text-color="#E03E3E"]');
  await colored.waitFor();
  await page.keyboard.press("End");
  await step("text-colored");

  let row = [];
  for (let i = 0; i < 30; i++) {
    row = psql(`select strpos(content::text, '"text_color"') > 0 from documents where title = ${literal(title)}`);
    if (row[0] === "t") break;
    await page.waitForTimeout(1000);
  }
  log("db text_color:", row);
  if (row[0] !== "t") throw new Error("text color not persisted");

  // 2. Markdown source: open from the document menu, edit, save.
  await click(page.getByRole("button", { name: "Document options" }));
  await click(page.getByRole("menuitem", { name: "Edit as Markdown" }));
  const source = page.getByRole("textbox", { name: "Markdown" });
  await source.waitFor();
  await page.waitForFunction(() => {
    const el = document.querySelector('textarea[aria-label="Markdown"]');
    return el && el.value.includes("colored");
  });
  const before = await source.inputValue();
  log("markdown before:", JSON.stringify(before));
  if (before.startsWith("# ")) throw new Error("title heading was not stripped");
  await step("markdown-dialog");
  await source.fill(`${before}\n\n## Added from Markdown\n\n- point one\n- point two\n`);
  await step("markdown-edited");
  await click(page.getByRole("button", { name: "Save" }));
  await page.getByRole("textbox", { name: "Editor content" }).getByRole("heading", { name: "Added from Markdown" }).waitFor({ timeout: 20000 });
  await step("markdown-applied-live");

  // 3. Word export from the document menu.
  await click(page.getByRole("button", { name: "Document options" }));
  // Navigate the submenu with the keyboard, as moving the pointer across
  // the parent menu closes the submenu in headless Chromium.
  await page.getByRole("menuitem", { name: "Export" }).focus();
  await page.keyboard.press("ArrowRight");
  const wordItem = page.getByRole("menuitem", { name: /Word/ });
  await wordItem.waitFor();
  for (let i = 0; i < 6; i++) {
    if (await wordItem.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("ArrowDown");
  }
  await step("export-menu-with-word");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    page.keyboard.press("Enter"),
  ]);
  const file = path.join(process.env.TMPDIR ?? "/tmp", download.suggestedFilename());
  await download.saveAs(file);
  const head = fs.readFileSync(file).subarray(0, 2).toString();
  const xml = execFileSync("unzip", ["-p", file, "word/document.xml"], { encoding: "utf8" });
  log("docx:", download.suggestedFilename(), fs.statSync(file).size, "bytes");
  if (head !== "PK") throw new Error("download is not a zip/docx");
  for (const needle of [title, "Added from Markdown", "point two"]) {
    if (!xml.includes(needle)) throw new Error(`docx misses ${needle}`);
  }
  log("docx has heading style:", xml.includes('w:val="Heading2"'), "numbering:", xml.includes("<w:numPr>"));

  return { title, docx: download.suggestedFilename() };
};
