import yaml from "js-yaml";
import { escapeRegExp } from "es-toolkit/compat";

/**
 * The metadata written to the frontmatter of every synchronized file.
 */
export interface GitFrontmatter {
  /** The Outline document ID, used to match the file to its document. */
  id?: string;
  title?: string;
  url?: string;
  collection?: string;
  parent?: string | null;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
  /** Any other keys, which are kept as they are. */
  [key: string]: unknown;
}

/**
 * A synchronized file split into its parts.
 */
export interface ParsedGitFile {
  frontmatter: GitFrontmatter;
  /** The title from the first level one heading, if the body starts with one. */
  heading?: string;
  /** The Markdown body without frontmatter and heading. */
  body: string;
}

const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const headingRegex = /^#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/;

/**
 * Converts between Outline documents and the Markdown files in a repository.
 */
export class GitMarkdown {
  /**
   * Builds the content of a file for a document.
   *
   * @param frontmatter The metadata of the document.
   * @param title The document title, written as the first heading.
   * @param body The document as Markdown, without title.
   * @returns The file content.
   */
  public static serialize(
    frontmatter: GitFrontmatter,
    title: string,
    body: string
  ): string {
    const meta = yaml.dump(frontmatter, {
      lineWidth: -1,
      noRefs: true,
      skipInvalid: true,
    });
    const text = body.trim();
    return `---\n${meta}---\n\n# ${title}\n${text ? `\n${text}\n` : ""}`;
  }

  /**
   * Splits a file into frontmatter, heading and body. Files without
   * frontmatter are accepted, so that documents can be added in Git.
   *
   * @param content The file content.
   * @returns The parts of the file.
   */
  public static parse(content: string): ParsedGitFile {
    let rest = content.replace(/^﻿/, "");
    let frontmatter: GitFrontmatter = {};

    const match = rest.match(frontmatterRegex);
    if (match) {
      try {
        const data = yaml.load(match[1], { schema: yaml.CORE_SCHEMA });
        if (data && typeof data === "object" && !Array.isArray(data)) {
          frontmatter = { ...data };
        }
      } catch (_err) {
        // Invalid YAML is treated as part of the document body.
        frontmatter = {};
      }
      if (Object.keys(frontmatter).length) {
        rest = rest.slice(match[0].length);
      }
    }

    rest = rest.replace(/^\s*\n/, "");
    let heading: string | undefined;
    const headingMatch = rest.match(headingRegex);
    if (headingMatch) {
      heading = headingMatch[1].trim();
      rest = rest.slice(headingMatch[0].length);
    }

    if (frontmatter.id !== undefined) {
      frontmatter.id = String(frontmatter.id);
    }

    return { frontmatter, heading, body: rest.trim() };
  }

  /**
   * Rewrites links that only work inside Outline, such as attachments and
   * other documents, to absolute URLs so they work in a repository viewer.
   *
   * @param text The Markdown.
   * @param origin The URL of the team.
   * @returns The Markdown with absolute links.
   */
  public static toPortable(text: string, origin: string): string {
    return text.replace(
      /(\]\(|<|\s|^)(\/(?:api\/attachments\.redirect|doc\/))/gm,
      (_match, prefix: string, url: string) => `${prefix}${origin}${url}`
    );
  }

  /**
   * Reverts `toPortable`, making links to the team relative again.
   *
   * @param text The Markdown.
   * @param origin The URL of the team.
   * @returns The Markdown with relative links.
   */
  public static fromPortable(text: string, origin: string): string {
    return text.replace(
      new RegExp(
        `${escapeRegExp(origin)}(/(?:api/attachments\\.redirect|doc/))`,
        "g"
      ),
      "$1"
    );
  }

  /**
   * Normalizes Markdown for comparison, so that whitespace differences do not
   * count as changes.
   *
   * @param text The Markdown.
   * @returns The normalized Markdown.
   */
  public static normalize(text: string): string {
    return text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
}
