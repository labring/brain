export const PROJECT_SURFACE_MOTION_ENTER_DURATION_VAR =
  "--project-surface-motion-enter-duration";
export const PROJECT_SURFACE_MOTION_EXIT_DURATION_VAR =
  "--project-surface-motion-exit-duration";

export const PROJECT_SURFACE_MOTION_EXIT_FALLBACK_MS = 340;

function parseMotionDuration(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  if (trimmed.endsWith("ms")) {
    return numeric;
  }
  if (trimmed.endsWith("s")) {
    return numeric * 1000;
  }
  return numeric;
}

export function projectSurfaceMotionMs(
  cssVar = PROJECT_SURFACE_MOTION_EXIT_DURATION_VAR,
  fallbackMs = PROJECT_SURFACE_MOTION_EXIT_FALLBACK_MS
): number {
  if (typeof window === "undefined") {
    return fallbackMs;
  }

  const duration = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(cssVar);

  return parseMotionDuration(duration) ?? fallbackMs;
}
