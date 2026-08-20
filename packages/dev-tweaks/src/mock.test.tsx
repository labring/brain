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
    assert.equal(panel()?.style.display, "none");

    await actAndDrain(() => {
      MockStore.setEnabled("billing-mock", true);
    });
    assert.notEqual(panel()?.style.display, "none");
    assert.deepEqual(fake.backing.state, { enabled: true, scenario: "active" });

    await actAndDrain(() => {
      cleanup();
    });
  } finally {
    restoreActEnvironment(previousAct);
    await dom.restore();
  }
});
