"use client";

import { type DevTweaksGroupDef, useDevTweaks } from "@workspace/dev-tweaks";
import { atom, useAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";
import {
  DEMO_PROJECTS_DEFAULT_COUNT,
  DEMO_PROJECTS_DEFAULT_INITIAL_PINS,
  DEMO_PROJECTS_DEFAULT_SEED,
  DEMO_PROJECTS_MAX_COUNT,
  DEMO_PROJECTS_MOCK,
  type DemoProjectsDataset,
  generateDemoProjects,
} from "@/features/projects/demo/demo-projects";
import type { ProjectExplorerProject } from "@/features/projects/explorer/project-explorer.types";
import {
  MAX_PINNED_PROJECTS,
  type PinnedProjectIdResult,
  prunePinnedProjectIds,
  type TogglePinnedProjectIdStatus,
  togglePinnedProjectId,
} from "@/features/projects/pinned-projects";
import type { ProjectShortcutIconKeyMap } from "@/features/projects/project-shortcut-icons";

const DEMO_PROJECTS_TWEAKS = {
  controls: {
    // Build-time default: demo builds (NEXT_PUBLIC_DEMO_MOCK=1) open with the
    // mock already on, so viewers never have to find this switch; everywhere
    // else it starts off and the panel is the way in.
    enabled: {
      label: "Mock data",
      type: "switch",
      value: DEMO_PROJECTS_MOCK,
    },
    initialPins: {
      label: "Initial pins (changing resets manual pins)",
      max: MAX_PINNED_PROJECTS,
      min: 0,
      step: 1,
      type: "slider",
      value: DEMO_PROJECTS_DEFAULT_INITIAL_PINS,
    },
    projectCount: {
      label: "Projects",
      max: DEMO_PROJECTS_MAX_COUNT,
      min: 0,
      step: 1,
      type: "slider",
      value: DEMO_PROJECTS_DEFAULT_COUNT,
    },
    seed: {
      label: "Data seed (change to regenerate)",
      step: 1,
      type: "number",
      value: DEMO_PROJECTS_DEFAULT_SEED,
    },
  },
  feature: "projects",
  kind: "mock",
  note: "Generated dataset for the sidebar and project explorer, replacing every remote read while on. Deterministic: growing the count appends rows without reshuffling, so pins survive; changing the seed rebuilds the dataset and resets pins. Pin/unpin stays live on the explorer rows.",
  title: "Demo · Project data",
} as const satisfies DevTweaksGroupDef;

interface DemoPinnedState {
  /** `${seed}:${initialPins}` the ids were captured under. */
  basis: string;
  ids: string[];
}

const DEMO_PINS_STORAGE_KEY = "demo-projects.pins.v1";

/** Shared across the sidebar and the explorer via the app's default store. */
const demoPinnedAtom = atom<DemoPinnedState | null>(null);
let demoPinnedHydrated = false;

const EMPTY_DATASET: DemoProjectsDataset = {
  iconKeys: new Map(),
  projects: [],
};

function readStoredDemoPins(): DemoPinnedState | null {
  try {
    const raw = window.sessionStorage.getItem(DEMO_PINS_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") {
      return null;
    }
    const candidate = parsed as { basis?: unknown; ids?: unknown };
    if (typeof candidate.basis !== "string" || !Array.isArray(candidate.ids)) {
      return null;
    }
    return {
      basis: candidate.basis,
      ids: candidate.ids.filter((id): id is string => typeof id === "string"),
    };
  } catch {
    return null;
  }
}

function writeStoredDemoPins(state: DemoPinnedState): void {
  try {
    window.sessionStorage.setItem(DEMO_PINS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Session persistence is best-effort; the in-memory atom still works.
  }
}

export interface DemoProjectsMockModel {
  pinnedProjectIds: readonly string[];
  projectShortcutIconKeys: ProjectShortcutIconKeyMap;
  projects: ProjectExplorerProject[];
  togglePinnedProject: (
    projectId: string
  ) => Promise<PinnedProjectIdResult<TogglePinnedProjectIdStatus>>;
}

/**
 * Demo data source for the projects read model, switchable at runtime from
 * the dev tweaks panel ("Demo · Project data" › "Mock data"). Returns the
 * generated model while the switch is on and `null` while it is off. In
 * builds without the panel the hook is inert and only a demo build's baked-in
 * default (`NEXT_PUBLIC_DEMO_MOCK=1`) can turn it on.
 */
export function useDemoProjectsMock(): DemoProjectsMockModel | null {
  const { values } = useDevTweaks("demo-projects", DEMO_PROJECTS_TWEAKS);
  const enabled = values.enabled;
  const count = Math.round(values.projectCount);
  const initialPins = Math.round(values.initialPins);
  const seed = Math.trunc(values.seed);
  const [stored, setStored] = useAtom(demoPinnedAtom);

  useEffect(() => {
    if (!enabled || demoPinnedHydrated) {
      return;
    }
    demoPinnedHydrated = true;
    const fromStorage = readStoredDemoPins();
    if (fromStorage !== null) {
      setStored(fromStorage);
    }
  }, [enabled, setStored]);

  const { iconKeys, projects } = useMemo(
    () => (enabled ? generateDemoProjects({ count, seed }) : EMPTY_DATASET),
    [count, enabled, seed]
  );

  const basis = `${seed}:${initialPins}`;
  const pinnedProjectIds = useMemo(() => {
    const source =
      stored !== null && stored.basis === basis
        ? stored.ids
        : projects.slice(0, initialPins).map((project) => project.id);
    return prunePinnedProjectIds(
      source,
      new Set(projects.map((project) => project.id))
    );
  }, [basis, initialPins, projects, stored]);

  const togglePinnedProject = useCallback(
    (projectId: string) => {
      const result = togglePinnedProjectId(pinnedProjectIds, projectId);
      if (result.status === "added" || result.status === "removed") {
        const next = { basis, ids: result.ids };
        setStored(next);
        writeStoredDemoPins(next);
      }
      return Promise.resolve(result);
    },
    [basis, pinnedProjectIds, setStored]
  );

  return useMemo(
    () =>
      enabled
        ? {
            pinnedProjectIds,
            projectShortcutIconKeys: iconKeys,
            projects,
            togglePinnedProject,
          }
        : null,
    [enabled, iconKeys, pinnedProjectIds, projects, togglePinnedProject]
  );
}
