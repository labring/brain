"use client";

import { type CSSProperties, useMemo, useSyncExternalStore } from "react";

import { useDevTweaksStore } from "./provider";
import type { DevTweaksStore } from "./store";
import type { DevTweaksActiveEntry } from "./types";

export interface DevTweaksIndicatorProps {
  /**
   * Demo builds: keep the capsule present and clickable even with no active
   * overrides — there it is the only way to summon the panel.
   */
  alwaysVisible?: boolean;
  /** Host bridge variables, same contract as the panel `style` prop. */
  style?: CSSProperties;
}

interface IndicatorSummary {
  hasMock: boolean;
  label: string;
}

/**
 * What the capsule says, given the active override entries. Single mock →
 * `MOCK · <scenario>`; several → `MOCK ×N`; tweaks only → `N override(s)`.
 */
function summarize(
  entries: readonly DevTweaksActiveEntry[]
): IndicatorSummary | null {
  if (entries.length === 0) {
    return null;
  }
  const mockGroups = new Map<string, DevTweaksActiveEntry[]>();
  for (const entry of entries) {
    if (entry.groupDef.kind !== "mock") {
      continue;
    }
    const group = mockGroups.get(entry.groupKey);
    if (group) {
      group.push(entry);
    } else {
      mockGroups.set(entry.groupKey, [entry]);
    }
  }
  if (mockGroups.size > 1) {
    return { hasMock: true, label: `MOCK ×${mockGroups.size}` };
  }
  if (mockGroups.size === 1) {
    const [group] = mockGroups.values();
    const scenario = group?.find(
      (entry) => entry.controlDef.type === "select"
    )?.value;
    const detail = scenario ?? group?.[0]?.groupDef.feature;
    return { hasMock: true, label: `MOCK · ${String(detail)}` };
  }
  return {
    hasMock: false,
    label: `${entries.length} override${entries.length === 1 ? "" : "s"}`,
  };
}

/**
 * Bottom-left text capsule — the global dirty indicator. Lights whenever the
 * "Active" section is non-empty, hides while the panel is open, and clicking
 * it opens the panel (last-used mode) landed on the "Active" section.
 */
export function DevTweaksIndicator(props: DevTweaksIndicatorProps) {
  const store = useDevTweaksStore();
  if (!store) {
    return null;
  }
  return <IndicatorCapsule store={store} {...props} />;
}

function IndicatorCapsule({
  alwaysVisible = false,
  store,
  style,
}: DevTweaksIndicatorProps & { store: DevTweaksStore }) {
  const open = useSyncExternalStore(
    store.subscribe,
    store.isOpen,
    store.isOpen
  );
  const entries = useSyncExternalStore(
    store.subscribe,
    store.getActiveEntries,
    store.getActiveEntries
  );
  const summary = useMemo(() => summarize(entries), [entries]);

  // While the panel is open, the "Active" section itself is the indicator.
  if (open || (summary === null && !alwaysVisible)) {
    return null;
  }

  return (
    <button
      className="dtp-skin dtp-capsule"
      data-mock={summary?.hasMock ? "true" : undefined}
      onClick={() => store.requestActiveFocus()}
      style={style}
      title="Open dev tweaks"
      type="button"
    >
      <span aria-hidden className="dtp-capsule-dot" />
      {summary?.label ?? "Dev tweaks"}
    </button>
  );
}
