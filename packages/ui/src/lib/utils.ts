import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// project-chrome-surface is a background utility (@utility in globals.css);
// registering it here lets it displace bg-* defaults (e.g. bg-sidebar) when
// merged after them, instead of both classes landing on the element.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "bg-color": ["project-chrome-surface"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
