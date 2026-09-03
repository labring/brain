import assert from "node:assert/strict";
import { test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { render } from "@testing-library/react/pure";
import { act, type ReactElement } from "react";

import { AnimatedThemeToggler } from "./animated-theme-toggler";

const ICON_SETTLE_MS = 320; // Sun/Moon motion transitions run 250ms.

function installTestDom() {
  if (GlobalRegistrator.isRegistered) {
    throw new Error("a test DOM is already registered");
  }
  GlobalRegistrator.register({ url: "https://animated-theme-toggler.test" });
  return () => GlobalRegistrator.unregister();
}

async function withMounted(
  element: ReactElement,
  run: (rendered: ReturnType<typeof render>) => Promise<void> | void
) {
  const restoreDom = installTestDom();
  const reactTestGlobals = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = reactTestGlobals.IS_REACT_ACT_ENVIRONMENT;
  reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true;
  let rendered: ReturnType<typeof render> | undefined;
  try {
    await act(() => {
      rendered = render(element);
    });
    assert.ok(rendered);
    await run(rendered);
  } finally {
    if (rendered) {
      await act(async () => {
        // Let motion icon animations finish before teardown: their timers
        // must not fire against the unregistered DOM in a later test file.
        await new Promise((resolve) => {
          setTimeout(resolve, ICON_SETTLE_MS);
        });
        rendered?.unmount();
      });
    }
    reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    await restoreDom();
  }
}

test("controlled dark mode flips the class synchronously and reports only the requested theme (no VT)", async () => {
  const changes: string[] = [];
  await withMounted(
    <AnimatedThemeToggler
      onThemeChange={(next) => {
        changes.push(next);
      }}
      theme="dark"
    />,
    async ({ container }) => {
      document.documentElement.classList.add("dark");
      const button = container.querySelector("button");
      assert.ok(button, "button should render");

      // happy-dom has no startViewTransition -> fallback path: class flips
      // immediately, the owner is told the new theme.
      await act(() => {
        button.click();
      });

      assert.deepEqual(changes, ["light"]);
      assert.equal(
        document.documentElement.classList.contains("dark"),
        false,
        "controlled toggler paints the dark class itself so a later VT can snapshot it"
      );
    }
  );
});

test("controlled mode never writes localStorage and keeps the parent-owned theme", async () => {
  await withMounted(
    <AnimatedThemeToggler
      onThemeChange={() => {
        // parent persists; component must not touch storage
      }}
      theme="dark"
    />,
    async ({ container }) => {
      document.documentElement.classList.add("dark");
      localStorage.clear();
      const button = container.querySelector("button");
      assert.ok(button);
      await act(() => {
        button.click();
      });
      assert.equal(
        localStorage.getItem("theme"),
        null,
        "controlled mode must not persist; the owner (next-themes) does"
      );
    }
  );
});

test("uncontrolled mode toggles the class both ways and persists to localStorage", async () => {
  await withMounted(<AnimatedThemeToggler />, async ({ container }) => {
    const button = container.querySelector("button");
    assert.ok(button);

    // light -> dark (no dark class at mount, so the handler state is settled)
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    assert.equal(document.documentElement.classList.contains("dark"), true);
    assert.equal(localStorage.getItem("theme"), "dark");

    // dark -> light (flush the MutationObserver mirror first so the handler
    // closure observes the dark class)
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    assert.equal(document.documentElement.classList.contains("dark"), false);
    assert.equal(localStorage.getItem("theme"), "light");
  });
});

test("an in-flight view transition suppresses repeat clicks until cleanup", async () => {
  let vtCount = 0;
  let resolveReady: () => void = () => undefined;
  let resolveFinished: () => void = () => undefined;
  const changes: string[] = [];
  await withMounted(
    <AnimatedThemeToggler
      onThemeChange={(next) => {
        changes.push(next);
      }}
      theme="dark"
    />,
    async ({ container }) => {
      document.documentElement.classList.add("dark");
      // Opaque slot for the stub: the lib.dom ViewTransition signature is
      // narrower than what the component actually reads (.ready/.finished).
      const doc = document as unknown as Record<string, unknown>;
      doc.startViewTransition = (cb: () => void) => {
        vtCount += 1;
        cb();
        return {
          ready: new Promise<void>((resolve) => {
            resolveReady = resolve;
          }),
          finished: new Promise<void>((resolve) => {
            resolveFinished = resolve;
          }),
        };
        // Partial VT object — the component only reads .ready/.finished.
      };
      (Element.prototype as unknown as { animate?: unknown }).animate ??=
        () => ({
          cancel: () => undefined,
          finished: Promise.resolve(),
        });

      const button = container.querySelector("button");
      assert.ok(button);

      await act(() => {
        button.click();
      });
      // Still in flight: a second click must be a no-op.
      await act(() => {
        button.click();
      });
      assert.equal(vtCount, 1, "re-entrant clicks must not start a second VT");
      assert.deepEqual(changes, ["light"]);
      assert.equal(
        document.documentElement.dataset.sealaiThemeVt,
        "active",
        "the scoped VT attrs stay pinned while in flight"
      );

      // Settle: resolve the pending VT promises inside act so the cleanup
      // state update flushes.
      await act(async () => {
        resolveReady();
        resolveFinished();
        await Promise.resolve();
        await Promise.resolve();
      });
      assert.equal(
        document.documentElement.dataset.sealaiThemeVt,
        undefined,
        "cleanup removes the scoped VT attrs"
      );
      assert.equal(
        document.documentElement.style.getPropertyValue(
          "--sealai-theme-toggle-vt-duration"
        ),
        ""
      );
      // happy-dom ships no native startViewTransition; restoring the
      // pre-test (undefined) value keeps the stub from leaking.
      doc.startViewTransition = undefined;
    }
  );
});

test("the button carries an accessible name even before the icon mounts", async () => {
  await withMounted(<AnimatedThemeToggler theme="dark" />, ({ container }) => {
    const button = container.querySelector("button");
    assert.ok(button);
    assert.ok(
      (button.textContent ?? "").includes("Toggle theme"),
      "accessible sr-only name present"
    );
  });
});

// The icon is hidden during SSR/hydration and appears after mount; each theme
// shows the opposite glyph (Sun invites "go light", Moon invites "go dark").
// Sun is the only glyph containing a <circle> in lucide, which distinguishes
// them without depending on generated class names.
async function mountedIcon(container: HTMLElement) {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
  const slot = container.querySelector(
    '[data-slot="animated-theme-toggler-icon"]'
  );
  assert.ok(slot, "icon slot should render");
  return slot.querySelector("svg");
}

test("dark theme renders the Sun glyph once mounted", async () => {
  await withMounted(
    <AnimatedThemeToggler theme="dark" />,
    async ({ container }) => {
      const icon = await mountedIcon(container);
      assert.ok(icon, "one icon should show after mount");
      assert.ok(
        icon.querySelector("circle"),
        "dark theme should show the Sun (rays circle)"
      );
    }
  );
});

test("light theme renders the Moon glyph once mounted", async () => {
  await withMounted(
    <AnimatedThemeToggler theme="light" />,
    async ({ container }) => {
      const icon = await mountedIcon(container);
      assert.ok(icon, "one icon should show after mount");
      assert.equal(
        icon.querySelector("circle"),
        null,
        "light theme should show the Moon (path only)"
      );
    }
  );
});
