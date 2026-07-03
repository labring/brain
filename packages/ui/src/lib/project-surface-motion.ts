export const PROJECT_SURFACE_MOTION_DURATION_VAR =
  "--project-surface-motion-duration";

export const PROJECT_SURFACE_MOTION_FALLBACK_MS = 280;

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

export function projectSurfaceMotionMs(): number {
  if (typeof window === "undefined") {
    return PROJECT_SURFACE_MOTION_FALLBACK_MS;
  }

  const duration = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(PROJECT_SURFACE_MOTION_DURATION_VAR);

  return parseMotionDuration(duration) ?? PROJECT_SURFACE_MOTION_FALLBACK_MS;
}
