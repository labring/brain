"use client";

import {
  type DevTweaksMockSource,
  type DevTweaksMockState,
  useDevTweaks,
  useDevTweaksMock,
} from "@workspace/dev-tweaks";
import type { CanvasNodeVisualStatusTone } from "@workspace/ui/components/canvas-node/canvas-node.types";
import { useEffect } from "react";
import type { ProjectIconKey } from "@/features/projects/project-icons";
import type { ProjectExplorerProject } from "./project-explorer.types";
import {
  type ProjectsExplorerDevMockSnapshot,
  setProjectsExplorerDevMockSnapshot,
} from "./projects-explorer-dev-mock-store";

/**
 * The Project list's Dev Mock: replaces the projects read model with
 * generated fixture rows so the `/project` index and the App Sidebar can be
 * designed against any list size without a workspace behind them. Row count
 * comes from a companion tweak slider; the Mock Scenario picks the flavor —
 * `plain` is ordinary healthy rows, `edge` is long names, special characters
 * and every Project Aggregate Status tone. While enabled, rows are inert
 * (no navigation, no row actions) — the generated Projects do not exist.
 */

export const PROJECTS_DEV_MOCK_KEY = "projects-mock";

const PROJECTS_DEV_SCENARIOS = ["plain", "edge"] as const;

// In-memory source: the mock has no server side and nothing rewrites it
// behind the panel's back, so session-only module state is the whole truth.
let mockState: DevTweaksMockState | null = null;

const projectsDevMockSource: DevTweaksMockSource = {
  load: () => mockState,
  set: (state) => {
    mockState = state;
  },
};

const PLAIN_NAMES = [
  "api-server",
  "web-app",
  "landing",
  "docs-site",
  "pg-main",
  "redis-cache",
  "analytics",
  "auth-service",
  "image-worker",
  "billing-sync",
  "search-index",
  "cron-runner",
];

const PLAIN_DESCRIPTIONS = [
  "Public REST API and background jobs",
  "Customer-facing storefront",
  "",
  "Marketing pages and the blog",
  "Primary Postgres with nightly backups",
  "",
  "Event ingestion and dashboards",
];

// Ordinary rows stay healthy: mostly positive with the occasional progress
// or neutral dot, never negative — that's the edge scenario's job.
const PLAIN_TONES: readonly (CanvasNodeVisualStatusTone | undefined)[] = [
  "positive",
  "positive",
  "progress",
  "positive",
  "neutral",
  "positive",
  undefined,
  "positive",
];

const EDGE_NAMES = [
  "orchestrator-of-the-seven-seas-and-the-quarterly-revenue-forecast-pipeline-v2-final-FINAL",
  "数据中台 · 实时特征平台",
  "🚀 rocket-ship",
  "a",
  "UPPERCASE-PROJECT",
  "dots.and.dashes-and_underscores",
  "name with spaces",
  "<script>alert(1)</script>",
  "réservé-café-naïve",
];

const EDGE_DESCRIPTIONS = [
  "A description long enough to be truncated by every surface that renders it, including the one you have not thought about yet, because someone pasted a paragraph of meeting notes into the description field and nobody stopped them.",
  "带中文描述，混合 English words and 标点符号……",
  "",
  "🎉🎊✨ emoji-only-ish 🚨",
  "https://example.com/a/very/long/url/that/should/not/break/layout?with=query&params=true",
];

const EDGE_TONES: readonly (CanvasNodeVisualStatusTone | undefined)[] = [
  "positive",
  "negative",
  "progress",
  "warning",
  "neutral",
  undefined,
];

const ICON_POOL: readonly ProjectIconKey[] = [
  "docker",
  "go",
  "grafana",
  "java",
  "database",
  "elasticsearch",
  "etcd",
  "caddy",
];

// Fixed epoch so fixtures are deterministic across renders and reloads.
const BASE_CREATED_AT_MS = Date.UTC(2026, 7, 1, 12);
const CREATED_AT_STEP_MS = 9 * 60 * 60 * 1000;

function pick<T>(pool: readonly T[], index: number): T {
  return pool[index % pool.length] as T;
}

function fixtureName(names: readonly string[], index: number): string {
  const base = pick(names, index);
  const round = Math.floor(index / names.length);
  return round === 0 ? base : `${base}-${round + 1}`;
}

export function generateProjectsDevMockSnapshot(
  scenario: string,
  count: number
): ProjectsExplorerDevMockSnapshot {
  const edge = scenario === "edge";
  const names = edge ? EDGE_NAMES : PLAIN_NAMES;
  const descriptions = edge ? EDGE_DESCRIPTIONS : PLAIN_DESCRIPTIONS;
  const tones = edge ? EDGE_TONES : PLAIN_TONES;

  const projects: ProjectExplorerProject[] = [];
  const projectIconKeys = new Map<string, ProjectIconKey>();
  for (let index = 0; index < count; index++) {
    const id = `dev-mock-project-${index + 1}`;
    const status = pick(tones, index);
    projects.push({
      createdAt: new Date(
        BASE_CREATED_AT_MS - index * CREATED_AT_STEP_MS
      ).toISOString(),
      description: pick(descriptions, index),
      id,
      name: fixtureName(names, index),
      resourceName: id,
      ...(status === undefined ? {} : { status }),
    });
    // Every third row goes without an icon to exercise the fallback glyph.
    if (index % 3 !== 2) {
      projectIconKeys.set(id, pick(ICON_POOL, index));
    }
  }
  return { projectIconKeys, projects };
}

/**
 * The count slider registers only while the mock is enabled, so the tweak
 * section appears and disappears with the toggle.
 */
function ProjectsExplorerDevMockGenerator({ scenario }: { scenario: string }) {
  const { count } = useDevTweaks(
    "Project · list mock",
    { count: [8, 0, 200, 1] },
    { id: "projects-list-mock", persist: { storage: "sessionStorage" } }
  );

  useEffect(() => {
    setProjectsExplorerDevMockSnapshot(
      generateProjectsDevMockSnapshot(scenario, count)
    );
  }, [scenario, count]);

  useEffect(() => () => setProjectsExplorerDevMockSnapshot(null), []);

  return null;
}

/** Registers the mock while the `/project` shell is mounted; renders nothing. */
export function ProjectsExplorerDevMock() {
  const mock = useDevTweaksMock(PROJECTS_DEV_MOCK_KEY, {
    note: "Replaces the Project list with generated fixture rows",
    scenarios: PROJECTS_DEV_SCENARIOS,
    source: projectsDevMockSource,
    title: "Projects mock",
  });

  return mock.enabled ? (
    <ProjectsExplorerDevMockGenerator scenario={mock.scenario} />
  ) : null;
}
