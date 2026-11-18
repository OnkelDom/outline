import { DOMParser, DOMSerializer } from "prosemirror-model";
import { schema } from "@shared/test/editor";

/**
 * Parses an HTML string with the editor schema, in the same way as pasted
 * content, and returns the resulting document as JSON.
 */
function parseHTML(html: string) {
  const element = document.createElement("div");
  element.innerHTML = html;
  return DOMParser.fromSchema(schema).parse(element).toJSON();
}

// Parsing HTML requires a DOM.
describe.runIf(typeof document !== "undefined")("text color", () => {
  it("parses its own markup", () => {
    const doc = parseHTML(
      `<p><span data-text-color="#E03E3E" style="color: #E03E3E">red</span></p>`
    );
    expect(doc.content[0].content[0].marks).toEqual([
      { type: "text_color", attrs: { color: "#E03E3E" } },
    ]);
  });

  it("parses inline colors from pasted content", () => {
    const doc = parseHTML(
      `<p><span style="color: rgb(47, 128, 237)">blue</span></p>`
    );
    expect(doc.content[0].content[0].marks).toEqual([
      { type: "text_color", attrs: { color: "#2F80ED" } },
    ]);
  });

  it("ignores default dark text", () => {
    const doc = parseHTML(
      `<p><span style="color: #111111">dark</span><span style="color: black">black</span></p>`
    );
    expect(doc.content[0].content[0].marks).toBeUndefined();
  });

  it("renders a span with the color", () => {
    const mark = schema.marks.text_color.create({ color: "#9B51E0" });
    const node = schema.text("purple", [mark]);
    const fragment = DOMSerializer.fromSchema(schema).serializeFragment(
      schema.nodes.paragraph.create(null, node).content
    );
    const element = document.createElement("div");
    element.appendChild(fragment);

    const span = element.querySelector("span");
    expect(span?.getAttribute("data-text-color")).toBe("#9B51E0");
    expect(span?.style.color).toBe("rgb(155, 81, 224)");
    expect(span?.textContent).toBe("purple");
  });

  it("allows only one color at a time", () => {
    const red = schema.marks.text_color.create({ color: "#E03E3E" });
    const blue = schema.marks.text_color.create({ color: "#2F80ED" });

    expect(blue.addToSet([red])).toEqual([blue]);
  });
});
