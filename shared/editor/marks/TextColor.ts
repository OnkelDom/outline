import { parseToRgb } from "polished";
import type { MarkSpec } from "prosemirror-model";
import Mark from "./Mark";
import type { PresetColor } from "@shared/utils/color";
import { toHexColor, validateColorHex } from "@shared/utils/color";

/**
 * A mark that changes the color of text. Colors are stored as hex values on
 * the mark so that they survive copy, paste and export to HTML or Word.
 */
export default class TextColor extends Mark {
  /** Preset colors offered for text, chosen to be legible in light and dark themes. */
  static presetColors: PresetColor[] = [
    { hex: "#E03E3E", name: "Red" },
    { hex: "#D9730D", name: "Orange" },
    { hex: "#C29B00", name: "Yellow" },
    { hex: "#2E9D5B", name: "Green" },
    { hex: "#2F80ED", name: "Blue" },
    { hex: "#9B51E0", name: "Purple" },
    { hex: "#8A8A8A", name: "Gray" },
  ];

  /**
   * Checks if a color is one of the text color presets.
   *
   * @param color a hex color string to check.
   * @returns true if the color matches a preset color's hex value.
   */
  static isPresetColor(color: string): boolean {
    return TextColor.presetColors.some((c) => c.hex === color);
  }

  get name() {
    return "text_color";
  }

  get schema(): MarkSpec {
    return {
      attrs: {
        color: {
          default: null,
          validate: "string|null",
        },
      },
      excludes: "text_color",
      parseDOM: [
        {
          tag: "span[data-text-color]",
          getAttrs: (dom) => {
            const color = dom.getAttribute("data-text-color") || "";
            return validateColorHex(color) ? { color } : false;
          },
        },
        {
          tag: "font[color]",
          getAttrs: (dom) => {
            const color = toHexColor(dom.getAttribute("color") || "");
            return color ? { color: color.toUpperCase() } : false;
          },
        },
        {
          tag: "span[style]",
          consuming: false,
          getAttrs: (dom) => {
            const style = dom.style?.color;
            if (!style) {
              return false;
            }

            // Black and near-black text is the default color of most sources,
            // so it is not kept as explicit styling.
            try {
              const { red, green, blue } = parseToRgb(style);
              if (Math.max(red, green, blue) < 90) {
                return false;
              }
            } catch {
              return false;
            }

            const color = toHexColor(style);
            return color ? { color: color.toUpperCase() } : false;
          },
        },
      ],
      toDOM: (mark) => {
        const color = validateColorHex(mark.attrs.color ?? "")
          ? mark.attrs.color
          : null;

        return [
          "span",
          {
            "data-text-color": color,
            style: color ? `color: ${color}` : undefined,
          },
        ];
      },
    };
  }

  toMarkdown() {
    // Markdown has no syntax for text color, the text is kept without it.
    return {
      open: "",
      close: "",
      mixable: true,
      expelEnclosingWhitespace: true,
    };
  }
}
