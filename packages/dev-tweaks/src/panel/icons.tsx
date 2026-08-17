interface IconProps {
  size?: number;
}

function svgProps(size: number) {
  return {
    fill: "none",
    height: size,
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 1.5,
    viewBox: "0 0 16 16",
    width: size,
  } as const;
}

export function IconChevron({ size = 12 }: IconProps) {
  return (
    <svg aria-hidden="true" {...svgProps(size)}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export function IconClose({ size = 13 }: IconProps) {
  return (
    <svg aria-hidden="true" {...svgProps(size)}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

/** Panel docked as a right-side strip (frame mode). */
export function IconDock({ size = 13 }: IconProps) {
  return (
    <svg aria-hidden="true" {...svgProps(size)}>
      <rect height="10" rx="1.5" width="12" x="2" y="3" />
      <path d="M10 3v10" />
    </svg>
  );
}

/** Detached floating window. */
export function IconFloat({ size = 13 }: IconProps) {
  return (
    <svg aria-hidden="true" {...svgProps(size)}>
      <rect height="10" rx="1.5" width="12" x="2" y="3" />
      <rect
        fill="currentColor"
        height="4"
        rx="0.5"
        stroke="none"
        width="5"
        x="7.5"
        y="7"
      />
    </svg>
  );
}

export function IconReset({ size = 12 }: IconProps) {
  return (
    <svg aria-hidden="true" {...svgProps(size)}>
      <path d="M3 8a5 5 0 1 0 1.5-3.6" />
      <path d="M3 2.5V5h2.5" />
    </svg>
  );
}
