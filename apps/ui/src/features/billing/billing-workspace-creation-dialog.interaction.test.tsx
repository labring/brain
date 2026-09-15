import assert from "node:assert/strict";
import { test } from "node:test";

import { fireEvent, render, within } from "@testing-library/react/pure";

import { withTestDom } from "@/features/project-canvas/react-test-harness";
import type { BillingPlanSnapshot } from "./billing-plan-data";
import type { BillingWorkspaceCreationServices } from "./billing-workspace-creation-dialog";
import { WorkspaceNameConflictError } from "./workspace-creation-client";
import { consumePendingWorkspaceCreation } from "./workspace-creation-return";

const PLANS: BillingPlanSnapshot["plans"] = [
  {
    changeKind: null,
    description: "Free workspace plan",
    hasMonthlyPrice: false,
    id: "free",
    isCurrent: true,
    name: "Free",
    order: 0,
    priceMicroUnits: 0,
    resources: [{ label: "CPU", value: "1" }],
  },
  {
    changeKind: "upgrade",
    description: "For growing workloads",
    id: "pro",
    isCurrent: false,
    name: "Pro",
    order: 2,
    priceMicroUnits: 20_000_000,
    resources: [{ label: "CPU", value: "4" }],
  },
  {
    changeKind: "upgrade",
    description: "For larger teams",
    id: "team",
    isCurrent: false,
    name: "Team",
    order: 3,
    priceMicroUnits: 50_000_000,
    resources: [{ label: "CPU", value: "12" }],
  },
];

const EXISTING_NAMES = ["private team", "Acme"];
const CREDENTIALS = { appToken: "desktop-app-token", kubeconfig: "kc" };
const STARTED = {
  invoiceId: "inv-1",
  payId: "pay-1",
  redirectUrl: "https://checkout.stripe.test/inv-1",
  status: "started" as const,
};
const CREATED = { id: "ns-new00001", name: "Robotics", uid: "uid-new" };

function fakeServices(
  overrides: Partial<BillingWorkspaceCreationServices> = {}
) {
  const calls: { kind: string; input: unknown }[] = [];
  const services: BillingWorkspaceCreationServices = {
    createWorkspace: (input) => {
      calls.push({ input, kind: "create" });
      return Promise.resolve({ payment: STARTED, workspace: CREATED });
    },
    openUrl: () => undefined,
    redirectTop: (url) => {
      calls.push({ input: url, kind: "redirect" });
    },
    retryPayment: (input) => {
      calls.push({ input, kind: "retry" });
      return Promise.resolve(STARTED);
    },
    ...overrides,
  };
  return { calls, services };
}

async function mountDialog(
  act: Parameters<Parameters<typeof withTestDom>[0]>[0],
  services: BillingWorkspaceCreationServices,
  onOpenChange: (open: boolean) => void = () => undefined
) {
  const { BillingWorkspaceCreationDialog } = await import(
    "./billing-workspace-creation-dialog"
  );
  let rendered: ReturnType<typeof render> | undefined;
  await act(() => {
    rendered = render(
      <BillingWorkspaceCreationDialog
        credentials={CREDENTIALS}
        currency="usd"
        existingWorkspaceNames={EXISTING_NAMES}
        gpuEnabled
        onOpenChange={onOpenChange}
        open
        plans={PLANS}
        regionDomain="us.example.test"
        services={services}
      />
    );
  });
  if (rendered == null) {
    throw new Error("dialog did not render");
  }
  return rendered;
}

function nameInput(rendered: ReturnType<typeof render>): HTMLInputElement {
  return rendered.getByRole("textbox", {
    name: "Workspace name",
  }) as HTMLInputElement;
}

/**
 * A real focus plus a keyUp flush after the input: React falls back to
 * keystroke polling for change detection when react-dom was first loaded
 * without a DOM, as happens mid-suite, and drops a bare input event.
 */
async function typeName(
  act: Parameters<Parameters<typeof withTestDom>[0]>[0],
  rendered: ReturnType<typeof render>,
  value: string
) {
  await act(() => {
    const field = nameInput(rendered);
    field.focus();
    fireEvent.input(field, { target: { value } });
    fireEvent.keyUp(field, { key: value.at(-1) ?? "" });
  });
}

async function pickPro(
  act: Parameters<Parameters<typeof withTestDom>[0]>[0],
  rendered: ReturnType<typeof render>
) {
  await act(() => {
    // Every paid plan reads "Subscribe" in creation; Pro sorts first.
    const [subscribe] = rendered.getAllByRole("button", { name: "Subscribe" });
    if (subscribe != null) {
      fireEvent.click(subscribe);
    }
  });
}

test("the creation dialog names the Workspace beside the paid plans only", async () => {
  await withTestDom(async (act) => {
    const { services } = fakeServices();
    const rendered = await mountDialog(act, services);
    try {
      const dialog = rendered.getByRole("dialog", { name: "New Workspace" });
      assert.ok(
        within(dialog).getByRole("textbox", { name: "Workspace name" })
      );
      assert.equal(nameInput(rendered).value, "");
      const text = dialog.textContent ?? "";
      assert.ok(text.includes("Pro"));
      assert.ok(text.includes("Team"));
      assert.equal(text.includes("Free"), false);
      assert.equal(
        rendered.getAllByRole("button", { name: "Subscribe" }).length,
        2
      );
    } finally {
      await act(() => rendered.unmount());
    }
  });
});

test("picking a plan with a bad name reports it inline and never submits", async () => {
  await withTestDom(async (act) => {
    const { calls, services } = fakeServices();
    const rendered = await mountDialog(act, services);
    try {
      for (const [value, message] of [
        ["   ", "Enter a name for the Workspace."],
        ["x".repeat(33), "Use at most 32 characters."],
        [" acme ", "A Workspace with this name already exists."],
      ] as const) {
        await typeName(act, rendered, value);
        await pickPro(act, rendered);
        assert.equal(rendered.getByRole("alert").textContent, message);
        assert.equal(nameInput(rendered).getAttribute("aria-invalid"), "true");
        assert.equal(
          rendered.queryByRole("dialog", { name: "Create Workspace" }),
          null
        );
      }
      assert.deepEqual(calls, []);

      // Typing again clears the verdict until the next attempt.
      await typeName(act, rendered, "Robotics");
      assert.equal(rendered.queryByRole("alert"), null);
    } finally {
      await act(() => rendered.unmount());
    }
  });
});

test("a valid name and plan confirm, create, and hand the top window to Stripe", async () => {
  await withTestDom(async (act) => {
    const { calls, services } = fakeServices();
    const rendered = await mountDialog(act, services);
    try {
      await typeName(act, rendered, "  Robotics ");
      await pickPro(act, rendered);

      const confirm = rendered.getByRole("dialog", {
        name: "Create Workspace",
      });
      const summary = confirm.textContent ?? "";
      assert.ok(summary.includes("Robotics"));
      assert.ok(summary.includes("Pro"));
      assert.ok(summary.includes("$20.00"));
      assert.deepEqual(calls, []);

      await act(() => {
        fireEvent.click(
          within(confirm).getByRole("button", { name: "Create & Pay" })
        );
      });

      assert.deepEqual(calls, [
        {
          input: {
            ...CREDENTIALS,
            name: "Robotics",
            planName: "Pro",
            regionDomain: "us.example.test",
          },
          kind: "create",
        },
        { input: STARTED.redirectUrl, kind: "redirect" },
      ]);
      // The return leg tells a creation from a plan change by this record.
      assert.equal(consumePendingWorkspaceCreation(CREATED.id), true);
    } finally {
      await act(() => rendered.unmount());
    }
  });
});

test("a taken name Desktop reports lands inline on the field", async () => {
  await withTestDom(async (act) => {
    const { calls, services } = fakeServices({
      createWorkspace: () => Promise.reject(new WorkspaceNameConflictError()),
    });
    const rendered = await mountDialog(act, services);
    try {
      await typeName(act, rendered, "Robotics");
      await pickPro(act, rendered);
      await act(() => {
        fireEvent.click(rendered.getByRole("button", { name: "Create & Pay" }));
      });

      assert.equal(
        rendered.queryByRole("dialog", { name: "Create Workspace" }),
        null
      );
      assert.equal(
        rendered.getByRole("alert").textContent,
        "A Workspace with this name already exists."
      );
      assert.equal(
        calls.some((call) => call.kind === "redirect"),
        false
      );
    } finally {
      await act(() => rendered.unmount());
    }
  });
});

test("a failed first payment offers to retry it or leave the created Workspace as is", async () => {
  await withTestDom(async (act) => {
    const closes: boolean[] = [];
    const { calls, services } = fakeServices({
      createWorkspace: () =>
        Promise.resolve({
          payment: { error: "card declined", status: "failed" as const },
          workspace: CREATED,
        }),
    });
    const rendered = await mountDialog(act, services, (open) =>
      closes.push(open)
    );
    try {
      await typeName(act, rendered, "Robotics");
      await pickPro(act, rendered);
      await act(() => {
        fireEvent.click(rendered.getByRole("button", { name: "Create & Pay" }));
      });

      const failed = rendered.getByRole("dialog", {
        name: "Workspace created",
      });
      const text = failed.textContent ?? "";
      assert.ok(text.includes("Robotics"));
      assert.ok(text.includes("payment could not be started"));
      assert.ok(text.includes("card declined"));
      assert.equal(consumePendingWorkspaceCreation(CREATED.id), false);

      await act(() => {
        fireEvent.click(
          within(failed).getByRole("button", { name: "Retry payment" })
        );
      });
      assert.deepEqual(calls, [
        {
          input: {
            ...CREDENTIALS,
            planName: "Pro",
            regionDomain: "us.example.test",
            workspaceId: CREATED.id,
          },
          kind: "retry",
        },
        { input: STARTED.redirectUrl, kind: "redirect" },
      ]);
      assert.equal(consumePendingWorkspaceCreation(CREATED.id), true);
    } finally {
      await act(() => rendered.unmount());
    }
  });
});

test("Later closes the whole dialog without touching the created Workspace", async () => {
  await withTestDom(async (act) => {
    const closes: boolean[] = [];
    const { calls, services } = fakeServices({
      createWorkspace: () =>
        Promise.resolve({
          payment: { error: "card declined", status: "failed" as const },
          workspace: CREATED,
        }),
    });
    const rendered = await mountDialog(act, services, (open) =>
      closes.push(open)
    );
    try {
      await typeName(act, rendered, "Robotics");
      await pickPro(act, rendered);
      await act(() => {
        fireEvent.click(rendered.getByRole("button", { name: "Create & Pay" }));
      });
      await act(() => {
        fireEvent.click(rendered.getByRole("button", { name: "Later" }));
      });
      assert.deepEqual(closes, [false]);
      assert.deepEqual(calls, []);
    } finally {
      await act(() => rendered.unmount());
    }
  });
});
