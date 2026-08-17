/**
 * Test plumbing for `bun test` + node:test, mirroring the host app's
 * react-test-harness: happy-dom registered per test, React act environment
 * toggled explicitly, and modules under test imported after the DOM exists.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

export interface TestDom {
  restore: () => Promise<void>;
}

export function installTestDom(): TestDom {
  if (GlobalRegistrator.isRegistered) {
    throw new Error("A test DOM is already registered — restore it first.");
  }
  GlobalRegistrator.register({ url: "https://dev-tweaks.test" });
  return {
    restore: async () => {
      await GlobalRegistrator.unregister();
    },
  };
}

interface ActGlobal {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

export function setActEnvironment(enabled: boolean): boolean | undefined {
  const actGlobal = globalThis as ActGlobal;
  const previous = actGlobal.IS_REACT_ACT_ENVIRONMENT;
  actGlobal.IS_REACT_ACT_ENVIRONMENT = enabled;
  return previous;
}

export function restoreActEnvironment(previous: boolean | undefined): void {
  const actGlobal = globalThis as ActGlobal;
  if (previous === undefined) {
    actGlobal.IS_REACT_ACT_ENVIRONMENT = undefined;
    return;
  }
  actGlobal.IS_REACT_ACT_ENVIRONMENT = previous;
}

/** Settles React, then drains work queued on a timer or microtask. */
export async function actAndDrain(
  fn: () => Promise<void> | void,
  drainMs = 10
): Promise<void> {
  const { act } = await import("react");
  await act(async () => {
    await fn();
  });
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, drainMs);
    });
  });
}
