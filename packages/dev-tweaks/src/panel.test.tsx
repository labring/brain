/**
 * Rendering coverage: panel sections (Active hidden when empty, editable
 * cross-page, mock-first ordering), three reset layers, and the indicator
 * capsule (labels, visibility, demo entry, click-to-open) — all through the
 * package's public components against a real store.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
} from "./test/harness";
import type { DevTweaksDriver, DevTweaksGroupDef } from "./types";

const REMOVE_OVERRIDE_LABEL = /^Remove .* override$/;

const TWEAK_DEF = {
  controls: {
    layout: {
      label: "Layout",
      options: ["grid", "list"],
      type: "select",
      value: "grid",
    },
    outline: { label: "Outline", type: "switch", value: false },
  },
  feature: "Projects",
  kind: "tweak",
  title: "Projects · layout",
} as const satisfies DevTweaksGroupDef;

const MOCK_DEF = {
  controls: {
    enabled: { label: "Mock data", type: "switch", value: false },
    scenario: {
      label: "Scenario",
      options: ["alpha", "beta"],
      type: "select",
      value: "alpha",
    },
  },
  feature: "Billing",
  kind: "mock",
  persistence: "billing-mock",
  title: "Billing · mock",
} as const satisfies DevTweaksGroupDef;

const SECOND_MOCK_DEF = {
  controls: {
    empty: { label: "Empty list", type: "switch", value: false },
  },
  feature: "Devbox",
  kind: "mock",
  title: "Devbox · mock",
} as const satisfies DevTweaksGroupDef;

function makeDriver(): DevTweaksDriver & {
  persisted: (Record<string, unknown> | null)[];
} {
  const persisted: (Record<string, unknown> | null)[] = [];
  return {
    load: () => null,
    persist: (_groupKey, values) => {
      persisted.push(values);
    },
    persisted,
  };
}

type TestingLibrary = typeof import("@testing-library/react/pure");
type PackageSurface = typeof import("./index");

async function withScene(
  run: (tools: {
    fireEvent: TestingLibrary["fireEvent"];
    openPanel: () => Promise<void>;
    pkg: PackageSurface;
    renderScene: (
      content: (pkg: PackageSurface) => React.ReactElement
    ) => Promise<{
      container: HTMLElement;
      rerender: (element: React.ReactElement) => void;
      unmount: () => void;
    }>;
    screen: ReturnType<TestingLibrary["within"]>;
  }) => Promise<void>
): Promise<void> {
  const dom = installTestDom();
  const previousAct = setActEnvironment(true);
  const cleanups: (() => void)[] = [];
  try {
    const testingLibrary = await import("@testing-library/react/pure");
    const pkg = await import("./index");
    const { fireEvent, render, within } = testingLibrary;
    // `screen` from the library binds the module-load document.body, which
    // goes stale once a test DOM is restored — bind to the current one.
    const screen = within(document.body);

    const renderScene = async (
      content: (surface: PackageSurface) => React.ReactElement
    ) => {
      let rendered: ReturnType<typeof render> | null = null;
      await actAndDrain(() => {
        rendered = render(content(pkg));
      });
      if (!rendered) {
        throw new Error("scene did not render");
      }
      const scene = rendered as ReturnType<typeof render>;
      cleanups.push(() => scene.unmount());
      return {
        container: scene.container,
        rerender: scene.rerender,
        unmount: scene.unmount,
      };
    };

    const openPanel = async () => {
      await actAndDrain(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            altKey: true,
            bubbles: true,
            code: "KeyT",
            ctrlKey: true,
          })
        );
      });
    };

    await run({ fireEvent, openPanel, pkg, renderScene, screen });
  } finally {
    for (const cleanup of cleanups.reverse()) {
      cleanup();
    }
    restoreActEnvironment(previousAct);
    await dom.restore();
  }
}

function Probe({
  def,
  groupKey,
  pkg,
}: {
  def: DevTweaksGroupDef;
  groupKey: string;
  pkg: PackageSurface;
}) {
  pkg.useDevTweaks(groupKey, def);
  return null;
}

test("Active section hides when empty, appears on override, and clears via ×", async () => {
  await withScene(async ({ fireEvent, openPanel, renderScene, screen }) => {
    const driver = makeDriver();
    const scene = (surface: PackageSurface) => (
      <surface.DevTweaksProvider drivers={{ "billing-mock": driver }}>
        <Probe def={MOCK_DEF} groupKey="billing" pkg={surface} />
        <surface.DevTweaksPanel>
          <div>app</div>
        </surface.DevTweaksPanel>
      </surface.DevTweaksProvider>
    );
    await renderScene(scene);
    await openPanel();

    assert.equal(screen.queryByText("Active"), null);

    const mockSwitch = screen.getByLabelText("Mock data");
    await actAndDrain(() => {
      fireEvent.click(mockSwitch);
    });
    assert.ok(screen.getByText("Active"));
    assert.deepEqual(driver.persisted.at(-1), { enabled: true });

    const remove = screen.getByLabelText("Remove Mock data override");
    await actAndDrain(() => {
      fireEvent.click(remove);
    });
    assert.equal(screen.queryByText("Active"), null);
    assert.equal(driver.persisted.at(-1), null);
  });
});

test("mock groups render before tweak groups on this screen", async () => {
  await withScene(async ({ openPanel, renderScene }) => {
    const scene = (surface: PackageSurface) => (
      <surface.DevTweaksProvider>
        {/* Tweak registers first — mock must still render first. */}
        <Probe def={TWEAK_DEF} groupKey="projects" pkg={surface} />
        <Probe def={SECOND_MOCK_DEF} groupKey="devbox" pkg={surface} />
        <surface.DevTweaksPanel>
          <div>app</div>
        </surface.DevTweaksPanel>
      </surface.DevTweaksProvider>
    );
    const { container } = await renderScene(scene);
    await openPanel();

    const titles = [...container.querySelectorAll(".dtp-grouptitle")].map(
      (node) => node.textContent
    );
    assert.deepEqual(titles, ["Devbox · mock", "Projects · layout"]);
  });
});

test("Active entries survive navigation and stay editable cross-page", async () => {
  await withScene(
    async ({ fireEvent, openPanel, pkg, renderScene, screen }) => {
      const driver = makeDriver();
      const withProbe = (surface: PackageSurface) => (
        <surface.DevTweaksProvider drivers={{ "billing-mock": driver }}>
          <Probe def={MOCK_DEF} groupKey="billing" pkg={surface} />
          <surface.DevTweaksPanel>
            <div>app</div>
          </surface.DevTweaksPanel>
        </surface.DevTweaksProvider>
      );
      const withoutProbe = (surface: PackageSurface) => (
        <surface.DevTweaksProvider drivers={{ "billing-mock": driver }}>
          <surface.DevTweaksPanel>
            <div>app</div>
          </surface.DevTweaksPanel>
        </surface.DevTweaksProvider>
      );
      const { rerender } = await renderScene(withProbe);
      await openPanel();

      await actAndDrain(() => {
        fireEvent.click(screen.getByLabelText("Mock data"));
      });
      // Navigate away — the group unmounts, the override entry stays.
      await actAndDrain(() => {
        rerender(withoutProbe(pkg));
      });
      assert.ok(screen.getByText("Active"));
      assert.equal(
        screen.queryByText("This screen")?.textContent,
        "This screen"
      );

      // Editing from "Active" still routes through the named driver.
      await actAndDrain(() => {
        fireEvent.click(screen.getByLabelText("Mock data"));
      });
      assert.deepEqual(driver.persisted.at(-1), { enabled: false });
    }
  );
});

test("three reset layers: control, group, clear all", async () => {
  await withScene(async ({ fireEvent, openPanel, renderScene, screen }) => {
    const scene = (surface: PackageSurface) => (
      <surface.DevTweaksProvider>
        <Probe def={TWEAK_DEF} groupKey="projects" pkg={surface} />
        <Probe def={SECOND_MOCK_DEF} groupKey="devbox" pkg={surface} />
        <surface.DevTweaksPanel>
          <div>app</div>
        </surface.DevTweaksPanel>
      </surface.DevTweaksProvider>
    );
    await renderScene(scene);
    await openPanel();

    const clearAll = screen.getByText("Clear all") as HTMLButtonElement;
    assert.equal(clearAll.disabled, true);

    await actAndDrain(() => {
      fireEvent.click(screen.getByLabelText("Outline"));
      fireEvent.change(screen.getByLabelText("Layout"), {
        target: { value: "list" },
      });
      fireEvent.click(screen.getByLabelText("Empty list"));
    });
    assert.equal(screen.getAllByLabelText(REMOVE_OVERRIDE_LABEL).length, 3);

    // Layer 1 — single control reset.
    await actAndDrain(() => {
      fireEvent.click(screen.getAllByLabelText("Reset Outline")[0] as Element);
    });
    assert.equal(screen.getAllByLabelText(REMOVE_OVERRIDE_LABEL).length, 2);

    // Layer 2 — group reset.
    await actAndDrain(() => {
      fireEvent.click(
        screen.getByLabelText("Reset Projects · layout to defaults")
      );
    });
    assert.equal(screen.getAllByLabelText(REMOVE_OVERRIDE_LABEL).length, 1);

    // Layer 3 — footer clear all.
    assert.equal(clearAll.disabled, false);
    await actAndDrain(() => {
      fireEvent.click(clearAll);
    });
    assert.equal(screen.queryByText("Active"), null);
    assert.equal(clearAll.disabled, true);
  });
});

test("indicator capsule: labels, visibility, and click-to-open", async () => {
  await withScene(async ({ fireEvent, openPanel, renderScene, screen }) => {
    const driver = makeDriver();
    const scene = (surface: PackageSurface) => (
      <surface.DevTweaksProvider drivers={{ "billing-mock": driver }}>
        <Probe def={MOCK_DEF} groupKey="billing" pkg={surface} />
        <Probe def={TWEAK_DEF} groupKey="projects" pkg={surface} />
        <surface.DevTweaksPanel>
          <div>app</div>
        </surface.DevTweaksPanel>
        <surface.DevTweaksIndicator />
      </surface.DevTweaksProvider>
    );
    await renderScene(scene);

    // Clean store → no capsule.
    assert.equal(screen.queryByTitle("Open dev tweaks"), null);

    // Tweak override only → grey "1 override".
    await openPanel();
    await actAndDrain(() => {
      fireEvent.click(screen.getByLabelText("Outline"));
    });
    // Panel open → capsule hidden even though dirty.
    assert.equal(screen.queryByTitle("Open dev tweaks"), null);
    await openPanel();
    const capsule = screen.getByTitle("Open dev tweaks");
    assert.equal(capsule.textContent, "1 override");
    assert.equal(capsule.getAttribute("data-mock"), null);

    // Single mock with a scenario select → MOCK · <scenario>.
    await openPanel();
    await actAndDrain(() => {
      fireEvent.click(screen.getByLabelText("Mock data"));
      fireEvent.change(screen.getByLabelText("Scenario"), {
        target: { value: "beta" },
      });
    });
    await openPanel();
    const mockCapsule = screen.getByTitle("Open dev tweaks");
    assert.equal(mockCapsule.textContent, "MOCK · beta");
    assert.equal(mockCapsule.getAttribute("data-mock"), "true");

    // Clicking the capsule opens the panel and the capsule leaves.
    await actAndDrain(() => {
      fireEvent.click(mockCapsule);
    });
    assert.equal(screen.queryByTitle("Open dev tweaks"), null);
    const panel = screen.getByLabelText("Dev tweaks", { selector: "aside" });
    assert.equal(panel.hasAttribute("inert"), false);
  });
});

test("indicator shows MOCK ×N for several active mock groups", async () => {
  await withScene(async ({ fireEvent, openPanel, renderScene, screen }) => {
    const driver = makeDriver();
    const scene = (surface: PackageSurface) => (
      <surface.DevTweaksProvider drivers={{ "billing-mock": driver }}>
        <Probe def={MOCK_DEF} groupKey="billing" pkg={surface} />
        <Probe def={SECOND_MOCK_DEF} groupKey="devbox" pkg={surface} />
        <surface.DevTweaksPanel>
          <div>app</div>
        </surface.DevTweaksPanel>
        <surface.DevTweaksIndicator />
      </surface.DevTweaksProvider>
    );
    await renderScene(scene);
    await openPanel();
    await actAndDrain(() => {
      fireEvent.click(screen.getByLabelText("Mock data"));
      fireEvent.click(screen.getByLabelText("Empty list"));
    });
    await openPanel();
    assert.equal(screen.getByTitle("Open dev tweaks").textContent, "MOCK ×2");
  });
});

test("demo entry: alwaysVisible keeps the capsule present when clean", async () => {
  await withScene(async ({ renderScene, screen }) => {
    const scene = (surface: PackageSurface) => (
      <surface.DevTweaksProvider>
        <surface.DevTweaksPanel>
          <div>app</div>
        </surface.DevTweaksPanel>
        <surface.DevTweaksIndicator alwaysVisible />
      </surface.DevTweaksProvider>
    );
    await renderScene(scene);
    const capsule = screen.getByTitle("Open dev tweaks");
    assert.equal(capsule.textContent, "Dev tweaks");
  });
});
