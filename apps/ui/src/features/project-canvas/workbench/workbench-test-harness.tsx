/**
 * Mounts the Project Canvas Workbench for interface tests: an in-memory router
 * adapter (nuqs testing adapter with memory), a hand-stubbed window/localStorage
 * per repo convention, and a routed fetch stub standing in for the network the
 * held modules reach. Tests drive the returned workbench interface and assert
 * observable outcomes only, so they survive internal restructuring.
 */
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { SWRConfig } from "swr";

import { useProjectCanvasModule } from "@/features/project-canvas/workbench/use-project-canvas-module";
import { createManualWorkbenchClock } from "@/features/project-canvas/workbench/workbench-clock";

const START_MS = 1_760_000_000_000;

export interface WorkbenchFetchCall {
  body: string | undefined;
  method: string;
  url: string;
}

/**
 * Walks the dialog elements the workbench publishes. Dialogs are part of its
 * interface, so scenarios assert their presence and drive their decisions from
 * their props rather than mounting a DOM.
 */
function* walkElements(node: unknown): Generator<ReactElement> {
  if (Array.isArray(node)) {
    for (const child of node) {
      yield* walkElements(child);
    }
    return;
  }
  if (!isValidElement(node)) {
    return;
  }
  yield node;
  yield* walkElements((node.props as { children?: unknown }).children);
}

/** Finds the single published dialog whose props match, or null if none is open. */
export function findDialog<T extends Record<string, unknown>>(
  dialogs: unknown,
  match: (props: Record<string, unknown>) => boolean
): T | null {
  for (const element of walkElements(dialogs)) {
    const props = element.props as Record<string, unknown>;
    if (match(props)) {
      return props as T;
    }
  }
  return null;
}

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
  fetchCalls: WorkbenchFetchCall[];
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

interface GlobalOverride {
  key: string;
  previous: PropertyDescriptor | undefined;
}

function defineGlobal(key: string, value: unknown): GlobalOverride {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, value });
  return { key, previous };
}

function restoreGlobal(override: GlobalOverride) {
  if (override.previous === undefined) {
    Reflect.deleteProperty(globalThis, override.key);
    return;
  }
  Object.defineProperty(globalThis, override.key, override.previous);
}

function requestUrl(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return String((input as { url?: string }).url);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
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
  const kubeconfig = options.kubeconfig ?? "test-kubeconfig";
  const namespace = options.namespace ?? "default";
  const projectId = options.projectId ?? "p1";
  const served: WorkbenchHarnessOptions = { ...options, namespace, projectId };

  const reactGlobals = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = reactGlobals.IS_REACT_ACT_ENVIRONMENT;
  reactGlobals.IS_REACT_ACT_ENVIRONMENT = true;

  const storageItems = new Map<string, string>(
    Object.entries(options.dismissals ?? {})
  );
  const storage = {
    getItem: (key: string) => storageItems.get(key) ?? null,
    removeItem: (key: string) => {
      storageItems.delete(key);
    },
    setItem: (key: string, value: string) => {
      storageItems.set(key, value);
    },
  };
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const fetchCalls: WorkbenchFetchCall[] = [];
  const clock = createManualWorkbenchClock(START_MS);
  const emit = (type: string, event: unknown) => {
    for (const fn of [...(listeners.get(type) ?? [])]) {
      fn(event);
    }
  };

  const overrides = [
    defineGlobal("window", {
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        const set = listeners.get(type) ?? new Set();
        set.add(fn);
        listeners.set(type, set);
      },
      clearTimeout: globalThis.clearTimeout,
      dispatchEvent: (event: { type: string }) => {
        emit(event.type, event);
        return true;
      },
      localStorage: storage,
      location: { origin: "https://workbench.test" },
      removeEventListener: (type: string, fn: (event: unknown) => void) => {
        listeners.get(type)?.delete(fn);
      },
      setTimeout: globalThis.setTimeout,
    }),
    defineGlobal("localStorage", storage),
    defineGlobal("fetch", (input: unknown, init?: RequestInit) => {
      const url = requestUrl(input);
      fetchCalls.push({
        body: typeof init?.body === "string" ? init.body : undefined,
        method: init?.method ?? "GET",
        url,
      });
      return Promise.resolve(routeRequest(url, served));
    }),
  ];

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

  let renderer: ReactTestRenderer | undefined;
  // nuqs commits URL writes through a queue that drains on a timer, so an act()
  // pass alone would settle React but leave the update stream empty — every
  // "writes no URL update" assertion would pass vacuously. Drain it here.
  const runAct = async (fn: () => Promise<void> | void) => {
    await act(async () => {
      await fn();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  };

  await runAct(() => {
    renderer = create(
      <Tree>
        <Harness />
      </Tree>
    );
  });

  return {
    act: runAct,
    advanceClock: (ms: number) => runAct(() => clock.advance(ms)),
    emitStorage: (key: string | null) => {
      emit("storage", { key });
    },
    emitWindowEvent: (type: string, detail: unknown) => {
      emit(type, { detail, type });
    },
    fetchCalls,
    latest: () => {
      if (latest === undefined) {
        throw new Error("workbench did not render");
      }
      return latest;
    },
    readStorage: (key: string) => storageItems.get(key) ?? null,
    setTasks: (tasks: unknown[]) => {
      served.tasks = tasks;
    },
    writeStorage: (key: string, value: string) => {
      storageItems.set(key, value);
    },
    unmount: async () => {
      await runAct(() => {
        renderer?.unmount();
      });
      for (const override of overrides) {
        restoreGlobal(override);
      }
      reactGlobals.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    },
    updates,
  };
}
