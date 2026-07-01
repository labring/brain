import { BinaryScale, Quantity } from "@workspace/shared";

const GIBI = BinaryScale.Gibi;
const DEFAULT_MAX_GI = 100;

function toQuantity(size: string): Quantity | null {
  const trimmed = size.trim();
  if (trimmed === "") {
    return null;
  }
  try {
    return Quantity.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Parse any Kubernetes quantity string ("1Gi", "512Mi", "107374182400m") to a Gi
 * number with at most 2 decimals. Returns null for empty or unparseable input.
 */
export function parseStorageSizeToGi(size: string): number | null {
  const quantity = toQuantity(size);
  if (quantity === null) {
    return null;
  }
  const display = quantity.formatForDisplay({
    digits: 2,
    format: "BinarySI",
    scale: GIBI,
  });
  const parsed = Number(display.replace("Gi", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Canonical Kubernetes string for a Gi number — matches what the backend stores. */
export function storageSizeToCanonical(gi: number): string {
  return Quantity.parse(`${gi}Gi`).toString();
}

/**
 * True when `nextSize` is strictly smaller than `currentSize`. StatefulSet PVCs
 * can only grow, so a shrink must be rejected.
 */
export function isStorageShrink(
  nextSize: string,
  currentSize: string
): boolean {
  const next = toQuantity(nextSize);
  const current = toQuantity(currentSize);
  if (next === null || current === null) {
    return false;
  }
  return next.cmp(current) < 0;
}

/**
 * Upper bound in Gi for a size field: at least the default max, but never below
 * the current size so an already-large PVC can still be displayed and grown.
 */
export function maxGiForStorage(
  currentSize: string,
  fallbackMaxGi: number = DEFAULT_MAX_GI
): number {
  const currentGi = parseStorageSizeToGi(currentSize);
  if (currentGi === null) {
    return fallbackMaxGi;
  }
  return Math.max(fallbackMaxGi, Math.ceil(currentGi));
}
