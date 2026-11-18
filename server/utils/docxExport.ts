import contentDisposition from "content-disposition";
import type { Context } from "koa";
import env from "@server/env";
import type { Document, Revision } from "@server/models";
import { Attachment } from "@server/models";
import AttachmentHelper from "@server/models/helpers/AttachmentHelper";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import type { DocxImage } from "@server/utils/DocxHelper";
import { DocxHelper } from "@server/utils/DocxHelper";
import slugify from "@server/utils/slugify";

/**
 * Whether the Accept header of a request asks for a Word document.
 *
 * @param accept the value of the Accept header.
 * @returns true if a .docx file was requested.
 */
export function acceptsDocx(accept: string | undefined): boolean {
  return !!accept?.includes(DocxHelper.contentType);
}

/**
 * Respond to a request with a document or revision converted to Word, with
 * the images it references embedded in the file.
 *
 * @param ctx the request context.
 * @param source the document or revision to export.
 * @param options the team that owns the content and the title to use.
 */
export async function sendDocx(
  ctx: Context,
  source: Document | Revision,
  options: { teamId: string; title: string }
): Promise<void> {
  const doc = DocumentHelper.toProsemirror(source);
  const attachmentIds = ProsemirrorHelper.parseAttachmentIds(doc);
  const attachments = attachmentIds.length
    ? await Attachment.findAll({
        where: { teamId: options.teamId, id: attachmentIds },
      })
    : [];

  const images = new Map<string, DocxImage>();
  for (const attachment of attachments) {
    if (!attachment.contentType.startsWith("image/")) {
      continue;
    }
    images.set(attachment.id, {
      buffer: await AttachmentHelper.readBuffer(attachment),
      contentType: attachment.contentType,
    });
  }

  const buffer = await DocxHelper.toDocx(doc, {
    title: options.title,
    images,
    baseUrl: env.URL,
  });

  ctx.set("Content-Type", DocxHelper.contentType);
  ctx.set(
    "Content-Disposition",
    contentDisposition(`${slugify(options.title) || "document"}.docx`, {
      type: "attachment",
    })
  );
  ctx.body = buffer;
}
