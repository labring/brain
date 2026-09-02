import {
  type BrandMarkKey,
  brandMarkPaths,
} from "@workspace/ui/assets/brand-marks";
import { cn } from "@workspace/ui/lib/utils";

/**
 * A monochrome brand glyph that tints with `currentColor`, so active and
 * muted states are plain text-color classes — no filter tricks.
 */
export function BrandMark({
  brandKey,
  className,
}: {
  brandKey: BrandMarkKey;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      className={cn("size-4 shrink-0 fill-current", className)}
      viewBox="0 0 24 24"
    >
      <title>{brandKey}</title>
      <path d={brandMarkPaths[brandKey]} />
    </svg>
  );
}
