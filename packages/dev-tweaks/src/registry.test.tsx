/**
 * Headless coverage of the package's public surface: the value channel,
 * sessionStorage persistence, named driver delegation with warning fallback,
 * and def snapshot lifecycle — all through Provider + useDevTweaks probes.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { CSSProperties } from "react";

import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
} from "./test/harness";
import type {
  DevTweaksDriver,
  DevTweaksGroupDef,
  DevTweaksValue,
} from "./types";

const PROBE_DEF = {
  controls: {
    accent: { label: "Accent", type: "color", value: "#112233" },
    enabled: { label: "Enabled", type: "switch", value: false },
    glow: {
      cssVar: "--probe-glow",
      label: "Glow",
      max: 100,
      min: 0,
      type: "slider",
      unit: "%",
      value: 40,
    },
    scenario: {
      label: "Scenario",
      options: ["alpha", "beta"],
      type: "select",
      value: "alpha",
    },
  },
  feature: "Probe",
  kind: "tweak",
  title: "Probe group",
} as const satisfies DevTweaksGroupDef;

interface ProbeResult {
  style: CSSProperties;
  values: Record<string, DevTweaksValue>;
}

async function withHarness(
  run: (tools: {
    mountProbe: (options?: {
      def?: DevTweaksGroupDef;
      drivers?: Record<string, DevTweaksDriver>;
      groupKey?: string;
      withProvider?: boolean;
    }) => Promise<{ latest: () => ProbeResult; unmount: () => void }>;
  }) => Promise<void>
): Promise<void> {
  const dom = installTestDom();
  const previousAct = setActEnvironment(true);
  const cleanups: (() => void)[] = [];
  try {
    const { render } = await import("@testing-library/react/pure");
    const { DevTweaksProvider, useDevTweaks } = await import("./index");

    const mountProbe = async (options?: {
      def?: DevTweaksGroupDef;
      drivers?: Record<string, DevTweaksDriver>;
      groupKey?: string;
      withProvider?: boolean;
    }) => {
      const def = options?.def ?? PROBE_DEF;
      const groupKey = options?.groupKey ?? "probe";
      let result: ProbeResult | null = null;
      function Probe() {
        const probe = useDevTweaks(groupKey, def);
        result = probe;
        return null;
      }
      const tree =
        options?.withProvider === false ? (
          <Probe />
        ) : (
          <DevTweaksProvider drivers={options?.drivers}>
            <Probe />
          </DevTweaksProvider>
        );
      let rendered: { unmount: () => void } | null = null;
      await actAndDrain(() => {
        rendered = render(tree);
      });
      cleanups.push(() => rendered?.unmount());
      return {
        latest: () => {
          assert.ok(result, "probe did not render");
          return result;
        },
        unmount: () => rendered?.unmount(),
      };
    };

    await run({ mountProbe });
  } finally {
    for (const cleanup of cleanups.reverse()) {
      cleanup();
    }
    restoreActEnvironment(previousAct);
    await dom.restore();
  }
}

function storedState(): {
  groups?: Record<
    string,
    {
      at?: Record<string, number>;
      def?: DevTweaksGroupDef;
      values?: Record<string, DevTweaksValue>;
    }
  >;
} {
  const raw = window.sessionStorage.getItem("dev-tweaks.v1");
  return raw ? JSON.parse(raw) : {};
}

function seedStoredState(
  groups: Record<
    string,
    {
      at?: Record<string, number>;
      def?: DevTweaksGroupDef;
      values?: Record<string, DevTweaksValue>;
    }
  >
): void {
  window.sessionStorage.setItem("dev-tweaks.v1", JSON.stringify({ groups }));
}

test("returns defaults and an empty style with no overrides", async () => {
  await withHarness(async ({ mountProbe }) => {
    const probe = await mountProbe();
    assert.deepEqual(probe.latest().values, {
      accent: "#112233",
      enabled: false,
      glow: 40,
      scenario: "alpha",
    });
    assert.deepEqual(probe.latest().style, {});
  });
});

test("stays inert without a Provider", async () => {
  await withHarness(async ({ mountProbe }) => {
    const probe = await mountProbe({ withProvider: false });
    assert.equal(probe.latest().values.glow, 40);
    assert.deepEqual(probe.latest().style, {});
  });
});

test("restores sessionStorage overrides into values and style", async () => {
  await withHarness(async ({ mountProbe }) => {
    seedStoredState({
      probe: {
        at: { enabled: 2, glow: 1 },
        def: PROBE_DEF,
        values: { enabled: true, glow: 72 },
      },
    });
    const probe = await mountProbe();
    assert.equal(probe.latest().values.glow, 72);
    assert.equal(probe.latest().values.enabled, true);
    assert.equal(probe.latest().values.scenario, "alpha");
    assert.deepEqual(probe.latest().style, { "--probe-glow": "72%" });
  });
});

test("drops stored values the def can no longer render", async () => {
  await withHarness(async ({ mountProbe }) => {
    seedStoredState({
      probe: {
        at: { gone: 1, scenario: 2 },
        def: PROBE_DEF,
        values: { gone: 12, scenario: "not-an-option" },
      },
    });
    const probe = await mountProbe();
    assert.equal(probe.latest().values.scenario, "alpha");
    assert.deepEqual(probe.latest().style, {});
  });
});

test("adopts values a named driver already holds", async () => {
  await withHarness(async ({ mountProbe }) => {
    const persisted: unknown[] = [];
    const driver: DevTweaksDriver = {
      load: () => ({ enabled: true, scenario: "beta" }),
      persist: (_groupKey, values) => {
        persisted.push(values);
      },
    };
    const def: DevTweaksGroupDef = {
      ...PROBE_DEF,
      kind: "mock",
      persistence: "probe-driver",
    };
    const probe = await mountProbe({
      def,
      drivers: { "probe-driver": driver },
    });
    assert.equal(probe.latest().values.enabled, true);
    assert.equal(probe.latest().values.scenario, "beta");
    // The driver owns the values — sessionStorage only keeps the snapshot.
    const stored = storedState();
    assert.ok(stored.groups?.probe?.def);
    assert.equal(stored.groups?.probe?.values, undefined);
    // Adoption never writes back to the driver.
    assert.equal(persisted.length, 0);
  });
});

test("warns and falls back to sessionStorage when a driver name is unknown", async () => {
  await withHarness(async ({ mountProbe }) => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      seedStoredState({
        probe: {
          at: { glow: 1 },
          def: { ...PROBE_DEF, persistence: "missing-driver" },
          values: { glow: 55 },
        },
      });
      const probe = await mountProbe({
        def: { ...PROBE_DEF, persistence: "missing-driver" },
      });
      assert.equal(probe.latest().values.glow, 55);
      assert.ok(
        warnings.some((warning) => warning.includes("missing-driver")),
        `expected a warning naming the driver, got: ${warnings.join(" | ")}`
      );
    } finally {
      console.warn = originalWarn;
    }
  });
});

test("refreshes the stored def snapshot when the group remounts", async () => {
  await withHarness(async ({ mountProbe }) => {
    const staleDef: DevTweaksGroupDef = {
      ...PROBE_DEF,
      title: "Stale title",
    };
    seedStoredState({
      probe: { at: { glow: 1 }, def: staleDef, values: { glow: 61 } },
    });
    await mountProbe();
    assert.equal(storedState().groups?.probe?.def?.title, "Probe group");
  });
});

test("overrides survive the owning component unmounting", async () => {
  await withHarness(async ({ mountProbe }) => {
    seedStoredState({
      probe: { at: { glow: 1 }, def: PROBE_DEF, values: { glow: 88 } },
    });
    const first = await mountProbe();
    assert.equal(first.latest().values.glow, 88);
    first.unmount();
    assert.equal(storedState().groups?.probe?.values?.glow, 88);
    const second = await mountProbe();
    assert.equal(second.latest().values.glow, 88);
  });
});
