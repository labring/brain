/** Crossplane / Kubernetes-style service phases mapped to Tailwind text colors. */
export const STATUS_PHASES = {
  // Ready / healthy
  running: "text-green-500",
  succeeded: "text-green-500",
  complete: "text-green-500",
  available: "text-green-500",
  bound: "text-green-500",
  ready: "text-green-500",
  // In progress / waiting
  pending: "text-amber-500",
  creating: "text-amber-500",
  binding: "text-amber-500",
  progressing: "text-amber-500",
  restarting: "text-amber-500",
  starting: "text-amber-500",
  stopping: "text-amber-500",
  updating: "text-amber-500",
  unknown: "text-amber-500",
  // Stopped / paused
  stopped: "text-violet-500",
  paused: "text-violet-500",
  shutdown: "text-violet-500",
  // Error / failed
  failed: "text-red-500",
  error: "text-red-500",
  deleting: "text-red-500",
  unavailable: "text-red-500",
  degraded: "text-red-500",
} as const;

export type CrossplaneServiceStatusPhase = keyof typeof STATUS_PHASES;

/** Indicator dot backgrounds aligned with each phase color. */
export const STATUS_PHASE_INDICATORS = {
  running: "bg-green-500",
  succeeded: "bg-green-500",
  complete: "bg-green-500",
  available: "bg-green-500",
  bound: "bg-green-500",
  ready: "bg-green-500",
  pending: "bg-amber-500",
  creating: "bg-amber-500",
  binding: "bg-amber-500",
  progressing: "bg-amber-500",
  restarting: "bg-amber-500",
  starting: "bg-amber-500",
  stopping: "bg-amber-500",
  updating: "bg-amber-500",
  unknown: "bg-amber-500",
  stopped: "bg-violet-500",
  paused: "bg-violet-500",
  shutdown: "bg-violet-500",
  failed: "bg-red-500",
  error: "bg-red-500",
  deleting: "bg-red-500",
  unavailable: "bg-red-500",
  degraded: "bg-red-500",
} as const satisfies Record<CrossplaneServiceStatusPhase, string>;
