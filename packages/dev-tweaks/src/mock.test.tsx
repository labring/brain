/**
 * Coverage for the first-class mock surface: registration through
 * useDevTweaksMock, write-through to the source, external-change adoption
 * with echo dedupe, and the enabled-mock → dirty launcher rule.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { DevTweaksMockSource, DevTweaksMockState } from "./index";
import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
} from "./test/harness";

const SCENARIOS = ["active", "free", "debt"] as const;

const WRITE_DID_NOT_TAKE = /write did not take/;

/** A source over a plain variable, standing in for the cookie. */
function createFakeSource(initial: DevTweaksMockState | null = null) {
  const backing = { state: initial };
  const watchers = new Set<() => void>();
  let unwatchCount = 0;
  const source: DevTweaksMockSource = {
    load: () => backing.state,
    set: (state) => {
      backing.state = state;
    },
    watch: (onChange) => {
      watchers.add(onChange);
      return () => {
        watchers.delete(onChange);
        unwatchCount += 1;
      };
    },
  };
  return {
    backing,
    source,
    notifyWatchers: () => {
      for (const watcher of watchers) {
        watcher();
      }
    },
    getUnwatchCount: () => unwatchCount,
    getWatcherCount: () => watchers.size,
  };
}

test("mock section renders, and the toggle writes through the source", async () => {
  const dom = installTestDom();
  const previousAct = setActEnvironment(true);
  try {
    const { DevTweaksRoot, useDevTweaksMock } = await import("./index");
    const { cleanup, render, within } = await import(
      "@testing-library/react/pure"
    );
    const body = () => within(document.body);
    const fake = createFakeSource();

    function Probe() {
      const state = useDevTweaksMock("billing-mock", {
        note: "Serves fixtures",
        scenarios: SCENARIOS,
        source: fake.source,
        title: "Billing mock",
      });
      return <output data-testid="state">{JSON.stringify(state)}</output>;
    }

    await actAndDrain(() => {
      render(
        <>
          <Probe />
          <DevTweaksRoot />
        </>
      );
    });
    assert.ok(body().getByText("Billing mock"));
    assert.ok(body().getByText("MOCK"));
    assert.ok(body().getByText("Serves fixtures"));
    assert.deepEqual(
      JSON.parse(body().getByTestId("state").textContent ?? ""),
      {
        enabled: false,
        scenario: "active",
      }
    );

    await actAndDrain(() => {
      body().getByText("On").click();
    });
    assert.deepEqual(fake.backing.state, { enabled: true, scenario: "active" });
    assert.deepEqual(
      JSON.parse(body().getByTestId("state").textContent ?? ""),
      {
        enabled: true,
        scenario: "active",
      }
    );

    await actAndDrain(() => {
      cleanup();
    });
    assert.equal(fake.getWatcherCount(), 0);
    assert.ok(fake.getUnwatchCount() >= 1);
  } finally {
    restoreActEnvironment(previousAct);
    await dom.restore();
  }
});

test("external source changes are adopted, and unchanged echoes are deduped", async () => {
  const dom = installTestDom();
  const previousAct = setActEnvironment(true);
  try {
    const { useDevTweaksMock } = await import("./index");
    const { MockStore } = await import("./panel/index");
    const { cleanup, render, within } = await import(
      "@testing-library/react/pure"
    );
    const body = () => within(document.body);
    const fake = createFakeSource({ enabled: true, scenario: "active" });

    function Probe() {
      const state = useDevTweaksMock("billing-mock", {
        scenarios: SCENARIOS,
        source: fake.source,
        title: "Billing mock",
      });
      return <output data-testid="state">{JSON.stringify(state)}</output>;
    }

    await actAndDrain(() => {
      render(<Probe />);
    });

    // The server rewrote the backing store behind the panel's back.
    await actAndDrain(() => {
      fake.backing.state = { enabled: true, scenario: "debt" };
      fake.notifyWatchers();
    });
    assert.deepEqual(
      JSON.parse(body().getByTestId("state").textContent ?? ""),
      {
        enabled: true,
        scenario: "debt",
      }
    );

    // An echo (watch fires, nothing changed) must not notify subscribers.
    let notifications = 0;
    const unsubscribe = MockStore.subscribe(() => {
      notifications += 1;
    });
    await actAndDrain(() => {
      fake.notifyWatchers();
    });
    assert.equal(notifications, 0);
    unsubscribe();

    await actAndDrain(() => {
      cleanup();
    });
  } finally {
    restoreActEnvironment(previousAct);
    await dom.restore();
  }
});

test("revalidate runs only when the served answers change", async () => {
  const { MockStore } = await import("./panel/index");
  const fake = createFakeSource();
  const revalidations: string[] = [];
  const KEY = "revalidate-policy-mock";
  MockStore.register(KEY, {
    revalidate: () => revalidations.push("hit"),
    scenarios: SCENARIOS,
    source: fake.source,
    title: "Revalidate policy mock",
  });
  try {
    // Picking a scenario while the mock is off changes nothing served: the
    // panel adopts it, but nothing may refetch (or reload the page).
    MockStore.setScenario(KEY, "debt");
    assert.deepEqual(MockStore.getState(KEY), {
      enabled: false,
      scenario: "debt",
    });
    assert.equal(revalidations.length, 0);

    MockStore.setEnabled(KEY, true);
    assert.equal(revalidations.length, 1);

    MockStore.setScenario(KEY, "free");
    assert.equal(revalidations.length, 2);

    // An external rewrite (the server advancing its cookie) revalidates too
    // — the page must refetch, not just the panel.
    fake.backing.state = { enabled: true, scenario: "active" };
    fake.notifyWatchers();
    assert.equal(revalidations.length, 3);

    // An echo revalidates nothing.
    fake.notifyWatchers();
    assert.equal(revalidations.length, 3);

    MockStore.setEnabled(KEY, false);
    assert.equal(revalidations.length, 4);
  } finally {
    MockStore.unregister(KEY);
  }
});

test("a second registration adopts the def without clobbering live state", async () => {
  const { MockStore } = await import("./panel/index");
  const fake = createFakeSource();
  const KEY = "double-registration-mock";
  const def = {
    scenarios: SCENARIOS,
    source: fake.source,
    title: "Doubly mounted mock",
  };
  MockStore.register(KEY, def);
  try {
    MockStore.setEnabled(KEY, true);
    assert.deepEqual(MockStore.getState(KEY), {
      enabled: true,
      scenario: "active",
    });

    // A second mount of the same key (the def is a fresh object each time).
    MockStore.register(KEY, { ...def });
    assert.deepEqual(
      MockStore.getState(KEY),
      { enabled: true, scenario: "active" },
      "registering again must not reset the mock"
    );

    MockStore.unregister(KEY);
    assert.deepEqual(
      MockStore.getState(KEY),
      { enabled: true, scenario: "active" },
      "one registrant unmounting must not reset the mock"
    );
  } finally {
    MockStore.unregister(KEY);
  }
});

test("a write the source rejects warns instead of failing silently", async () => {
  const { MockStore } = await import("./panel/index");
  const KEY = "rejecting-source-mock";
  // A source whose writes never take — a blocked cookie, say.
  const source: DevTweaksMockSource = {
    load: () => null,
    set: () => undefined,
  };
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  MockStore.register(KEY, {
    scenarios: SCENARIOS,
    source,
    title: "Rejecting mock",
  });
  try {
    MockStore.setEnabled(KEY, true);
    assert.deepEqual(
      MockStore.getState(KEY),
      { enabled: false, scenario: "active" },
      "the panel stays truthful: the source still says off"
    );
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0]?.[0]), WRITE_DID_NOT_TAKE);
  } finally {
    console.warn = originalWarn;
    MockStore.unregister(KEY);
  }
});

test("a reload-revalidating mock reopens the panel after the reload", async () => {
  const dom = installTestDom();
  const previousAct = setActEnvironment(true);
  try {
    const { DevTweaksRoot, useDevTweaksMock } = await import("./index");
    const { preserveDevTweaksPanelAcrossReload, resetPanelVisibilityForTests } =
      await import("./panel/panel-visibility");
    const { cleanup, render, within } = await import(
      "@testing-library/react/pure"
    );
    const body = () => within(document.body);
    const fake = createFakeSource();

    function Probe() {
      useDevTweaksMock("reload-reopen-mock", {
        scenarios: SCENARIOS,
        source: fake.source,
        title: "Reloading mock",
      });
      return null;
    }

    // Panel open (defaultOpen), the revalidator arms the reopen request…
    await actAndDrain(() => {
      render(
        <>
          <Probe />
          <DevTweaksRoot defaultOpen={true} launcher="dirty" />
        </>
      );
    });
    preserveDevTweaksPanelAcrossReload();
    await actAndDrain(() => {
      cleanup();
    });

    // …and the next mount (the reloaded page) consumes it: the panel opens
    // even though its default is closed.
    await actAndDrain(() => {
      render(
        <>
          <Probe />
          <DevTweaksRoot defaultOpen={false} launcher="dirty" />
        </>
      );
    });
    assert.ok(body().getByText("Reloading mock"));
    const inner = document.querySelector(".dev-tweaks-panel-inner");
    assert.equal(inner?.getAttribute("data-collapsed"), "false");

    // One-shot: consuming the request cleared it from storage (the in-page
    // cache stands in for "same page load"; a real reload starts fresh).
    assert.equal(window.sessionStorage.getItem("dev-tweaks.reopen-once"), null);

    await actAndDrain(() => {
      cleanup();
    });
    resetPanelVisibilityForTests();
  } finally {
    restoreActEnvironment(previousAct);
    await dom.restore();
  }
});

test("an enabled mock lights the dirty-only launcher", async () => {
  const dom = installTestDom();
  const previousAct = setActEnvironment(true);
  try {
    const { DevTweaksRoot, useDevTweaksMock } = await import("./index");
    const { MockStore } = await import("./panel/index");
    const { cleanup, render } = await import("@testing-library/react/pure");
    const fake = createFakeSource();

    function Probe() {
      useDevTweaksMock("billing-mock", {
        scenarios: SCENARIOS,
        source: fake.source,
        title: "Billing mock",
      });
      return null;
    }

    await actAndDrain(() => {
      render(
        <>
          <Probe />
          <DevTweaksRoot defaultOpen={false} launcher="dirty" />
        </>
      );
    });
    const panel = () =>
      document.querySelector<HTMLElement>(".dev-tweaks-panel");
    const inner = () =>
      document.querySelector<HTMLElement>(".dev-tweaks-panel-inner");
    assert.equal(panel()?.style.display, "none");
    assert.equal(inner()?.getAttribute("data-mock-form"), null);

    await actAndDrain(() => {
      MockStore.setEnabled("billing-mock", true);
    });
    assert.notEqual(panel()?.style.display, "none");
    assert.deepEqual(fake.backing.state, { enabled: true, scenario: "active" });

    // …and takes its mock form: an amber capsule naming the mode and
    // counting the enabled mocks instead of the anonymous bubble.
    assert.equal(inner()?.getAttribute("data-mock-form"), "true");
    const capsule = document.querySelector(".dev-tweaks-launcher-mock");
    assert.equal(
      capsule?.querySelector(".dev-tweaks-launcher-mock-label")?.textContent,
      "MOCK"
    );
    assert.equal(
      capsule?.querySelector(".dev-tweaks-launcher-mock-count")?.textContent,
      "1"
    );

    await actAndDrain(() => {
      MockStore.setEnabled("billing-mock", false);
    });
    assert.equal(inner()?.getAttribute("data-mock-form"), null);

    await actAndDrain(() => {
      cleanup();
    });
  } finally {
    restoreActEnvironment(previousAct);
    await dom.restore();
  }
});
