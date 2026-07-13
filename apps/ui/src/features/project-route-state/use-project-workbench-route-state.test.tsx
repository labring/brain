import assert from "node:assert/strict";
import { test } from "node:test";

import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { renderToStaticMarkup } from "react-dom/server";

import {
  planInvalidProjectWorkbenchRouteRepair,
  useProjectWorkbenchRouteState,
} from "./use-project-workbench-route-state";
import {
  parseProjectWorkbenchRouteState,
  serializeProjectWorkbenchRouteState,
} from "./workbench-url-codec";

function renderRouteState(
  onUrlUpdate: (event: UrlUpdateEvent) => void,
  searchParams = ""
) {
  let routeState: ReturnType<typeof useProjectWorkbenchRouteState> | undefined;

  function Harness() {
    routeState = useProjectWorkbenchRouteState({
      canvasSelectionExists: () => true,
      isSideEntrySupported: () => true,
      selectionReady: false,
      targetExists: () => true,
    });
    return null;
  }

  renderToStaticMarkup(
    <NuqsTestingAdapter onUrlUpdate={onUrlUpdate} searchParams={searchParams}>
      <Harness />
    </NuqsTestingAdapter>
  );

  assert.ok(routeState);
  return routeState;
}

function waitForUrlUpdateQueue(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

test("clearing an already clear Canvas does not enqueue a URL or history update", async () => {
  const updates: UrlUpdateEvent[] = [];
  const routeState = renderRouteState((event) => updates.push(event));

  routeState.clearCanvasFocus();
  await waitForUrlUpdateQueue();

  assert.deepEqual(updates, []);
});

test("opening a real Canvas surface preserves the URL and Back transition", async () => {
  const updates: UrlUpdateEvent[] = [];
  const routeState = renderRouteState((event) => updates.push(event));

  routeState.openMain({
    kind: "resourceLogs",
    target: { kind: "DB", name: "pg", namespace: "default" },
  });
  await waitForUrlUpdateQueue();

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.queryString, "?main=resource-logs:db:default:pg");
  assert.equal(updates[0]?.options.history, "push");
});

test("an invalid raw Canvas query bypasses the value-equality guard", async () => {
  const updates: UrlUpdateEvent[] = [];
  const routeState = renderRouteState(
    (event) => updates.push(event),
    "?selected=service:legacy"
  );

  routeState.clearCanvasFocus();
  await waitForUrlUpdateQueue();

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.queryString, "");
  assert.equal(updates[0]?.options.history, "push");
});

test("automatic invalid Canvas query repair replaces browser history", () => {
  const query = {
    drawer: null,
    main: null,
    selected: "service:legacy",
    side: null,
  };
  const parsedState = parseProjectWorkbenchRouteState(query);
  const repair = planInvalidProjectWorkbenchRouteRepair({
    isSideEntrySupported: () => true,
    parsedState,
    query,
    state: parsedState,
  });

  assert.ok(repair);
  assert.equal(repair.history, "replace");
  assert.deepEqual(serializeProjectWorkbenchRouteState(repair.next), {
    drawer: null,
    main: null,
    selected: null,
    side: null,
  });
});
