import {
  AlignmentType,
  BorderStyle,
  Document as DocxDocument,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type {
  IParagraphOptions,
  IRunOptions,
  ParagraphChild,
  FileChild,
} from "docx";
import type { Mark, Node as ProsemirrorNode } from "prosemirror-model";
import { attachmentRedirectRegex } from "@shared/utils/ProsemirrorHelper";

/** An image that can be embedded into the Word document, keyed by attachment id. */
export interface DocxImage {
  /** The raw contents of the image file. */
  buffer: Buffer;
  /** The mime type of the image file. */
  contentType: string;
}

/** Options for converting a document to Word. */
export interface DocxOptions {
  /** The title of the document, written as the first heading. */
  title: string;
  /** Images that can be embedded, keyed by attachment id. */
  images?: Map<string, DocxImage>;
  /** The base URL used to make relative links absolute. */
  baseUrl?: string;
}

/**
 * Converts Prosemirror documents into Word (.docx) files. The conversion keeps
 * the structure of the document – headings, lists, tables, quotes, code, notices
 * and images – as native Word elements so that the result can be edited further.
 */
export class DocxHelper {
  /** The mime type of Word documents. */
  public static contentType =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  /** The maximum width of an embedded image, in pixels. */
  public static maxImageWidth = 600;

  /**
   * Convert a Prosemirror document into a Word document.
   *
   * @param doc the Prosemirror document node.
   * @param options the conversion options.
   * @returns a buffer with the contents of the .docx file.
   */
  public static async toDocx(
    doc: ProsemirrorNode,
    options: DocxOptions
  ): Promise<Buffer> {
    const converter = new DocxConverter(options);
    const children: FileChild[] = [];

    if (options.title) {
      children.push(
        new Paragraph({ text: options.title, heading: HeadingLevel.TITLE })
      );
    }

    children.push(...converter.blocks(doc));

    const file = new DocxDocument({
      creator: "Outline",
      title: options.title,
      styles: {
        default: {
          document: {
            run: { font: "Calibri", size: 22 },
          },
        },
      },
      numbering: {
        config: [
          {
            reference: DocxConverter.orderedReference,
            levels: Array.from({ length: 9 }, (_, level) => ({
              level,
              format: [
                LevelFormat.DECIMAL,
                LevelFormat.LOWER_LETTER,
                LevelFormat.LOWER_ROMAN,
              ][level % 3],
              text: `%${level + 1}.`,
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: 720 * (level + 1), hanging: 360 },
                },
              },
            })),
          },
        ],
      },
      sections: [{ children }],
    });

    return Packer.toBuffer(file);
  }

  /**
   * Read the pixel dimensions of a PNG, GIF or JPEG image.
   *
   * @param buffer the contents of the image file.
   * @returns the width and height, or undefined if they cannot be read.
   */
  public static imageSize(
    buffer: Buffer
  ): { width: number; height: number } | undefined {
    if (buffer.length < 24) {
      return undefined;
    }

    // PNG: the IHDR chunk follows the 8 byte signature.
    if (buffer.readUInt32BE(0) === 0x89504e47) {
      return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
      };
    }

    // GIF: logical screen size follows the 6 byte header.
    if (buffer.toString("ascii", 0, 3) === "GIF") {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }

    // JPEG: scan the segments for a start of frame marker.
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          return undefined;
        }
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        const isStartOfFrame =
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc;
        if (isStartOfFrame) {
          return {
            height: buffer.readUInt16BE(offset + 5),
            width: buffer.readUInt16BE(offset + 7),
          };
        }
        offset += 2 + length;
      }
    }

    return undefined;
  }
}

interface InlineContext {
  /** Whether the text is rendered in a monospace font. */
  monospace?: boolean;
}

interface BlockContext {
  /** The depth of list nesting, starting at 0 for top level lists. */
  listLevel: number;
  /** Indentation in twips applied by quotes and notices. */
  indent: number;
  /** Shading applied by notices, as a hex color without "#". */
  shading?: string;
  /** Whether paragraphs are inside a quote, which draws a left border. */
  quote?: boolean;
}

class DocxConverter {
  public static orderedReference = "outline-ordered";

  public constructor(options: DocxOptions) {
    this.options = options;
  }

  /**
   * Convert the children of a block node into Word block elements.
   *
   * @param node the node whose children are converted.
   * @param context the surrounding block context.
   * @returns the Word paragraphs and tables.
   */
  public blocks(
    node: ProsemirrorNode,
    context: BlockContext = { listLevel: 0, indent: 0 }
  ): FileChild[] {
    const result: FileChild[] = [];
    node.forEach((child) => {
      result.push(...this.block(child, context));
    });
    return result;
  }

  protected options: DocxOptions;

  private orderedInstance = 0;

  private block(node: ProsemirrorNode, context: BlockContext): FileChild[] {
    switch (node.type.name) {
      case "paragraph":
        return [this.paragraph(node, context)];

      case "heading": {
        const levels = [
          HeadingLevel.HEADING_1,
          HeadingLevel.HEADING_2,
          HeadingLevel.HEADING_3,
          HeadingLevel.HEADING_4,
          HeadingLevel.HEADING_5,
          HeadingLevel.HEADING_6,
        ];
        const level = Number(node.attrs.level) || 1;
        return [
          this.paragraph(node, context, {
            heading: levels[Math.min(Math.max(level, 1), 6) - 1],
          }),
        ];
      }

      case "bullet_list":
      case "ordered_list":
      case "checkbox_list":
        return this.list(node, context);

      case "blockquote":
        return this.blocks(node, {
          ...context,
          indent: context.indent + 360,
          quote: true,
        });

      case "container_notice": {
        const colors: Record<string, string> = {
          info: "E8F2FD",
          warning: "FDF1E3",
          success: "E6F6EC",
          tip: "F2EBFC",
        };
        return this.blocks(node, {
          ...context,
          indent: context.indent + 180,
          shading: colors[String(node.attrs.style)] ?? colors.info,
        });
      }

      case "container_toggle":
        return this.blocks(node, context);

      case "code_block":
      case "code_fence":
        return this.codeBlock(node.textContent, context);

      case "math_block":
        return this.codeBlock(node.textContent, context);

      case "hr":
        return [
          new Paragraph({
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 6,
                color: "BBBBBB",
                space: 1,
              },
            },
          }),
        ];

      case "table":
        return [this.table(node)];

      case "image":
        return [
          this.paragraph(node, context, undefined, [
            ...this.image(node),
            ...(node.attrs.alt
              ? [
                  new TextRun({
                    break: 1,
                    text: String(node.attrs.alt),
                    italics: true,
                  }),
                ]
              : []),
          ]),
        ];

      case "embed":
      case "video":
      case "attachment": {
        const href = String(node.attrs.href || node.attrs.src || "");
        const label = String(node.attrs.title || href);
        return [
          this.paragraph(node, context, undefined, [this.link(label, href)]),
        ];
      }

      default:
        if (node.isTextblock) {
          return [this.paragraph(node, context)];
        }
        if (node.isBlock && node.childCount) {
          return this.blocks(node, context);
        }
        return [];
    }
  }

  private paragraph(
    node: ProsemirrorNode,
    context: BlockContext,
    options?: Partial<IParagraphOptions>,
    children?: ParagraphChild[]
  ): Paragraph {
    return new Paragraph({
      ...this.paragraphStyle(context),
      ...options,
      children: children ?? this.inlines(node),
    });
  }

  private paragraphStyle(context: BlockContext): Partial<IParagraphOptions> {
    return {
      indent: context.indent ? { left: context.indent } : undefined,
      shading: context.shading
        ? { type: ShadingType.CLEAR, color: "auto", fill: context.shading }
        : undefined,
      border: context.quote
        ? {
            left: {
              style: BorderStyle.SINGLE,
              size: 18,
              color: "CCCCCC",
              space: 8,
            },
          }
        : undefined,
    };
  }

  private codeBlock(text: string, context: BlockContext): Paragraph[] {
    const lines = text.split("\n");
    return [
      new Paragraph({
        ...this.paragraphStyle(context),
        shading: { type: ShadingType.CLEAR, color: "auto", fill: "F4F4F4" },
        children: lines.map(
          (line, index) =>
            new TextRun({
              text: line,
              font: "Consolas",
              size: 20,
              break: index > 0 ? 1 : undefined,
            })
        ),
      }),
    ];
  }

  private list(node: ProsemirrorNode, context: BlockContext): FileChild[] {
    const result: FileChild[] = [];
    const isOrdered = node.type.name === "ordered_list";
    const isChecklist = node.type.name === "checkbox_list";
    const instance = isOrdered ? ++this.orderedInstance : 0;
    const level = Math.min(context.listLevel, 8);

    node.forEach((item) => {
      let isFirst = true;

      item.forEach((child) => {
        if (isFirst && child.isTextblock) {
          isFirst = false;

          const prefix = isChecklist
            ? [new TextRun({ text: item.attrs.checked ? "☑ " : "☐ " })]
            : [];

          result.push(
            new Paragraph({
              ...this.paragraphStyle(context),
              ...(isOrdered
                ? {
                    numbering: {
                      reference: DocxConverter.orderedReference,
                      level,
                      instance,
                    },
                  }
                : isChecklist
                  ? {
                      indent: {
                        left: context.indent + 360 * (level + 1),
                      },
                    }
                  : { bullet: { level } }),
              children: [...prefix, ...this.inlines(child)],
            })
          );
          return;
        }

        isFirst = false;
        if (
          child.type.name === "bullet_list" ||
          child.type.name === "ordered_list" ||
          child.type.name === "checkbox_list"
        ) {
          result.push(
            ...this.list(child, {
              ...context,
              listLevel: context.listLevel + 1,
            })
          );
          return;
        }

        result.push(
          ...this.block(child, {
            ...context,
            indent: context.indent + 720 * (level + 1),
          })
        );
      });
    });

    return result;
  }

  private table(node: ProsemirrorNode): Table {
    const rows: TableRow[] = [];

    node.forEach((row) => {
      const cells: TableCell[] = [];

      row.forEach((cell) => {
        const children = this.blocks(cell).filter(
          (child): child is Paragraph | Table =>
            child instanceof Paragraph || child instanceof Table
        );
        const background = this.cellBackground(cell);

        cells.push(
          new TableCell({
            children: children.length ? children : [new Paragraph({})],
            columnSpan: Number(cell.attrs.colspan) || 1,
            rowSpan: Number(cell.attrs.rowspan) || 1,
            shading: background
              ? { type: ShadingType.CLEAR, color: "auto", fill: background }
              : cell.type.name === "th"
                ? { type: ShadingType.CLEAR, color: "auto", fill: "F2F2F2" }
                : undefined,
          })
        );
      });

      rows.push(
        new TableRow({
          children: cells,
          tableHeader: row.firstChild?.type.name === "th",
        })
      );
    });

    return new Table({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
    });
  }

  private cellBackground(cell: ProsemirrorNode): string | undefined {
    const marks: unknown = cell.attrs.marks;
    if (!Array.isArray(marks)) {
      return undefined;
    }

    for (const mark of marks) {
      const color: unknown = mark?.attrs?.color;
      if (mark?.type === "background" && typeof color === "string") {
        return this.hex(color);
      }
    }
    return undefined;
  }

  private inlines(node: ProsemirrorNode, context: InlineContext = {}) {
    const result: ParagraphChild[] = [];

    node.forEach((child) => {
      if (child.type.name === "br") {
        result.push(new TextRun({ break: 1 }));
        return;
      }

      if (child.type.name === "image") {
        result.push(...this.image(child));
        return;
      }

      const text = child.isText
        ? (child.text ?? "")
        : child.type.name === "mention"
          ? `@${String(child.attrs.label ?? "")}`
          : (child.type.spec.leafText?.(child) ?? child.textContent);

      if (!text) {
        return;
      }

      const run = new TextRun({
        text,
        ...this.runStyle(child.marks, context),
      });

      const link = child.marks.find((mark) => mark.type.name === "link");
      const href =
        link?.attrs.href ??
        (child.type.name === "mention" ? child.attrs.href : undefined);

      if (typeof href === "string" && href) {
        result.push(
          new ExternalHyperlink({
            link: this.absoluteUrl(href),
            children: [run],
          })
        );
        return;
      }

      result.push(run);
    });

    return result;
  }

  private runStyle(
    marks: readonly Mark[],
    context: InlineContext
  ): IRunOptions {
    const style: {
      bold?: boolean;
      italics?: boolean;
      strike?: boolean;
      underline?: object;
      font?: string;
      color?: string;
      shading?: IRunOptions["shading"];
    } = {};

    if (context.monospace) {
      style.font = "Consolas";
    }

    for (const mark of marks) {
      switch (mark.type.name) {
        case "strong":
          style.bold = true;
          break;
        case "em":
          style.italics = true;
          break;
        case "strikethrough":
          style.strike = true;
          break;
        case "underline":
          style.underline = {};
          break;
        case "code_inline":
          style.font = "Consolas";
          style.shading = {
            type: ShadingType.CLEAR,
            color: "auto",
            fill: "F4F4F4",
          };
          break;
        case "highlight": {
          const fill = this.hex(String(mark.attrs.color ?? "#FDEA9B"));
          if (fill) {
            style.shading = { type: ShadingType.CLEAR, color: "auto", fill };
          }
          break;
        }
        case "text_color": {
          const color = this.hex(String(mark.attrs.color ?? ""));
          if (color) {
            style.color = color;
          }
          break;
        }
        case "link":
          style.color = "0563C1";
          style.underline = {};
          break;
        default:
          break;
      }
    }

    return style;
  }

  private image(node: ProsemirrorNode): ParagraphChild[] {
    const src = String(node.attrs.src ?? "");
    const id = new RegExp(attachmentRedirectRegex.source, "i").exec(src)?.groups
      ?.id;
    const image = id ? this.options.images?.get(id) : undefined;
    const type = this.imageType(image?.contentType);

    if (!image || !type || !image.buffer.length) {
      return src ? [this.link(String(node.attrs.alt || src), src)] : [];
    }

    const size = DocxHelper.imageSize(image.buffer);
    let width = Number(node.attrs.width) || size?.width || 400;
    let height =
      Number(node.attrs.height) ||
      (size ? (size.height / size.width) * width : 300);

    if (width > DocxHelper.maxImageWidth) {
      height = (height / width) * DocxHelper.maxImageWidth;
      width = DocxHelper.maxImageWidth;
    }

    return [
      new ImageRun({
        type,
        data: image.buffer,
        transformation: {
          width: Math.round(width),
          height: Math.round(height),
        },
        altText: node.attrs.alt
          ? {
              name: String(node.attrs.alt),
              description: String(node.attrs.alt),
              title: String(node.attrs.alt),
            }
          : undefined,
      }),
    ];
  }

  private imageType(
    contentType: string | undefined
  ): "png" | "jpg" | "gif" | "bmp" | undefined {
    switch (contentType) {
      case "image/png":
        return "png";
      case "image/jpeg":
      case "image/jpg":
        return "jpg";
      case "image/gif":
        return "gif";
      case "image/bmp":
        return "bmp";
      default:
        return undefined;
    }
  }

  private link(text: string, href: string) {
    return new ExternalHyperlink({
      link: this.absoluteUrl(href),
      children: [new TextRun({ text, color: "0563C1", underline: {} })],
    });
  }

  private absoluteUrl(href: string) {
    if (!this.options.baseUrl || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
      return href;
    }
    try {
      return new URL(href, this.options.baseUrl).toString();
    } catch {
      return href;
    }
  }

  private hex(color: string): string | undefined {
    const match = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(color.trim());
    if (match) {
      return match[1].toUpperCase();
    }
    const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color.trim());
    if (short) {
      return `${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
    }
    return undefined;
  }
}
