import { useCallback } from "react";
import ColorPicker from "@shared/components/ColorPicker";
import { useEditor } from "./EditorContext";

interface Props {
  /** The currently active color. */
  activeColor: string;
}

/**
 * A color picker that applies a custom text color to the selection.
 *
 * @param props the component props.
 * @returns the color picker element.
 */
export function TextColorPicker({ activeColor }: Props) {
  const { commands } = useEditor();

  const handleSelect = useCallback(
    (color: string) => {
      if (commands.text_color) {
        commands.text_color({ color });
      }
    },
    [commands]
  );

  return (
    <ColorPicker
      alpha={false}
      activeColor={activeColor}
      onSelect={handleSelect}
    />
  );
}
