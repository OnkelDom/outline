import JSZip from "jszip";
import { parser, schema } from "@server/editor";
import { DocxHelper } from "./DocxHelper";

/**
 * Converts a document to Word and returns the XML of its main part.
 */
async function toDocumentXml(markdown: string, title = "Title") {
  const doc = parser.parse(markdown);
  if (!doc) {
    throw new Error("Failed to parse markdown");
  }
  const buffer = await DocxHelper.toDocx(doc, { title });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")?.async("string");
  return { buffer, xml: xml ?? "", zip };
}

describe("DocxHelper", () => {
  it("creates a valid Word package", async () => {
    const { buffer, zip } = await toDocumentXml("Hello world");

    // A .docx file is a zip archive, starting with the "PK" signature.
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    expect(zip.file("[Content_Types].xml")).toBeTruthy();
    expect(zip.file("word/numbering.xml")).toBeTruthy();
  });

  it("writes the title and headings with Word heading styles", async () => {
    const { xml } = await toDocumentXml("# First\n\n## Second\n\nBody", "Doc");

    expect(xml).toContain('<w:pStyle w:val="Title"/>');
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(xml).toContain('<w:pStyle w:val="Heading2"/>');
    expect(xml).toContain(">First<");
    expect(xml).toContain(">Body<");
  });

  it("keeps inline formatting", async () => {
    const { xml } = await toDocumentXml(
      "**bold** *italic* ~~strike~~ `code` [link](https://example.com)"
    );

    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("<w:i/>");
    expect(xml).toContain("<w:strike/>");
    expect(xml).toContain('w:ascii="Consolas"');
    expect(xml).toContain("<w:hyperlink");
  });

  it("writes text colors and highlights", async () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text("red", [
          schema.marks.text_color.create({ color: "#E03E3E" }),
        ]),
        schema.text("marked", [
          schema.marks.highlight.create({ color: "#FDEA9B" }),
        ]),
      ]),
    ]);
    const buffer = await DocxHelper.toDocx(doc, { title: "" });
    const zip = await JSZip.loadAsync(buffer);
    const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";

    expect(xml).toContain('<w:color w:val="E03E3E"/>');
    expect(xml).toContain('w:fill="FDEA9B"');
  });

  it("writes bulleted, numbered and nested lists", async () => {
    const { xml } = await toDocumentXml(
      "- one\n  - nested\n- two\n\n1. first\n2. second"
    );

    expect(xml).toContain("<w:numPr>");
    expect(xml).toContain('<w:ilvl w:val="1"/>');
    expect(xml).toContain(">nested<");
    expect(xml).toContain(">second<");
  });

  it("writes checklists with check boxes", async () => {
    const { xml } = await toDocumentXml("- [x] done\n- [ ] open");

    expect(xml).toContain("☑ ");
    expect(xml).toContain("☐ ");
  });

  it("writes tables as Word tables", async () => {
    const { xml } = await toDocumentXml(
      "| Name | Value |\n| --- | --- |\n| a | 1 |\n| b | 2 |"
    );

    expect(xml).toContain("<w:tbl>");
    expect((xml.match(/<w:tr>/g) ?? []).length).toBe(3);
    expect(xml).toContain(">Value<");
  });

  it("writes code blocks in a monospace font", async () => {
    const { xml } = await toDocumentXml(
      "```js\nconst a = 1;\nconst b = 2;\n```"
    );

    expect(xml).toContain('w:ascii="Consolas"');
    expect(xml).toContain(">const a = 1;<");
    expect(xml).toContain("<w:br/>");
  });

  it("falls back to a link for images that cannot be embedded", async () => {
    const { xml } = await toDocumentXml(
      "![diagram](https://example.com/a.png)"
    );

    expect(xml).toContain("<w:hyperlink");
    expect(xml).not.toContain("<w:drawing>");
  });
});

describe("DocxHelper.imageSize", () => {
  it("reads the size of a PNG", () => {
    const png = Buffer.alloc(32);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);

    expect(DocxHelper.imageSize(png)).toEqual({ width: 640, height: 480 });
  });

  it("returns undefined for unknown data", () => {
    expect(DocxHelper.imageSize(Buffer.alloc(32))).toBeUndefined();
  });
});
