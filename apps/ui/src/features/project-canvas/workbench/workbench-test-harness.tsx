/**
 * Mounts the Project Canvas Workbench for interface tests: an in-memory router
 * adapter (nuqs testing adapter with memory), a suite-local DOM, and a routed
 * fetch stub standing in for the network the held modules reach. Tests drive
 * the returned workbench interface and assert observable outcomes only, so they
 * survive internal restructuring.
 */
import { render } from "@testing-library/react/pure";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";

import {
  actAndDrain,
  installTestDom,
  jsonResponse,
  restoreActEnvironment,
  restoreGlobal,
  type StubbedFetchCall,
  setActEnvironment,
  stubFetch,
} from "@/features/project-canvas/react-test-harness";

import { useProjectCanvasModule } from "@/features/project-canvas/workbench/use-project-canvas-module";
import { createManualWorkbenchClock } from "@/features/project-canvas/workbench/workbench-clock";

const START_MS = 1_760_000_000_000;

/** A deployment task projection, as the deploy-tasks endpoint returns it. */
export function taskProjection(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    artifactSummary: {},
    canvasProjection: {},
    completedAt: null,
    display: {
      resultSummary: "Result pending",
      sourceKind: "docker",
      sourceSummary: "nginx:latest",
    },
    id: "task-1",
    namespace: "default",
    phase: "apply",
    projectId: "p1",
    status: "running",
    updatedAt: "2026-06-17T10:00:00.000Z",
    ...overrides,
  };
}

/** A running AP list item, shaped as the K8s list endpoint returns it. */
export function apItem(name: string, namespace = "default") {
  return {
    metadata: { name, namespace, uid: `${name}-uid` },
    spec: { input: { image: "nginx:1.27" } },
    status: { phase: "Running" },
  };
}

/** A running DB list item, shaped as the K8s list endpoint returns it. */
export function dbItem(name: string, namespace = "default") {
  return {
    metadata: { name, namespace, uid: `${name}-uid` },
    spec: { engine: "postgresql" },
    status: { phase: "Running" },
  };
}

export interface WorkbenchHarnessOptions {
  /** AP list items served to the resource snapshot. */
  aps?: unknown[];
  /** DB list items served to the resource snapshot. */
  dbs?: unknown[];
  /** Seeds the Deployment Task Dock dismissal storage before mount. */
  dismissals?: Record<string, string>;
  kubeconfig?: string;
  /** Canvas Layout nodes served to the layout module. */
  layoutNodes?: unknown[];
  namespace?: string;
  projectId?: string;
  /** Initial query string, for route-restoration scenarios. */
  searchParams?: string;
  /** Deployment task projections served to the dock and timeline. */
  tasks?: unknown[];
}

type Workbench = ReturnType<typeof useProjectCanvasModule>;

export interface WorkbenchHarness {
  /** Runs `fn` inside `act`, flushing effects and state updates. */
  act: (fn: () => Promise<void> | void) => Promise<void>;
  /** Moves the workbench clock forward, firing anything that comes due. */
  advanceClock: (ms: number) => Promise<void>;
  /** Fires a cross-tab storage event at the workbench. */
  emitStorage: (key: string | null) => void;
  /** Dispatches a window event at the workbench, as the browser would. */
  emitWindowEvent: (type: string, detail: unknown) => void;
  /** Every fetch the workbench issued, in order. */
  fetchCalls: StubbedFetchCall[];
  /** The latest value the workbench interface returned. */
  latest: () => Workbench;
  /** Reads what the dismissal storage currently holds. */
  readStorage: (key: string) => string | null;
  /** Changes the deployment task projections the API serves from now on. */
  setTasks: (tasks: unknown[]) => void;
  unmount: () => Promise<void>;
  /** The URL update stream captured from the router adapter. */
  updates: UrlUpdateEvent[];
  /** Writes storage as another tab would, before emitting the storage event. */
  writeStorage: (key: string, value: string) => void;
}

/**
 * Serves the endpoints the held modules reach. Unknown routes resolve to an
 * empty K8s-shaped list rather than throwing, so a new incidental read does not
 * fail every scenario.
 */
function routeRequest(url: string, options: WorkbenchHarnessOptions): Response {
  const { pathname } = new URL(url);
  if (pathname.startsWith("/api/ap/")) {
    return jsonResponse({ items: options.aps ?? [] });
  }
  if (pathname.startsWith("/api/db/")) {
    return jsonResponse({ items: options.dbs ?? [] });
  }
  if (pathname === "/api/project-canvas/layout") {
    return jsonResponse({
      namespace: options.namespace ?? "default",
      nodes: options.layoutNodes ?? [],
      projectId: options.projectId ?? "p1",
      version: 1,
    });
  }
  if (pathname === "/api/deploy-tasks") {
    return jsonResponse({ projections: options.tasks ?? [] });
  }
  if (pathname.startsWith("/api/deploy-tasks")) {
    // Projection/timeline streams: hold the connection open with an empty body
    // so the store keeps its bootstrap projections.
    return new Response(new ReadableStream(), {
      headers: { "content-type": "text/event-stream" },
      status: 200,
    });
  }
  return jsonResponse({ items: [] });
}

export async function mountWorkbench(
  options: WorkbenchHarnessOptions = {}
): Promise<WorkbenchHarness> {
  const dom = installTestDom();
  const kubeconfig = options.kubeconfig ?? "test-kubeconfig";
  const namespace = options.namespace ?? "default";
  const projectId = options.projectId ?? "p1";
  const served: WorkbenchHarnessOptions = { ...options, namespace, projectId };

  const previousActEnvironment = setActEnvironment(true);

  localStorage.clear();
  for (const [key, value] of Object.entries(options.dismissals ?? {})) {
    localStorage.setItem(key, value);
  }
  const fetchStub = stubFetch((url) => routeRequest(url, served));
  const fetchCalls = fetchStub.calls;
  const clock = createManualWorkbenchClock(START_MS);

  let latest: Workbench | undefined;
  function Harness() {
    latest = useProjectCanvasModule({
      clock,
      kubeconfig,
      namespace,
      projectId,
    });
    return null;
  }

  const updates: UrlUpdateEvent[] = [];
  function Tree({ children }: { children: ReactNode }) {
    return (
      <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
        {/*
          hasMemory makes the adapter a real in-memory router: writes land back
          in the search params, so render models reflect them.

          resetUrlUpdateQueueOnMount must stay false. The adapter resets the
          (global) update queue on every render, not just on mount, so any write
          still queued when an async fetch re-renders the tree is silently
          dropped — which loses mount-time route repairs entirely. Each mount
          drains the queue through act() instead.
        */}
        <NuqsTestingAdapter
          hasMemory
          onUrlUpdate={(event) => updates.push(event)}
          resetUrlUpdateQueueOnMount={false}
          searchParams={options.searchParams ?? ""}
        >
          {children}
        </NuqsTestingAdapter>
      </SWRConfig>
    );
  }

  let rendered: ReturnType<typeof render> | undefined;
  const runAct = actAndDrain;

  await runAct(() => {
    rendered = render(
      <Tree>
        <Harness />
      </Tree>
    );
  });

  return {
    act: runAct,
    advanceClock: (ms: number) => runAct(() => clock.advance(ms)),
    emitStorage: (key: string | null) => {
      window.dispatchEvent(
        new StorageEvent("storage", { key, storageArea: localStorage })
      );
    },
    emitWindowEvent: (type: string, detail: unknown) => {
      window.dispatchEvent(new CustomEvent(type, { detail }));
    },
    fetchCalls,
    latest: () => {
      if (latest === undefined) {
        throw new Error("workbench did not render");
      }
      return latest;
    },
    readStorage: (key: string) => localStorage.getItem(key),
    setTasks: (tasks: unknown[]) => {
      served.tasks = tasks;
    },
    writeStorage: (key: string, value: string) => {
      localStorage.setItem(key, value);
    },
    unmount: async () => {
      await runAct(() => {
        rendered?.unmount();
      });
      restoreGlobal(fetchStub.override);
      restoreActEnvironment(previousActEnvironment);
      await dom.restore();
    },
    updates,
  };
}
