/** Maps 0–100% usage to Tailwind text color classes. */
export function usagePercentToneClass(value: number): string {
  if (!Number.isFinite(value)) {
    return "text-zinc-400";
  }
  if (value > 90) {
    return "text-red-500";
  }
  if (value >= 75) {
    return "text-amber-500";
  }
  return "text-green-500";
}

export function clampScale(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
