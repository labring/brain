import assert from "node:assert/strict";
import { test } from "node:test";

import { DEPLOY_TASK_CREATED_EVENT } from "@/features/deploy/task/browser-events";
import { findDialog } from "@/features/project-canvas/react-test-harness";
import type { useProjectCanvasModule } from "./use-project-canvas-module";
import {
  apItem,
  dbItem,
  mountWorkbench,
  taskProjection,
} from "./workbench-test-harness";

type Workbench = ReturnType<typeof useProjectCanvasModule>;

const DB_TARGET = {
  kind: "DB",
  name: "orders-db",
  namespace: "default",
} as const;
const AP_TARGET = { kind: "AP", name: "api", namespace: "default" } as const;
const DBS = [dbItem("orders-db")];
const APS = [apItem("api")];

type LeaveGuardDialogProps = Record<string, unknown> & {
  onDecision: (decision: "discard" | "save" | "stay") => void;
  open: boolean;
};

function openLeaveGuardDialog(dialogs: unknown) {
  return findDialog<LeaveGuardDialogProps>(
    dialogs,
    (props) => props.open === true && typeof props.onDecision === "function"
  );
}

/** The Settings Launch Context as the side render model presents it. */
function settingsLaunchContext(harness: { latest: () => Workbench }) {
  const side = harness.latest().surfaces.model.side;
  if (side?.kind !== "resource" || side.content.kind !== "settings") {
    return undefined;
  }
  return side.content.launchContext;
}

test("opening a Project Surface publishes it to the render model and the URL", async () => {
  const harness = await mountWorkbench({ dbs: DBS });
  try {
    await harness.act(() => {
      harness.latest().actions.openSurfaceIntent({
        entry: { kind: "resourceLogs", target: DB_TARGET },
        slot: "main",
      });
    });

    assert.equal(harness.latest().surfaces.model.main?.kind, "dbLogs");
    assert.equal(harness.updates.length, 1);
    assert.equal(
      harness.updates[0]?.queryString,
      "?main=resource-logs:db:default:orders-db"
    );
    assert.equal(harness.updates[0]?.options.history, "push");
  } finally {
    await harness.unmount();
  }
});

test("closing a Project Surface clears the slot and the query", async () => {
  const harness = await mountWorkbench({
    dbs: DBS,
    searchParams: "?main=resource-logs:db:default:orders-db",
  });
  try {
    assert.equal(harness.latest().surfaces.model.main?.kind, "dbLogs");

    await harness.act(() => {
      harness.latest().surfaces.actions.closeMainSurface();
    });

    assert.equal(harness.latest().surfaces.model.main, null);
    assert.equal(harness.updates.at(-1)?.queryString, "");
  } finally {
    await harness.unmount();
  }
});

test("closing a covered canvas after an identity change revalidates the new project", async () => {
  const harness = await mountWorkbench({ dbs: DBS });
  try {
    await harness.act(() => {
      harness.latest().actions.openSurfaceIntent({
        entry: { kind: "resourceLogs", target: DB_TARGET },
        slot: "main",
      });
    });
    assert.equal(harness.latest().canvas.covered, true);

    await harness.setIdentity({ namespace: "other", projectId: "p2" });
    assert.equal(harness.latest().canvas.covered, true);
    harness.fetchCalls.length = 0;

    await harness.act(() => {
      harness.latest().surfaces.actions.closeMainSurface();
    });

    assert.equal(harness.latest().canvas.covered, false);
    assert.ok(
      harness.fetchCalls.some(
        (call) => call.url.includes("/api/ap/") || call.url.includes("/api/db/")
      ),
      "revealing the new project's canvas revalidates its resource snapshot"
    );
  } finally {
    await harness.unmount();
  }
});

test("a Session Drawer coexists with an open side surface", async () => {
  const harness = await mountWorkbench();
  try {
    await harness.act(() => {
      harness.latest().actions.openSurfaceIntent({
        entry: { kind: "githubDeployment", projectId: "p1" },
        slot: "side",
      });
    });
    await harness.act(() => {
      harness.latest().actions.openSurfaceIntent({
        entry: { kind: "dbTerminal", target: DB_TARGET },
        slot: "drawer",
      });
    });

    assert.ok(harness.latest().surfaces.model.side, "side stays open");
    assert.ok(harness.latest().surfaces.model.drawer, "drawer opens alongside");
  } finally {
    await harness.unmount();
  }
});

test("a slot holds one activity: opening a second side entry replaces the first", async () => {
  const harness = await mountWorkbench();
  try {
    await harness.act(() => {
      harness.latest().actions.openSurfaceIntent({
        entry: { kind: "githubDeployment", projectId: "p1" },
        slot: "side",
      });
    });
    await harness.act(() => {
      harness.latest().actions.openSurfaceIntent({
        entry: { kind: "dockerDeployment", projectId: "p1" },
        slot: "side",
      });
    });

    const side = harness.latest().surfaces.model.side;
    assert.equal(side?.kind, "global");
    assert.equal(
      side?.kind === "global" ? side.entry.kind : null,
      "dockerDeployment"
    );
  } finally {
    await harness.unmount();
  }
});

test("a value-equal transition writes no URL or history update", async () => {
  const harness = await mountWorkbench({
    searchParams: "?side=github-deployment:p1",
  });
  try {
    harness.updates.length = 0;

    await harness.act(() => {
      harness.latest().actions.openSurfaceIntent({
        entry: { kind: "githubDeployment", projectId: "p1" },
        slot: "side",
      });
    });

    assert.deepEqual(harness.updates, []);
  } finally {
    await harness.unmount();
  }
});

test("route restoration rebuilds the render model from the query string", async () => {
  const harness = await mountWorkbench({
    searchParams: "?side=github-deployment:p1",
  });
  try {
    const side = harness.latest().surfaces.model.side;
    assert.equal(side?.kind, "global");
    assert.equal(
      side?.kind === "global" ? side.entry.kind : null,
      "githubDeployment"
    );
    assert.deepEqual(harness.updates, [], "restoration writes no URL update");
  } finally {
    await harness.unmount();
  }
});

const SETTINGS_QUERY = "?side=settings:ap:default:api";
const DELETED_DB_URL_RE = /orders-db/;
const DEPLOYMENT_TASK_FOCUS_KEY_RE = /deployment-task:task-1/;

test("a dirty Settings Draft holds the leave guard dialog before any route write", async () => {
  const harness = await mountWorkbench({
    aps: APS,
    searchParams: SETTINGS_QUERY,
  });
  try {
    await harness.act(() => {
      harness.latest().surfaces.actions.registerSettingsLeaveGuard({
        dirty: true,
        discard: () => undefined,
        save: () => undefined,
        scope: "ap",
      });
    });
    harness.updates.length = 0;

    await harness.act(() => {
      harness.latest().surfaces.actions.closeResourcePane();
    });

    assert.ok(
      openLeaveGuardDialog(harness.latest().surfaces.dialogs),
      "guard dialog is open"
    );
    assert.deepEqual(
      harness.updates,
      [],
      "the route is not written while the guard is pending"
    );
  } finally {
    await harness.unmount();
  }
});

test("discarding a Settings Draft commits the close and writes the route", async () => {
  const harness = await mountWorkbench({
    aps: APS,
    searchParams: SETTINGS_QUERY,
  });
  try {
    let discarded = false;
    await harness.act(() => {
      harness.latest().surfaces.actions.registerSettingsLeaveGuard({
        dirty: true,
        discard: () => {
          discarded = true;
        },
        save: () => undefined,
        scope: "ap",
      });
    });
    await harness.act(() => {
      harness.latest().surfaces.actions.closeResourcePane();
    });
    harness.updates.length = 0;

    const dialog = openLeaveGuardDialog(harness.latest().surfaces.dialogs);
    assert.ok(dialog);
    await harness.act(() => {
      dialog.onDecision("discard");
    });

    assert.ok(discarded, "the draft is discarded");
    assert.equal(harness.latest().surfaces.model.side, null, "the pane closes");
    assert.equal(harness.updates.at(-1)?.queryString, "");
  } finally {
    await harness.unmount();
  }
});

test("staying on a dirty Settings Draft leaves the route untouched", async () => {
  const harness = await mountWorkbench({
    aps: APS,
    searchParams: SETTINGS_QUERY,
  });
  try {
    await harness.act(() => {
      harness.latest().surfaces.actions.registerSettingsLeaveGuard({
        dirty: true,
        discard: () => undefined,
        save: () => undefined,
        scope: "ap",
      });
    });
    await harness.act(() => {
      harness.latest().surfaces.actions.closeResourcePane();
    });
    harness.updates.length = 0;

    const dialog = openLeaveGuardDialog(harness.latest().surfaces.dialogs);
    assert.ok(dialog);
    await harness.act(() => {
      dialog.onDecision("stay");
    });

    assert.ok(harness.latest().surfaces.model.side, "the pane stays open");
    assert.deepEqual(harness.updates, []);
    assert.equal(
      settingsLaunchContext(harness)?.launchSource,
      "route",
      "staying must not clean up the launch context the pane is still using"
    );
  } finally {
    await harness.unmount();
  }
});

test("a clean Settings pane closes without prompting", async () => {
  const harness = await mountWorkbench({
    aps: APS,
    searchParams: SETTINGS_QUERY,
  });
  try {
    await harness.act(() => {
      harness.latest().surfaces.actions.registerSettingsLeaveGuard({
        dirty: false,
        discard: () => undefined,
        save: () => undefined,
        scope: "ap",
      });
    });
    harness.updates.length = 0;

    await harness.act(() => {
      harness.latest().surfaces.actions.closeResourcePane();
    });

    assert.equal(
      openLeaveGuardDialog(harness.latest().surfaces.dialogs),
      null,
      "no guard dialog"
    );
    assert.equal(harness.latest().surfaces.model.side, null);
    assert.equal(harness.updates.at(-1)?.queryString, "");
  } finally {
    await harness.unmount();
  }
});

test("a settings surface opened from the canvas carries its launch context", async () => {
  const harness = await mountWorkbench({ aps: APS });
  try {
    const dataLayer: unknown[] = [];
    Object.assign(window, { dataLayer });
    await harness.act(() => {
      harness
        .latest()
        .actions.openSurfaceIntent(
          { entry: { kind: "settings", target: AP_TARGET }, slot: "side" },
          "assistant"
        );
    });

    assert.equal(settingsLaunchContext(harness)?.launchSource, "assistant");
    assert.deepEqual(
      dataLayer,
      [],
      "assistant navigation is not a user card action"
    );
  } finally {
    await harness.unmount();
  }
});

test("an AP-to-DB command carries Pending Database Binding Intent into Settings", async () => {
  const harness = await mountWorkbench({ aps: APS, dbs: DBS });
  try {
    await harness.act(() => {
      harness.latest().canvas.nodeCommands.executeCommandPlan({
        guard: { action: "switch", kind: "settingsLeave" },
        pendingDbReference: {
          apNodeId: "ap:default:api",
          dbName: "orders-db",
          dbNamespace: "default",
        },
        selection: { kind: "resource", target: AP_TARGET },
        surface: {
          entry: {
            kind: "settings",
            target: AP_TARGET,
            view: "environment",
          },
          slot: "side",
        },
      });
    });

    assert.deepEqual(settingsLaunchContext(harness), {
      launchSource: "canvas",
      pendingDatabaseBindingIntent: {
        dbName: "orders-db",
        dbNamespace: "default",
        id: "ap-db-1",
      },
    });
  } finally {
    await harness.unmount();
  }
});

test("a route-restored settings surface reports a restored launch context", async () => {
  const harness = await mountWorkbench({
    aps: APS,
    searchParams: SETTINGS_QUERY,
  });
  try {
    assert.equal(settingsLaunchContext(harness)?.launchSource, "route");
  } finally {
    await harness.unmount();
  }
});

test("closing Settings clears its launch context before route restoration", async () => {
  const harness = await mountWorkbench({ aps: APS });
  try {
    await harness.act(() => {
      harness
        .latest()
        .actions.openSurfaceIntent(
          { entry: { kind: "settings", target: AP_TARGET }, slot: "side" },
          "assistant"
        );
    });
    assert.equal(settingsLaunchContext(harness)?.launchSource, "assistant");

    await harness.act(() => {
      harness.latest().surfaces.actions.closeResourcePane();
    });
    await harness.setSearchParams(SETTINGS_QUERY);

    assert.equal(settingsLaunchContext(harness)?.launchSource, "route");
  } finally {
    await harness.unmount();
  }
});

test("an invalid query is repaired by replacing history", async () => {
  const harness = await mountWorkbench({
    searchParams: "?selected=service:legacy",
  });
  try {
    assert.equal(harness.updates.length, 1);
    assert.equal(harness.updates[0]?.queryString, "");
    assert.equal(harness.updates[0]?.options.history, "replace");
  } finally {
    await harness.unmount();
  }
});

test("a selection naming a resource on the canvas survives once selection is ready", async () => {
  const harness = await mountWorkbench({
    aps: APS,
    searchParams: "?selected=ap:default:api",
  });
  try {
    assert.deepEqual(
      harness.updates,
      [],
      "a live selection is never cleaned up"
    );
  } finally {
    await harness.unmount();
  }
});

test("a stale selection is cleaned up by replacing history once selection is ready", async () => {
  const harness = await mountWorkbench({
    aps: APS,
    searchParams: "?selected=ap:default:deleted-ap",
  });
  try {
    assert.equal(harness.updates.length, 1);
    assert.equal(harness.updates[0]?.queryString, "");
    assert.equal(harness.updates[0]?.options.history, "replace");
  } finally {
    await harness.unmount();
  }
});

const RUNNING_TASK = taskProjection({ id: "task-1", status: "running" });

test("the Deployment Task Dock lists a running task", async () => {
  const harness = await mountWorkbench({ tasks: [RUNNING_TASK] });
  try {
    const dock = harness.latest().canvas.deploymentTaskDock;
    assert.deepEqual(
      dock.tasks.map((item) => item.task.id),
      ["task-1"]
    );
    assert.equal(dock.tasks[0]?.active, false);
  } finally {
    await harness.unmount();
  }
});

test("clicking a dock chip opens the Deployment Task Timeline and marks it active", async () => {
  const harness = await mountWorkbench({ tasks: [RUNNING_TASK] });
  try {
    await harness.act(() => {
      harness.latest().actions.openDeploymentTaskDockTask("task-1");
    });

    const side = harness.latest().surfaces.model.side;
    assert.equal(side?.kind, "global");
    assert.equal(
      side?.kind === "global" ? side.entry.kind : null,
      "deploymentTaskTimeline"
    );
    assert.equal(
      harness.latest().canvas.deploymentTaskDock.tasks[0]?.active,
      true
    );
  } finally {
    await harness.unmount();
  }
});

test("opening a Deployment Task Timeline focuses the canvas on that task", async () => {
  const harness = await mountWorkbench({ tasks: [RUNNING_TASK] });
  try {
    assert.equal(
      harness.latest().canvas.viewportDirectives.getDirectives().viewportFocus
        ?.active,
      false,
      "nothing is focused before the timeline opens"
    );

    await harness.act(() => {
      harness.latest().actions.openDeploymentTaskDockTask("task-1");
    });

    const focus = harness
      .latest()
      .canvas.viewportDirectives.getDirectives().viewportFocus;
    assert.equal(focus?.active, true, "the timeline requests a viewport focus");
    assert.match(String(focus?.key), DEPLOYMENT_TASK_FOCUS_KEY_RE);
  } finally {
    await harness.unmount();
  }
});

test("reopening the same Deployment Task Timeline re-requests focus", async () => {
  const harness = await mountWorkbench({ tasks: [RUNNING_TASK] });
  try {
    await harness.act(() => {
      harness.latest().actions.openDeploymentTaskDockTask("task-1");
    });
    const firstKey = harness.latest().canvas.viewportDirectives.getDirectives()
      .viewportFocus?.key;

    await harness.act(() => {
      harness.latest().surfaces.actions.closeResourcePane();
    });
    await harness.act(() => {
      harness.latest().actions.openDeploymentTaskDockTask("task-1");
    });

    const secondKey = harness.latest().canvas.viewportDirectives.getDirectives()
      .viewportFocus?.key;
    assert.notEqual(
      secondKey,
      firstKey,
      "a fresh request key re-fires the focus even for the same task"
    );
  } finally {
    await harness.unmount();
  }
});

test("dismissing the active task closes its pane and persists the dismissal", async () => {
  const harness = await mountWorkbench({ tasks: [RUNNING_TASK] });
  try {
    await harness.act(() => {
      harness.latest().actions.openDeploymentTaskDockTask("task-1");
    });

    await harness.act(() => {
      harness.latest().actions.dismissDeploymentTaskDockTask("task-1");
    });

    assert.equal(
      harness.latest().surfaces.model.side,
      null,
      "the dismissal closes the pane it was fronting"
    );
    assert.deepEqual(harness.latest().canvas.deploymentTaskDock.tasks, []);
    assert.equal(
      harness.readStorage("sealai:deployment-task-dock-dismissals:default:p1"),
      JSON.stringify({ "task-1": RUNNING_TASK.updatedAt })
    );
  } finally {
    await harness.unmount();
  }
});

test("a dismissal made in another tab drops the task from the dock", async () => {
  const harness = await mountWorkbench({ tasks: [RUNNING_TASK] });
  try {
    assert.equal(harness.latest().canvas.deploymentTaskDock.tasks.length, 1);

    await harness.act(() => {
      harness.writeStorage(
        "sealai:deployment-task-dock-dismissals:default:p1",
        JSON.stringify({ "task-1": RUNNING_TASK.updatedAt })
      );
      harness.emitStorage("sealai:deployment-task-dock-dismissals:default:p1");
    });

    assert.deepEqual(harness.latest().canvas.deploymentTaskDock.tasks, []);
  } finally {
    await harness.unmount();
  }
});

test("a dismissal seeded before mount keeps the task out of the dock", async () => {
  const harness = await mountWorkbench({
    dismissals: {
      "sealai:deployment-task-dock-dismissals:default:p1": JSON.stringify({
        "task-1": RUNNING_TASK.updatedAt,
      }),
    },
    tasks: [RUNNING_TASK],
  });
  try {
    assert.deepEqual(harness.latest().canvas.deploymentTaskDock.tasks, []);
  } finally {
    await harness.unmount();
  }
});

test("a completed task stays in the dock until the user dismisses it", async () => {
  const harness = await mountWorkbench({ tasks: [RUNNING_TASK] });
  try {
    assert.deepEqual(
      harness.latest().canvas.deploymentTaskDock.tasks.map((i) => i.task.id),
      ["task-1"],
      "the running task is docked"
    );

    harness.setTasks([
      taskProjection({
        id: "task-1",
        status: "completed",
        updatedAt: "2026-06-17T10:05:00.000Z",
      }),
    ]);
    await harness.act(async () => {
      await harness.latest().surfaces.refreshWorkloadLists();
    });

    assert.deepEqual(
      harness.latest().canvas.deploymentTaskDock.tasks.map((i) => i.task.id),
      ["task-1"],
      "the completed task remains docked"
    );

    await harness.act(() => {
      harness.latest().actions.dismissDeploymentTaskDockTask("task-1");
    });

    assert.deepEqual(
      harness.latest().canvas.deploymentTaskDock.tasks,
      [],
      "manual dismissal removes the completed task"
    );
  } finally {
    await harness.unmount();
  }
});

test("a manually closed Deployment Task Timeline does not auto-open again", async () => {
  const harness = await mountWorkbench({ tasks: [RUNNING_TASK] });
  try {
    await harness.act(() => {
      harness.emitWindowEvent(DEPLOY_TASK_CREATED_EVENT, {
        projectId: "p1",
        taskId: "task-1",
      });
    });
    assert.ok(
      harness.latest().surfaces.model.side,
      "a created task auto-opens its timeline"
    );

    await harness.act(() => {
      harness.latest().surfaces.actions.closeResourcePane();
    });
    assert.equal(harness.latest().surfaces.model.side, null);

    await harness.act(() => {
      harness.emitWindowEvent(DEPLOY_TASK_CREATED_EVENT, {
        projectId: "p1",
        taskId: "task-1",
      });
    });

    assert.equal(
      harness.latest().surfaces.model.side,
      null,
      "the manual close suppresses the auto-open"
    );
  } finally {
    await harness.unmount();
  }
});

test("a workbench identity change clears manual timeline-close suppression", async () => {
  const harness = await mountWorkbench({ tasks: [RUNNING_TASK] });
  try {
    await harness.act(() => {
      harness.emitWindowEvent(DEPLOY_TASK_CREATED_EVENT, {
        projectId: "p1",
        taskId: "task-1",
      });
    });
    await harness.act(() => {
      harness.latest().surfaces.actions.closeResourcePane();
    });

    await harness.setIdentity({ namespace: "other", projectId: "p2" });
    await harness.act(() => {
      harness.emitWindowEvent(DEPLOY_TASK_CREATED_EVENT, {
        projectId: "p2",
        taskId: "task-1",
      });
    });

    const side = harness.latest().surfaces.model.side;
    assert.equal(side?.kind, "global");
    assert.equal(
      side?.kind === "global" ? side.entry.kind : null,
      "deploymentTaskTimeline"
    );
  } finally {
    await harness.unmount();
  }
});

test("clicking a dock chip reopens a manually closed timeline", async () => {
  const harness = await mountWorkbench({ tasks: [RUNNING_TASK] });
  try {
    await harness.act(() => {
      harness.emitWindowEvent(DEPLOY_TASK_CREATED_EVENT, {
        projectId: "p1",
        taskId: "task-1",
      });
    });
    await harness.act(() => {
      harness.latest().surfaces.actions.closeResourcePane();
    });

    await harness.act(() => {
      harness.latest().actions.openDeploymentTaskDockTask("task-1");
    });

    assert.ok(
      harness.latest().surfaces.model.side,
      "an explicit chip click still opens the timeline"
    );
  } finally {
    await harness.unmount();
  }
});

test("requesting a DB delete confirms, calls the API, cleans layout, and refreshes", async () => {
  const harness = await mountWorkbench({ dbs: DBS });
  try {
    await harness.act(() => {
      harness.latest().canvas.nodeCommands.requestDbDelete({
        displayName: "orders-db",
        name: "orders-db",
        namespace: "default",
      });
    });

    const dialog = findDialog<{
      dbTarget: { name: string } | null;
      onDbConfirm: () => void;
    }>(
      harness.latest().surfaces.dialogs,
      (props) =>
        props.dbTarget != null && typeof props.onDbConfirm === "function"
    );
    assert.ok(dialog, "the delete confirmation is published");
    assert.equal(dialog.dbTarget?.name, "orders-db");

    harness.fetchCalls.length = 0;
    await harness.act(() => {
      dialog.onDbConfirm();
    });

    const deleteCall = harness.fetchCalls.find(
      (call) => call.method === "DELETE"
    );
    assert.ok(deleteCall, "the DB delete reaches the API");
    assert.match(deleteCall.url, DELETED_DB_URL_RE);

    const layoutCleanup = harness.fetchCalls.find(
      (call) =>
        call.url.includes("/api/project-canvas/layout") &&
        call.method === "PATCH"
    );
    assert.ok(layoutCleanup, "the Canvas Layout entry is cleaned up");

    assert.ok(
      harness.fetchCalls.some((call) => call.url.includes("/api/db/")),
      "the workload lists are refreshed"
    );
  } finally {
    await harness.unmount();
  }
});
