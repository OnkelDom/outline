import JSZip from "jszip";
import { createContext } from "@server/context";
import { Revision } from "@server/models";
import { DocxHelper } from "@server/utils/DocxHelper";
import { buildDocument, buildUser } from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();

describe("Word export", () => {
  it("exports a document as .docx", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      title: "Quarterly report",
      text: "# Summary\n\n- first point\n- second point",
      userId: user.id,
      teamId: user.teamId,
    });

    const res = await server.post("/api/documents.export", user, {
      body: { id: document.id },
      headers: { accept: DocxHelper.contentType },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(DocxHelper.contentType);
    expect(res.headers.get("content-disposition")).toContain(
      "quarterly-report.docx"
    );

    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
    const xml = await zip.file("word/document.xml")?.async("string");
    expect(xml).toContain(">Quarterly report<");
    expect(xml).toContain(">second point<");
  });

  it("exports a single .docx even when the document has children", async () => {
    const user = await buildUser();
    const parent = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });
    await buildDocument({
      parentDocumentId: parent.id,
      collectionId: parent.collectionId,
      userId: user.id,
      teamId: user.teamId,
    });

    const res = await server.post("/api/documents.export", user, {
      body: { id: parent.id, includeChildDocuments: false },
      headers: { accept: DocxHelper.contentType },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(DocxHelper.contentType);
  });

  it("requires permission to download", async () => {
    const user = await buildUser();
    const document = await buildDocument();

    const res = await server.post("/api/documents.export", user, {
      body: { id: document.id },
      headers: { accept: DocxHelper.contentType },
    });

    expect(res.status).toBe(403);
  });

  it("exports a revision as .docx using its name", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      text: "Version text",
      userId: user.id,
      teamId: user.teamId,
    });
    const revision = await Revision.createFromDocument(
      createContext({ user }),
      document
    );
    revision.name = "Approved";
    await revision.save();

    const res = await server.post("/api/revisions.export", user, {
      body: { id: revision.id },
      headers: { accept: DocxHelper.contentType },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("approved.docx");
  });
});
