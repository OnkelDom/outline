import { GitMarkdown } from "./GitMarkdown";

describe("GitMarkdown", () => {
  describe("serialize and parse", () => {
    it("round trips frontmatter, title and body", () => {
      const content = GitMarkdown.serialize(
        { id: "abc", title: "Hello: World", tags: ["a", "b"] },
        "Hello: World",
        "Some **text**\n\n- item"
      );

      expect(content.startsWith("---\nid: abc\n")).toBe(true);
      expect(content).toContain("\n# Hello: World\n\nSome **text**");

      const parsed = GitMarkdown.parse(content);
      expect(parsed.frontmatter.id).toEqual("abc");
      expect(parsed.frontmatter.title).toEqual("Hello: World");
      expect(parsed.frontmatter.tags).toEqual(["a", "b"]);
      expect(parsed.heading).toEqual("Hello: World");
      expect(parsed.body).toEqual("Some **text**\n\n- item");
    });

    it("parses files without frontmatter", () => {
      const parsed = GitMarkdown.parse("# Title\n\nBody");
      expect(parsed.frontmatter).toEqual({});
      expect(parsed.heading).toEqual("Title");
      expect(parsed.body).toEqual("Body");
    });

    it("keeps dates in frontmatter as strings", () => {
      const parsed = GitMarkdown.parse(
        "---\nid: x\nupdatedAt: 2026-01-01T00:00:00.000Z\n---\n\nBody"
      );
      expect(parsed.frontmatter.updatedAt).toEqual("2026-01-01T00:00:00.000Z");
      expect(parsed.heading).toBeUndefined();
      expect(parsed.body).toEqual("Body");
    });

    it("treats invalid frontmatter as body", () => {
      const parsed = GitMarkdown.parse("---\n: [\n---\n\nBody");
      expect(parsed.frontmatter).toEqual({});
      expect(parsed.body).toContain("Body");
    });

    it("writes documents without body", () => {
      const content = GitMarkdown.serialize({ id: "x" }, "Empty", "");
      expect(content).toEqual("---\nid: x\n---\n\n# Empty\n");
      expect(GitMarkdown.parse(content).body).toEqual("");
    });
  });

  describe("portable links", () => {
    const origin = "https://wiki.example.com";

    it("makes internal links absolute and back", () => {
      const text =
        "[Doc](/doc/hello-abc123def4) ![img](/api/attachments.redirect?id=1) [ext](https://other.com/doc/x)";
      const portable = GitMarkdown.toPortable(text, origin);

      expect(portable).toContain(`[Doc](${origin}/doc/hello-abc123def4)`);
      expect(portable).toContain(
        `![img](${origin}/api/attachments.redirect?id=1)`
      );
      expect(portable).toContain("[ext](https://other.com/doc/x)");
      expect(GitMarkdown.fromPortable(portable, origin)).toEqual(text);
    });
  });

  describe("normalize", () => {
    it("ignores trailing whitespace and blank lines", () => {
      expect(GitMarkdown.normalize("a  \r\n\n\n\nb\n")).toEqual("a\n\nb");
    });
  });
});
