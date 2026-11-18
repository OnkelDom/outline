interface Props {
  /** The size of the icon, 24px is default to match standard icons. */
  size?: number;
  /** The color of the bar below the letter, defaults to the current text color. */
  color?: string;
}

/**
 * An icon showing the letter "A" above a bar in the given color, used for the
 * text color control in the formatting toolbar.
 *
 * @param props the icon props.
 * @returns the icon element.
 */
export function TextColorIcon({ size = 24, color = "currentColor" }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      version="1.1"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M11.1 5h1.8l4.1 10.5h-2l-1-2.7H10l-1 2.7H7L11.1 5Zm-.5 6.1h2.8L12 7.3l-1.4 3.8Z"
      />
      <rect
        x="6"
        y="17.5"
        width="12"
        height="2.5"
        rx="1"
        style={{ fill: color }}
      />
    </svg>
  );
}
