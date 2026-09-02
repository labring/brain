import assert from "node:assert/strict";
import { test } from "node:test";

import { render } from "@testing-library/react/pure";

import { withTestDom } from "@/features/project-canvas/react-test-harness";

async function sectionModule() {
  return await import("./billing-free-turns-section");
}

test("allowance card names the benefit and voices the expiry in the subtitle", async () => {
  await withTestDom(async (act) => {
    const { BillingFreeTurnsSection } = await sectionModule();
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <BillingFreeTurnsSection
            expiresAt="2026-09-01T00:00:00Z"
            usage={{ limit: 5, remaining: 3, used: 2 }}
            usageUnavailable={false}
          />
        );
      });
      const text = rendered?.container.textContent ?? "";
      assert.ok(text.includes("Free trial messages"));
      assert.ok(text.includes("Included with the Free plan"));
      assert.ok(text.includes("until"));
      assert.ok(text.includes("2026"));
      assert.ok(text.includes("3 of 5 left"));
      // Vocabulary red line: this surface never says "AI Credits".
      assert.equal(text.includes("AI Credits"), false);
      const bar = rendered?.getByRole("progressbar", {
        name: "Free trial messages used",
      });
      assert.ok(bar);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("exhausted state stays calm: 'All 5 used', no CTA, no alert", async () => {
  await withTestDom(async (act) => {
    const { BillingFreeTurnsSection } = await sectionModule();
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <BillingFreeTurnsSection
            expiresAt="2026-09-01T00:00:00Z"
            usage={{ limit: 5, remaining: 0, used: 5 }}
            usageUnavailable={false}
          />
        );
      });
      const text = rendered?.container.textContent ?? "";
      assert.ok(text.includes("All 5 used"));
      assert.equal(text.includes("Upgrade"), false);
      assert.equal(rendered?.queryByRole("button"), null);
      assert.equal(rendered?.queryByRole("alert"), null);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("loading shows a right-side skeleton without usage numbers", async () => {
  await withTestDom(async (act) => {
    const { BillingFreeTurnsSection } = await sectionModule();
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <BillingFreeTurnsSection
            expiresAt="2026-09-01T00:00:00Z"
            usage={null}
            usageUnavailable={false}
          />
        );
      });
      assert.ok(
        rendered?.container.querySelector(
          '[aria-label="Loading free trial messages"]'
        )
      );
      assert.equal(
        (rendered?.container.textContent ?? "").includes("left"),
        false
      );
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("a failed usage lookup degrades quietly and reassures, never red", async () => {
  await withTestDom(async (act) => {
    const { BillingFreeTurnsSection } = await sectionModule();
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <BillingFreeTurnsSection
            expiresAt="2026-09-01T00:00:00Z"
            usage={null}
            usageUnavailable
          />
        );
      });
      const text = rendered?.container.textContent ?? "";
      assert.ok(
        text.includes(
          "Usage is unavailable right now — your free trial messages still work."
        )
      );
      // Deliberately different from AI Credits' red error state: a status,
      // not an alert, and no destructive styling.
      assert.equal(rendered?.queryByRole("alert"), null);
      assert.ok(rendered?.getByRole("status"));
      assert.equal(
        rendered?.container.querySelector(".text-destructive"),
        null
      );
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});
