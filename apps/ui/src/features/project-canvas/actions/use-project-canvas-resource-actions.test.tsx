import assert from "node:assert/strict";
import { test } from "node:test";

import { isValidElement, type ReactElement } from "react";
import { act, create } from "react-test-renderer";

import {
  apLifecycleWorkloadRefFromTarget,
  dbLifecycleWorkloadRefFromTarget,
} from "./resource-actions";
import { useProjectCanvasResourceActions } from "./use-project-canvas-resource-actions";

interface FetchCall {
  method: string;
  url: string;
}

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

function findDialogProps(
  dialogs: unknown,
  match: (props: Record<string, unknown>) => boolean
): Record<string, unknown> | null {
  for (const element of walkElements(dialogs)) {
    const props = element.props as Record<string, unknown>;
    if (match(props)) {
      return props;
    }
  }
  return null;
}

type Model = ReturnType<typeof useProjectCanvasResourceActions>;

async function mountResourceActions() {
  const reactGlobals = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousAct = reactGlobals.IS_REACT_ACT_ENVIRONMENT;
  reactGlobals.IS_REACT_ACT_ENVIRONMENT = true;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      clearTimeout: globalThis.clearTimeout,
      location: { origin: "https://workbench.test" },
      setTimeout: globalThis.setTimeout,
    },
  });
  const fetchCalls: FetchCall[] = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: (input: unknown, init?: RequestInit) => {
      fetchCalls.push({
        method: init?.method ?? "GET",
        url: String(input instanceof URL ? input.toString() : input),
      });
      return Promise.resolve(
        new Response(JSON.stringify({ items: [] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      );
    },
  });

  const layoutDeletes: unknown[][] = [];
  let refreshes = 0;
  let latest: Model | undefined;
  function Harness() {
    latest = useProjectCanvasResourceActions({
      kubeconfig: "test-kubeconfig",
      onResourceLayoutDelete: (refs) => {
        layoutDeletes.push([...refs]);
      },
      refreshWorkloadLists: () => {
        refreshes += 1;
        return Promise.resolve(undefined);
      },
    });
    return null;
  }

  const runAct = async (fn: () => Promise<void> | void) => {
    await act(async () => {
      await fn();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  };

  let renderer: ReturnType<typeof create> | undefined;
  await runAct(() => {
    renderer = create(<Harness />);
  });

  return {
    act: runAct,
    fetchCalls,
    latest: () => {
      if (latest === undefined) {
        throw new Error("resource actions did not render");
      }
      return latest;
    },
    layoutDeletes,
    refreshCount: () => refreshes,
    unmount: async () => {
      await runAct(() => {
        renderer?.unmount();
      });
      if (previousWindow === undefined) {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        Object.defineProperty(globalThis, "window", previousWindow);
      }
      if (previousFetch === undefined) {
        Reflect.deleteProperty(globalThis, "fetch");
      } else {
        Object.defineProperty(globalThis, "fetch", previousFetch);
      }
      reactGlobals.IS_REACT_ACT_ENVIRONMENT = previousAct;
    },
  };
}

const API_DB_RE = /\/api\/db\//;
const ORDERS_DB_RE = /orders-db/;

test("a destructive Resource Action confirms before it executes anything", async () => {
  const harness = await mountResourceActions();
  try {
    await harness.act(() => {
      harness.latest().commands.requestDbDelete({
        displayName: "orders-db",
        name: "orders-db",
        namespace: "default",
      });
    });

    const dialog = findDialogProps(
      harness.latest().dialogs,
      (props) => props.dbTarget != null
    );
    assert.ok(dialog, "the confirmation is published");
    assert.deepEqual(harness.fetchCalls, [], "nothing executed yet");
    assert.deepEqual(harness.layoutDeletes, []);
    assert.equal(harness.refreshCount(), 0);
  } finally {
    await harness.unmount();
  }
});

test("confirming a DB delete runs the whole pipeline: API, layout cleanup, refresh", async () => {
  const harness = await mountResourceActions();
  try {
    await harness.act(() => {
      harness.latest().commands.requestDbDelete({
        displayName: "orders-db",
        name: "orders-db",
        namespace: "default",
      });
    });
    const dialog = findDialogProps(
      harness.latest().dialogs,
      (props) => props.dbTarget != null
    );
    assert.ok(dialog);

    await harness.act(() => {
      (dialog.onDbConfirm as () => void)();
    });

    const deleteCall = harness.fetchCalls.find(
      (call) => call.method === "DELETE"
    );
    assert.ok(deleteCall, "the delete reaches the API");
    assert.match(deleteCall.url, API_DB_RE);
    assert.match(deleteCall.url, ORDERS_DB_RE);
    assert.deepEqual(harness.layoutDeletes, [
      [{ kind: "DB", name: "orders-db", namespace: "default" }],
    ]);
    assert.equal(harness.refreshCount(), 1, "workload lists refresh once");
  } finally {
    await harness.unmount();
  }
});

test("dismissing a confirmation executes nothing", async () => {
  const harness = await mountResourceActions();
  try {
    await harness.act(() => {
      harness.latest().commands.requestDbDelete({
        displayName: "orders-db",
        name: "orders-db",
        namespace: "default",
      });
    });
    const dialog = findDialogProps(
      harness.latest().dialogs,
      (props) => props.dbTarget != null
    );
    assert.ok(dialog);

    await harness.act(() => {
      (dialog.onDbOpenChange as (open: boolean) => void)(false);
    });

    assert.equal(
      findDialogProps(harness.latest().dialogs, (p) => p.dbTarget != null),
      null,
      "the confirmation closes"
    );
    assert.deepEqual(harness.fetchCalls, []);
    assert.equal(harness.refreshCount(), 0);
  } finally {
    await harness.unmount();
  }
});

test("confirming an AP delete drops both the AP and its Public Access layout entries", async () => {
  const harness = await mountResourceActions();
  try {
    await harness.act(() => {
      harness.latest().commands.requestApDelete({
        displayName: "api",
        name: "api",
        namespace: "default",
      });
    });
    const dialog = findDialogProps(
      harness.latest().dialogs,
      (props) => props.apTarget != null
    );
    assert.ok(dialog);

    await harness.act(() => {
      (dialog.onApConfirm as () => void)();
    });

    assert.deepEqual(harness.layoutDeletes, [
      [
        { kind: "AP", name: "api", namespace: "default" },
        { kind: "PublicAccess", name: "api", namespace: "default" },
      ],
    ]);
  } finally {
    await harness.unmount();
  }
});

test("an interrupting Resource Action confirms before it stops a workload", async () => {
  const harness = await mountResourceActions();
  try {
    await harness.act(() => {
      harness.latest().commands.requestApStop({
        displayName: "api",
        name: "api",
        namespace: "default",
      });
    });

    assert.ok(
      findDialogProps(
        harness.latest().dialogs,
        (props) => props.apStopTarget != null
      ),
      "the stop confirmation is published"
    );
    assert.deepEqual(harness.fetchCalls, [], "nothing executed yet");
  } finally {
    await harness.unmount();
  }
});

test("the module publishes lifecycle availability for node views to read", async () => {
  const harness = await mountResourceActions();
  try {
    const activity = harness.latest().lifecycleActivityStore.getApActivity();
    assert.equal(
      activity.authReady,
      true,
      "a kubeconfig-backed workbench reports auth ready"
    );

    const dbActivity = harness.latest().lifecycleActivityStore.getDbActivity({
      name: "orders-db",
      namespace: "default",
    });
    assert.equal(dbActivity.loadingDelete, false);
    assert.equal(dbActivity.publicAccessPendingTarget, undefined);
  } finally {
    await harness.unmount();
  }
});

test("Resource Actions normalize AP and DB target identities into workload refs", () => {
  assert.deepEqual(
    apLifecycleWorkloadRefFromTarget({
      kind: "AP",
      name: " api ",
      namespace: " default ",
    }),
    { name: "api", namespace: "default" }
  );
  assert.deepEqual(
    dbLifecycleWorkloadRefFromTarget({
      kind: "DB",
      name: " postgres ",
      namespace: " default ",
    }),
    { name: "postgres", namespace: "default" }
  );
  assert.equal(apLifecycleWorkloadRefFromTarget(null), null);
  assert.equal(dbLifecycleWorkloadRefFromTarget(undefined), null);
});
