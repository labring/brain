import assert from "node:assert/strict";
import { test } from "node:test";

import { create } from "react-test-renderer";

import {
  actAndDrain,
  defineGlobal,
  findDialog,
  jsonResponse,
  restoreActEnvironment,
  restoreGlobal,
  setActEnvironment,
  stubFetch,
} from "@/features/project-canvas/react-test-harness";
import {
  apLifecycleWorkloadRefFromTarget,
  dbLifecycleWorkloadRefFromTarget,
} from "./resource-actions";
import { useProjectCanvasResourceActions } from "./use-project-canvas-resource-actions";

type Model = ReturnType<typeof useProjectCanvasResourceActions>;

async function mountResourceActions() {
  const previousAct = setActEnvironment(true);
  const fetchStub = stubFetch(() => jsonResponse({ items: [] }));
  const overrides = [
    defineGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      location: { origin: "https://workbench.test" },
      setTimeout: globalThis.setTimeout,
    }),
    fetchStub.override,
  ];
  const fetchCalls = fetchStub.calls;

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

  const runAct = actAndDrain;

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
      for (const override of overrides) {
        restoreGlobal(override);
      }
      restoreActEnvironment(previousAct);
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

    const dialog = findDialog(
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
    const dialog = findDialog(
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
    const dialog = findDialog(
      harness.latest().dialogs,
      (props) => props.dbTarget != null
    );
    assert.ok(dialog);

    await harness.act(() => {
      (dialog.onDbOpenChange as (open: boolean) => void)(false);
    });

    assert.equal(
      findDialog(harness.latest().dialogs, (p) => p.dbTarget != null),
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
    const dialog = findDialog(
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
      findDialog(
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
