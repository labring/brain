// biome-ignore-all lint/suspicious/noBitwiseOperators: the demo dataset hash intentionally mixes 32-bit integers so the same knob values always regenerate the same projects.
import type { ProjectExplorerProject } from "@/features/projects/explorer/project-explorer.types";
import type {
  ProjectShortcutIconKey,
  ProjectShortcutIconKeyMap,
} from "@/features/projects/project-shortcut-icons";

/**
 * Baked-in default for the "Mock data" switch in the dev tweaks panel (see
 * `next.config.mjs`): demo builds set `NEXT_PUBLIC_DEMO_MOCK=1` so the app
 * opens with the mock already on; everywhere else the switch starts off and
 * can be flipped at runtime from the panel.
 */
export const DEMO_PROJECTS_MOCK = process.env.NEXT_PUBLIC_DEMO_MOCK === "1";

export const DEMO_PROJECTS_DEFAULT_COUNT = 12;
export const DEMO_PROJECTS_DEFAULT_INITIAL_PINS = 3;
export const DEMO_PROJECTS_DEFAULT_SEED = 1;
export const DEMO_PROJECTS_MAX_COUNT = 200;

const DEMO_NAME_POOL = [
  "orders-api",
  "checkout-web",
  "billing-service",
  "auth-gateway",
  "analytics-etl",
  "notification-hub",
  "search-indexer",
  "image-resizer",
  "landing-page",
  "docs-site",
  "inventory-sync",
  "payment-webhooks",
  "user-profile-api",
  "recommendation-engine",
  "session-cache",
  "email-digest",
  "feature-flags",
  "audit-log-collector",
  "mobile-bff",
  "admin-console",
  "pricing-engine",
  "geo-lookup",
  "report-scheduler",
  "media-transcoder",
  "crm-bridge",
  "webhook-relay",
  "ab-testing",
  "fraud-monitor",
  "invoice-generator",
  "chat-support-bot",
  "data-warehouse-sync",
  "status-page",
  "cdn-purger",
  "license-server",
  "survey-widget",
  "backup-runner",
] as const;

/**
 * Boundary samples pinned to fixed indices so the default scene (12 projects,
 * first 3 pinned) always shows them above the fold: a name long enough to
 * exercise truncation (and it lands in the Pinned group), a CJK name, and a
 * minimal two-character name.
 */
const DEMO_EDGE_NAMES: Readonly<Record<number, string>> = {
  2: "customer-feedback-sentiment-analysis-pipeline-legacy-migration-v2",
  6: "内部运营数据看板",
  9: "ml",
};

const DEMO_DESCRIPTION_POOL = [
  "Handles order intake and fulfillment events.",
  "Customer-facing checkout flow.",
  "Aggregates usage into daily invoices.",
  "OAuth2 token exchange and session issuing.",
  "Nightly batch loads into the warehouse.",
  "Fan-out for email, SMS and in-app pushes.",
  "Full-text index rebuild workers.",
  "On-the-fly thumbnail generation.",
  "Marketing site, statically rendered.",
  "Internal developer documentation.",
] as const;

const DEMO_ICON_KEYS = [
  "docker",
  "postgresql",
  "redis",
  "mysql",
  "mongodb",
  "database",
] as const satisfies readonly ProjectShortcutIconKey[];

/** Newest demo project's creation instant; older rows step back from here. */
const DEMO_EPOCH_MS = Date.UTC(2026, 7, 12, 9, 0, 0);
const DEMO_AGE_STEP_MS = 13 * 60 * 60 * 1000;
const DEMO_AGE_JITTER_MS = 9 * 60 * 60 * 1000;

/** Deterministic unit-interval hash of (seed, index, salt). */
function demoUnit(seed: number, index: number, salt: number): number {
  let h = (seed * 374_761_393 + index * 668_265_263 + salt * 2_246_822_519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
  h ^= h >>> 16;
  return (h >>> 0) / 4_294_967_296;
}

function demoProjectName(seed: number, index: number): string {
  const edge = DEMO_EDGE_NAMES[index];
  if (edge !== undefined) {
    return edge;
  }
  const offset = Math.floor(demoUnit(seed, 0, 1) * DEMO_NAME_POOL.length);
  const poolIndex = (index + offset) % DEMO_NAME_POOL.length;
  const round = Math.floor((index + offset) / DEMO_NAME_POOL.length);
  const base = DEMO_NAME_POOL[poolIndex] ?? DEMO_NAME_POOL[0];
  return round === 0 ? base : `${base}-${round + 1}`;
}

function demoProjectStatus(
  seed: number,
  index: number
): ProjectExplorerProject["status"] {
  const r = demoUnit(seed, index, 2);
  if (r < 0.6) {
    return "positive";
  }
  if (r < 0.78) {
    return "progress";
  }
  if (r < 0.9) {
    return "neutral";
  }
  if (r < 0.95) {
    return undefined;
  }
  return "negative";
}

function demoProjectIconKey(
  seed: number,
  index: number
): ProjectShortcutIconKey {
  const r = demoUnit(seed, index, 3);
  if (r < 0.5) {
    return "docker";
  }
  const rest = DEMO_ICON_KEYS.length - 1;
  const pick = 1 + Math.min(rest - 1, Math.floor(((r - 0.5) / 0.5) * rest));
  return DEMO_ICON_KEYS[pick] ?? "docker";
}

function demoProjectCreatedAt(seed: number, index: number): string {
  const jitter = demoUnit(seed, index, 4) * DEMO_AGE_JITTER_MS;
  return new Date(
    DEMO_EPOCH_MS - index * DEMO_AGE_STEP_MS - Math.floor(jitter)
  ).toISOString();
}

function demoProjectDescription(seed: number, index: number): string {
  const r = demoUnit(seed, index, 5);
  if (r >= 0.6) {
    return "";
  }
  const pick = Math.floor((r / 0.6) * DEMO_DESCRIPTION_POOL.length);
  return DEMO_DESCRIPTION_POOL[pick] ?? "";
}

export interface DemoProjectsDataset {
  iconKeys: ProjectShortcutIconKeyMap;
  projects: ProjectExplorerProject[];
}

/**
 * Deterministic dataset for demo builds: the same `(seed, count)` always
 * yields the same projects, and growing `count` only appends — earlier rows
 * (ids, names, statuses) never reshuffle, so pins survive count changes.
 */
export function generateDemoProjects(input: {
  count: number;
  seed: number;
}): DemoProjectsDataset {
  const count = Math.min(
    DEMO_PROJECTS_MAX_COUNT,
    Math.max(0, Math.trunc(input.count))
  );
  const seed = Math.trunc(input.seed);
  const projects: ProjectExplorerProject[] = [];
  const iconKeys = new Map<string, ProjectShortcutIconKey>();

  for (let index = 0; index < count; index += 1) {
    const id = `demo-${seed}-${index}`;
    const status = demoProjectStatus(seed, index);
    const description = demoProjectDescription(seed, index);
    projects.push({
      createdAt: demoProjectCreatedAt(seed, index),
      ...(description === "" ? {} : { description }),
      id,
      name: demoProjectName(seed, index),
      resourceName: id,
      ...(status === undefined ? {} : { status }),
    });
    iconKeys.set(id, demoProjectIconKey(seed, index));
  }

  return { iconKeys, projects };
}
