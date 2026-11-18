type Props = {
  /** The size of the icon, 24px is default to match standard icons */
  size?: number;
  /** The color of the icon, defaults to the current text color */
  fill?: string;
};

/**
 * A branch icon that represents Git sync.
 */
export default function Icon({ size = 24, fill = "currentColor" }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={fill}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="6" r="2" />
      <circle cx="8" cy="18" r="2" />
      <circle cx="16" cy="9" r="2" />
      <path d="M8 8v8" />
      <path d="M16 11c0 3-3 4-8 5" />
    </svg>
  );
}
