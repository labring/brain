import { mock, test } from "bun:test";
import assert from "node:assert/strict";
import { SIDEBAR_COOKIE_NAME } from "@workspace/ui/lib/sidebar-cookie";
import { getDefaultStore } from "jotai";
import type { ReactNode } from "react";
import { SNAPSHOT_WORKSPACE_QUOTA_RESOURCES } from "@/features/billing/workspace-quota-payload";
import {
  actAndDrain,
  defineGlobal,
  installTestDom,
  jsonResponse,
  requestUrl,
  restoreActEnvironment,
  restoreGlobal,
  setActEnvironment,
} from "@/features/project-canvas/react-test-harness";
import type {
  ProjectExplorerProject,
  ProjectExplorerStates,
} from "@/features/projects/explorer/project-explorer.types";
import {
  appTokenAtom,
  desktopUserAvatarAtom,
  desktopUserIdAtom,
  desktopUserNameAtom,
  kubeconfigAtom,
  namespaceAtom,
} from "@/lib/auth-store";

const projects: ProjectExplorerProject[] = [
  { createdAt: "2026-05-26T00:00:00.000Z", id: "alpha", name: "Alpha" },
  { createdAt: "2026-05-26T00:00:00.000Z", id: "beta", name: "Beta" },
  { createdAt: "2026-05-26T00:00:00.000Z", id: "gamma", name: "Gamma" },
];

const route = { pathname: "/project/alpha" };
const explorer = {
  states: {
    pinnedProjectIds: ["alpha"],
    projects,
  } satisfies ProjectExplorerStates,
};

// The account section reads the subscription through the real billing proxy
// loader; the fetch stub serves these fixtures. null = the route fails and
// the section must degrade. A `hold` promise, when set, delays the answer so
// a test can observe the in-flight skeleton state.
const billing = {
  hold: null as Promise<void> | null,
  subscription: null as Record<string, unknown> | null,
};
const workspaceQuota = {
  hold: null as Promise<void> | null,
  items: [] as unknown[] | null,
  requests: 0,
};
// The popover's AI usage row fixtures. null = the route fails and the row
// must be omitted alone.
const aiUsage = {
  credits: null as Record<string, unknown> | null,
  freeTurns: null as Record<string, unknown> | null,
  hold: null as Promise<void> | null,
};

function deferred(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function snapshotQuantitySuffix(scale: "mebi" | "milli" | "unit"): string {
  if (scale === "milli") {
    return "m";
  }
  if (scale === "mebi") {
    return "Mi";
  }
  return "";
}

const ACCOUNT_USER = { id: "usr-Kx92mQ", name: "Ada Lovelace" };
const ACCOUNT_NAME_RE = /Ada Lovelace/;
const ACCOUNT_ID_RE = new RegExp(`ID: ${ACCOUNT_USER.id}`);
const AI_CREDITS_LABEL_RE = /AI Credits/;
const AI_CREDITS_VALUE_RE = /240\/300/;
const FREE_TURNS_LABEL_RE = /Free msgs/;
const FREE_TURNS_VALUE_RE = /5\/5/;

function proSubscription(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    CancelAtPeriodEnd: false,
    CurrentPeriodEndAt: "2026-09-12T12:00:00Z",
    PayMethod: "stripe",
    PlanName: "PRO",
    Status: "normal",
    type: "SUBSCRIPTION",
    ...overrides,
  };
}

function workspaceQuotaPayload(items: unknown[]): Record<string, unknown> {
  const hard: Record<string, string> = {};
  const used: Record<string, string> = {};
  for (const item of items) {
    if (typeof item !== "object" || item == null) {
      continue;
    }
    const quota = item as { limit?: number; type?: string; used?: number };
    if (quota.limit === undefined || quota.used === undefined) {
      continue;
    }
    const definition = SNAPSHOT_WORKSPACE_QUOTA_RESOURCES.find(
      ({ type }) => type === quota.type
    );
    const resource =
      definition == null
        ? null
        : {
            key: definition.keys[0],
            suffix: snapshotQuantitySuffix(definition.snapshotScale),
          };
    if (resource == null) {
      continue;
    }
    hard[resource.key] = `${quota.limit}${resource.suffix}`;
    used[resource.key] = `${quota.used}${resource.suffix}`;
  }
  return { quota: { hard, used } };
}

async function billingFetchStub(input: unknown): Promise<Response> {
  const url = requestUrl(input);
  if (url === "/api/billing/regions") {
    return jsonResponse({
      current: { domain: "billing.test", uid: "region-1" },
    });
  }
  if (url === "/api/billing/subscription") {
    await billing.hold;
    if (billing.subscription == null) {
      return new Response("{}", { status: 500 });
    }
    return jsonResponse({ subscription: billing.subscription });
  }
  if (url === "/api/billing/workspace-quota") {
    workspaceQuota.requests += 1;
    if (workspaceQuota.requests === 1) {
      await workspaceQuota.hold;
      if (workspaceQuota.items == null) {
        return new Response("{}", { status: 500 });
      }
      return jsonResponse(workspaceQuotaPayload(workspaceQuota.items));
    }
    await aiUsage.hold;
    if (aiUsage.credits == null) {
      return new Response("{}", { status: 500 });
    }
    return jsonResponse({ quota: aiUsage.credits });
  }
  if (url.startsWith("/api/chat/free-turns")) {
    if (aiUsage.freeTurns == null) {
      return new Response("{}", { status: 500 });
    }
    return jsonResponse(aiUsage.freeTurns);
  }
  return new Response("{}", { status: 404 });
}

// Each scenario gets its own workspace so SWR's cache never replays another
// test's subscription summary.
function hydrateAccountAtoms(workspace: string) {
  const store = getDefaultStore();
  store.set(appTokenAtom, "desktop-app-token");
  store.set(kubeconfigAtom, "apiVersion: v1");
  store.set(namespaceAtom, workspace);
  store.set(desktopUserIdAtom, ACCOUNT_USER.id);
  store.set(desktopUserNameAtom, ACCOUNT_USER.name);
  store.set(desktopUserAvatarAtom, "");
}

mock.module("next/navigation", () => ({
  usePathname: () => route.pathname,
}));

mock.module("next/link", () => ({
  default({
    children,
    href,
    ...props
  }: {
    children?: ReactNode;
    href: string;
  } & Record<string, unknown>) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

mock.module("@/features/projects/explorer/use-projects-explorer", () => ({
  useProjectsExplorerReadModel: () => ({
    data: { aps: undefined, dbs: undefined },
    refreshProjects: async () => undefined,
    states: explorer.states,
  }),
}));

mock.module("@labring/sealos-desktop-sdk/app", () => ({
  sealosApp: {
    getHostConfig: async () => ({ cloud: { domain: "https://desktop.test" } }),
    runEvents: async () => undefined,
  },
}));

// Base UI resolves its isomorphic layout effect at module load — with no DOM
// registered it becomes a permanent noop and popovers can never open. Load
// the component modules under a throwaway DOM so those bindings are real.
const moduleDom = installTestDom();
const { render } = await import("@testing-library/react/pure");
const { JotaiProvider } = await import("@/features/shell/jotai-provider");
const { default: AppSidebar, AppSidebarShell } = await import("./app-sidebar");
await moduleDom.restore();

async function withSidebar(
  run: () => void | Promise<void>,
  // "unset" omits the prop so the scenario exercises the shell's own default.
  defaultOpen: boolean | "unset" = true,
  beforeRender?: () => void
): Promise<void> {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const fetchOverride = defineGlobal("fetch", billingFetchStub);
  let rendered: ReturnType<typeof render> | undefined;
  try {
    beforeRender?.();
    await actAndDrain(() => {
      rendered = render(
        <JotaiProvider>
          <AppSidebarShell
            {...(defaultOpen === "unset" ? {} : { defaultOpen })}
          >
            <AppSidebar />
          </AppSidebarShell>
        </JotaiProvider>
      );
    });
    await run();
  } finally {
    // Unmount in the cleanup path — a failing scenario must not leave the
    // tree mounted against a torn-down DOM, poisoning every later test.
    await actAndDrain(() => {
      rendered?.unmount();
    }).catch(() => undefined);
    explorer.states = { pinnedProjectIds: ["alpha"], projects };
    billing.hold = null;
    billing.subscription = null;
    workspaceQuota.hold = null;
    workspaceQuota.items = [];
    workspaceQuota.requests = 0;
    aiUsage.credits = null;
    aiUsage.freeTurns = null;
    aiUsage.hold = null;
    restoreGlobal(fetchOverride);
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
}

function sidebarHeadings(nav: Element | null): string[] {
  return [...(nav?.querySelectorAll(".app-sidebar-heading") ?? [])].map(
    (heading) => heading.textContent?.trim() ?? ""
  );
}

function sidebarState(): string | null {
  return (
    document
      .querySelector("[data-slot='sidebar']")
      ?.getAttribute("data-state") ?? null
  );
}

function cookieValue(name: string): string | undefined {
  const prefix = `${name}=`;
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

test("the shell renders Collapsed when no remembered state is provided", async () => {
  await withSidebar(() => {
    assert.equal(sidebarState(), "collapsed");
  }, "unset");
});

test("a remembered Expanded state renders Expanded and collapses from the header button", async () => {
  await withSidebar(async () => {
    assert.equal(sidebarState(), "expanded");
    const collapse = document.querySelector<HTMLButtonElement>(
      '[aria-label="Collapse sidebar"]'
    );
    assert.ok(collapse);
    assert.equal(collapse.getAttribute("aria-expanded"), "true");
    assert.equal(collapse.getAttribute("aria-controls"), "app-sidebar-nav");

    await actAndDrain(() => {
      // Activating the header button focuses it first (mouse or keyboard);
      // the focus transfer only fires when focus sat inside the sidebar.
      collapse.focus();
      collapse.click();
    });

    assert.equal(sidebarState(), "collapsed");
    assert.equal(cookieValue(SIDEBAR_COOKIE_NAME), "false");
    const expand = document.querySelector<HTMLButtonElement>(
      '[aria-label="Expand sidebar"]'
    );
    assert.ok(expand);
    assert.equal(expand.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, expand);
  });
});

test("collapsed logo slot expands the sidebar and moves focus to collapse", async () => {
  await withSidebar(async () => {
    assert.equal(sidebarState(), "collapsed");
    const expand = document.querySelector<HTMLButtonElement>(
      '[aria-label="Expand sidebar"]'
    );
    assert.ok(expand);
    await actAndDrain(() => {
      expand.focus();
      expand.click();
    });
    assert.equal(sidebarState(), "expanded");
    assert.equal(cookieValue(SIDEBAR_COOKIE_NAME), "true");
    assert.equal(
      document.activeElement,
      document.querySelector('[aria-label="Collapse sidebar"]')
    );
  }, false);
});

test("Cmd+B toggles the sidebar except inside an editable target", async () => {
  await withSidebar(async () => {
    await actAndDrain(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "b",
          metaKey: true,
          bubbles: true,
        })
      );
    });
    assert.equal(sidebarState(), "collapsed");

    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    await actAndDrain(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "b",
          metaKey: true,
          bubbles: true,
        })
      );
    });
    assert.equal(sidebarState(), "collapsed");
    input.remove();
  });
});

test("Cmd+B from outside the sidebar leaves focus where it is", async () => {
  await withSidebar(async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    await actAndDrain(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "b",
          metaKey: true,
          bubbles: true,
        })
      );
    });
    assert.equal(sidebarState(), "collapsed");
    // The toggle happened, but focus was in the main view — the rail's
    // expand control must not steal it.
    assert.equal(document.activeElement, outside);
    outside.remove();
  });
});

test("a collapsed Projects group reopens on the icon rail and restores on expand", async () => {
  await withSidebar(async () => {
    const heading = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".app-sidebar-heading button"
      ),
    ].find((button) => button.textContent?.includes("Projects"));
    assert.ok(heading);
    const grid = heading.closest(".app-sidebar-heading")?.nextElementSibling;
    assert.ok(grid);

    await actAndDrain(() => {
      heading.click();
    });
    assert.equal(heading.getAttribute("aria-expanded"), "false");
    assert.ok(grid.className.includes("grid-rows-[0fr]"));

    // Collapse the sidebar: the rail heading is inert, so the group must
    // render open or its project icons would be unrecoverable.
    const collapse = document.querySelector<HTMLButtonElement>(
      '[aria-label="Collapse sidebar"]'
    );
    assert.ok(collapse);
    await actAndDrain(() => {
      collapse.click();
    });
    assert.equal(sidebarState(), "collapsed");
    assert.equal(heading.getAttribute("aria-expanded"), "true");
    assert.ok(grid.className.includes("grid-rows-[1fr]"));
    assert.ok(document.querySelector('a[href="/project/beta"]'));

    // Expanding brings the session collapse flag back.
    const expand = document.querySelector<HTMLButtonElement>(
      '[aria-label="Expand sidebar"]'
    );
    assert.ok(expand);
    await actAndDrain(() => {
      expand.click();
    });
    assert.equal(heading.getAttribute("aria-expanded"), "false");
    assert.ok(grid.className.includes("grid-rows-[0fr]"));
  });
});

test("pinned projects stay above the remaining projects", async () => {
  await withSidebar(() => {
    const nav = document.querySelector("#app-sidebar-nav");
    assert.ok(nav);
    assert.equal(nav.getAttribute("aria-label"), "Projects");
    assert.ok(document.querySelector('[data-slot="app-sidebar-pinned"]'));
    assert.deepEqual(sidebarHeadings(nav), ["Pinned", "Projects"]);
    const pinnedLink = document.querySelector(
      '[aria-label="Pinned project: Alpha"]'
    );
    assert.ok(pinnedLink);
    const projectLinks = [...nav.querySelectorAll("a")].filter((link) =>
      link.getAttribute("href")?.startsWith("/project/")
    );
    assert.deepEqual(
      projectLinks.map((link) => link.getAttribute("href")),
      ["/project/alpha", "/project/beta", "/project/gamma"]
    );
  });
});

test("an empty Pinned group is omitted", async () => {
  explorer.states = { pinnedProjectIds: [], projects };
  await withSidebar(() => {
    assert.equal(
      document.querySelector('[data-slot="app-sidebar-pinned"]'),
      null
    );
    assert.deepEqual(
      sidebarHeadings(document.querySelector("#app-sidebar-nav")),
      ["Projects"]
    );
  });
});

test("the active project uses aria-current and locked copy is present", async () => {
  await withSidebar(() => {
    const projectsLink = document.querySelector('a[href="/project"]');
    assert.ok(projectsLink);
    assert.equal(projectsLink.textContent?.includes("Projects"), true);
    assert.equal(projectsLink.getAttribute("aria-current"), null);

    const active = document.querySelector('a[href="/project/alpha"]');
    assert.ok(active);
    assert.equal(active.getAttribute("aria-current"), "page");

    // Billing and the Sealos Desktop Entry live inside the account popover,
    // not the sidebar footer (see the popover test below).
    assert.equal(document.querySelector('a[href="/billing"]'), null);
    assert.equal(document.querySelector('[aria-label="Sealos Desktop"]'), null);
    // AIM-308: the account section replaced the Upgrade button as the
    // sidebar's single quota surface.
    assert.equal(document.querySelector('[aria-label="Upgrade"]'), null);
    assert.ok(document.querySelector('[data-slot="app-sidebar-account"]'));
    assert.equal(document.querySelector('[aria-label="Brain v2"]'), null);
  });
});

test("tooltips belong to Collapsed; Expanded uses a title fallback", async () => {
  await withSidebar(async () => {
    // The row keeps one DOM tree across expand/collapse: it is always a
    // mounted tooltip trigger, disabled while expanded. `title` is the
    // expanded-state fallback and drops away once the tooltip takes over.
    const expandedRow = document.querySelector('a[href="/project/beta"]');
    assert.ok(expandedRow);
    assert.equal(expandedRow.getAttribute("title"), "Beta");

    const collapse = document.querySelector<HTMLButtonElement>(
      '[aria-label="Collapse sidebar"]'
    );
    assert.ok(collapse);
    await actAndDrain(() => {
      collapse.click();
    });

    const collapsedRow = document.querySelector('a[href="/project/beta"]');
    assert.ok(collapsedRow);
    assert.equal(collapsedRow.getAttribute("title"), null);
    assert.equal(collapsedRow.getAttribute("data-slot"), "tooltip-trigger");
  });
});

test("the account row shows the session identity with the plan badge", async () => {
  billing.subscription = proSubscription();
  await withSidebar(
    () => {
      const row = document.querySelector<HTMLButtonElement>(
        '[data-slot="app-sidebar-account"]'
      );
      assert.ok(row);
      assert.equal(row.getAttribute("aria-label"), "Account: Ada Lovelace");
      assert.match(row.textContent ?? "", ACCOUNT_NAME_RE);
      assert.equal(
        row
          .querySelector('[data-slot="app-sidebar-account-status"]')
          ?.textContent?.trim(),
        `ID: ${ACCOUNT_USER.id}`
      );
      assert.equal(
        row.querySelector('[data-slot="plan-badge"]')?.textContent?.trim(),
        "PRO"
      );
    },
    true,
    () => hydrateAccountAtoms("ws-account-row")
  );
});

test("an attention lifecycle replaces the ID line with a status hint", async () => {
  billing.subscription = proSubscription({ Status: "debt" });
  await withSidebar(
    () => {
      const status = document.querySelector(
        '[data-slot="app-sidebar-account-status"]'
      );
      assert.equal(
        status?.textContent?.trim(),
        "Payment due · service limited"
      );
    },
    true,
    () => hydrateAccountAtoms("ws-account-debt")
  );
});

test("a failed subscription read degrades to the quiet ID line without a badge", async () => {
  billing.subscription = null;
  await withSidebar(
    () => {
      const row = document.querySelector('[data-slot="app-sidebar-account"]');
      assert.ok(row);
      assert.equal(row.querySelector('[data-slot="plan-badge"]'), null);
      assert.equal(
        row
          .querySelector('[data-slot="app-sidebar-account-status"]')
          ?.textContent?.trim(),
        `ID: ${ACCOUNT_USER.id}`
      );
    },
    true,
    () => hydrateAccountAtoms("ws-account-degraded")
  );
});

test("clicking the account row opens the popover with quota, copy, and upgrade", async () => {
  billing.subscription = proSubscription();
  workspaceQuota.items = [
    { limit: 4000, type: "cpu", used: 1900 },
    { limit: 8192, type: "memory", used: 6963 },
    { limit: 51_200, type: "storage", used: 12_288 },
    { limit: 32, type: "pod", used: 14 },
    { limit: 8, type: "nodeport", used: 3 },
  ];
  const copies: string[] = [];
  await withSidebar(
    async () => {
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (text: string) => {
            copies.push(text);
            return Promise.resolve();
          },
        },
      });

      const row = document.querySelector<HTMLButtonElement>(
        '[data-slot="app-sidebar-account"]'
      );
      assert.ok(row);
      await actAndDrain(() => {
        row.click();
      });

      const popover = document.querySelector('[data-slot="popover-content"]');
      assert.ok(popover);
      const quotaRows = [
        ...popover.querySelectorAll('[data-slot="app-sidebar-quota-row"]'),
      ];
      assert.equal(quotaRows.length, 5);
      assert.deepEqual(
        quotaRows.map((quotaRow) => quotaRow.getAttribute("data-warning")),
        // Memory sits at 85% — the one row at or above the warning threshold.
        [null, "true", null, null, null]
      );
      assert.ok(popover.querySelector('a[href="/billing?mode=upgrade"]'));

      // The popover carries the menu rows: the Usage entry (collapsed by
      // default, quota rows folded into its expansion), Billing, and the
      // Sealos Desktop Entry.
      const billingRow = popover.querySelector('a[href="/billing"]');
      assert.ok(billingRow);
      assert.equal(billingRow.textContent?.includes("Billing"), true);
      const desktopRow = [...popover.querySelectorAll("a")].find((link) =>
        link.textContent?.includes("Sealos Desktop")
      );
      assert.ok(desktopRow);
      const usageToggle = popover.querySelector<HTMLButtonElement>(
        "button[aria-expanded]"
      );
      assert.ok(usageToggle);
      assert.equal(usageToggle.textContent?.includes("Usage"), true);
      assert.equal(usageToggle.getAttribute("aria-expanded"), "false");
      await actAndDrain(() => {
        usageToggle.click();
      });
      assert.equal(usageToggle.getAttribute("aria-expanded"), "true");

      const copy = popover.querySelector<HTMLButtonElement>(
        '[aria-label="Copy user ID"]'
      );
      assert.ok(copy);
      assert.match(copy.textContent ?? "", ACCOUNT_ID_RE);
      await actAndDrain(() => {
        copy.click();
      });
      assert.deepEqual(copies, [ACCOUNT_USER.id]);
    },
    true,
    () => hydrateAccountAtoms("ws-account-popover")
  );
});

test("the popover leads the quota list with the AI Credits row on a paid plan", async () => {
  billing.subscription = proSubscription();
  aiUsage.credits = {
    hard: { ai_quota: 3_000_000 },
    used: { ai_quota: 2_400_000 },
  };
  workspaceQuota.items = [{ limit: 4000, type: "cpu", used: 1000 }];
  await withSidebar(
    async () => {
      const row = document.querySelector<HTMLButtonElement>(
        '[data-slot="app-sidebar-account"]'
      );
      assert.ok(row);
      await actAndDrain(() => {
        row.click();
      });

      const popover = document.querySelector('[data-slot="popover-content"]');
      assert.ok(popover);
      const aiRow = popover.querySelector(
        '[data-slot="app-sidebar-ai-usage-row"]'
      );
      assert.ok(aiRow);
      assert.match(aiRow.textContent ?? "", AI_CREDITS_LABEL_RE);
      assert.match(aiRow.textContent ?? "", AI_CREDITS_VALUE_RE);
      // 80% used — the warning tier, not danger.
      assert.equal(aiRow.getAttribute("data-warning"), "true");
      assert.equal(aiRow.getAttribute("data-danger"), null);
      // The AI row sits above the workspace quota bars.
      assert.equal(aiRow.parentElement?.firstElementChild, aiRow);
      assert.equal(
        aiRow.parentElement?.querySelectorAll(
          '[data-slot="app-sidebar-quota-row"]'
        ).length,
        5
      );
    },
    true,
    () => hydrateAccountAtoms("ws-account-ai-credits")
  );
});

test("a failed AI usage refresh keeps the last snapshot; not-applicable clears it", async () => {
  billing.subscription = proSubscription();
  aiUsage.credits = {
    hard: { ai_quota: 3_000_000 },
    used: { ai_quota: 2_400_000 },
  };
  await withSidebar(
    async () => {
      const row = document.querySelector<HTMLButtonElement>(
        '[data-slot="app-sidebar-account"]'
      );
      assert.ok(row);
      const aiRow = () =>
        document.querySelector('[data-slot="app-sidebar-ai-usage-row"]');
      const toggle = () =>
        actAndDrain(() => {
          row.click();
        });

      await toggle();
      assert.match(aiRow()?.textContent ?? "", AI_CREDITS_VALUE_RE);
      await toggle();

      // The credits route fails on the next open — the row keeps the stale
      // snapshot instead of vanishing.
      aiUsage.credits = null;
      await toggle();
      assert.match(aiRow()?.textContent ?? "", AI_CREDITS_VALUE_RE);
      await toggle();

      // A fulfilled "no allowance" answer is not a failure: it clears the row.
      aiUsage.credits = { hard: { ai_quota: 0 }, used: { ai_quota: 0 } };
      await toggle();
      assert.equal(aiRow(), null);
    },
    true,
    () => hydrateAccountAtoms("ws-account-ai-stale")
  );
});

test("the trial popover shows Free trial messages and turns danger at exhaustion", async () => {
  billing.subscription = proSubscription({ PlanName: "free" });
  aiUsage.freeTurns = { limit: 5, remaining: 0, used: 5 };
  await withSidebar(
    async () => {
      const row = document.querySelector<HTMLButtonElement>(
        '[data-slot="app-sidebar-account"]'
      );
      assert.ok(row);
      await actAndDrain(() => {
        row.click();
      });

      const popover = document.querySelector('[data-slot="popover-content"]');
      assert.ok(popover);
      const aiRow = popover.querySelector(
        '[data-slot="app-sidebar-ai-usage-row"]'
      );
      assert.ok(aiRow);
      assert.match(aiRow.textContent ?? "", FREE_TURNS_LABEL_RE);
      assert.match(aiRow.textContent ?? "", FREE_TURNS_VALUE_RE);
      assert.equal(aiRow.getAttribute("data-danger"), "true");
      assert.equal(aiRow.getAttribute("data-warning"), null);
    },
    true,
    () => hydrateAccountAtoms("ws-account-free-turns")
  );
});

test("the first open holds quota skeletons while the AI slot fills alone", async () => {
  billing.subscription = proSubscription();
  aiUsage.credits = {
    hard: { ai_quota: 3_000_000 },
    used: { ai_quota: 2_400_000 },
  };
  const gate = deferred();
  workspaceQuota.hold = gate.promise;
  workspaceQuota.items = [
    { limit: 4000, type: "cpu", used: 1900 },
    { limit: 8192, type: "memory", used: 4096 },
    { limit: 51_200, type: "storage", used: 12_288 },
    { limit: 32, type: "pod", used: 14 },
    { limit: 8, type: "nodeport", used: 3 },
  ];
  await withSidebar(
    async () => {
      const row = document.querySelector<HTMLButtonElement>(
        '[data-slot="app-sidebar-account"]'
      );
      assert.ok(row);
      await actAndDrain(() => {
        row.click();
      });

      const popover = document.querySelector('[data-slot="popover-content"]');
      assert.ok(popover);
      // The quota snapshot is still in flight: real labels, shimmer values.
      const skeletons = [
        ...popover.querySelectorAll('[data-slot="app-sidebar-quota-skeleton"]'),
      ];
      assert.deepEqual(
        skeletons.map((skeleton) => skeleton.textContent?.trim()),
        ["CPU", "Mem", "Storage", "Pods", "Ports"]
      );
      assert.equal(
        popover.querySelectorAll('[data-slot="app-sidebar-quota-row"]').length,
        0
      );
      // The AI slot committed independently — it never waits for the quota.
      const aiRow = popover.querySelector(
        '[data-slot="app-sidebar-ai-usage-row"]'
      );
      assert.match(aiRow?.textContent ?? "", AI_CREDITS_VALUE_RE);

      await actAndDrain(() => {
        gate.release();
      });
      assert.equal(
        popover.querySelectorAll('[data-slot="app-sidebar-quota-skeleton"]')
          .length,
        0
      );
      assert.equal(
        popover.querySelectorAll('[data-slot="app-sidebar-quota-row"]').length,
        5
      );
    },
    true,
    () => hydrateAccountAtoms("ws-account-quota-skeleton")
  );
});

test("a slow AI side keeps its own skeleton without holding the quota bars", async () => {
  billing.subscription = proSubscription();
  const gate = deferred();
  aiUsage.hold = gate.promise;
  aiUsage.credits = {
    hard: { ai_quota: 3_000_000 },
    used: { ai_quota: 2_400_000 },
  };
  workspaceQuota.items = [{ limit: 4000, type: "cpu", used: 1000 }];
  await withSidebar(
    async () => {
      const row = document.querySelector<HTMLButtonElement>(
        '[data-slot="app-sidebar-account"]'
      );
      assert.ok(row);
      await actAndDrain(() => {
        row.click();
      });

      const popover = document.querySelector('[data-slot="popover-content"]');
      assert.ok(popover);
      // All five quota rows landed without waiting for the AI side.
      assert.equal(
        popover.querySelectorAll('[data-slot="app-sidebar-quota-row"]').length,
        5
      );
      // The subscription is known, so the pending AI slot shows its real label.
      const aiSkeleton = popover.querySelector(
        '[data-slot="app-sidebar-ai-usage-skeleton"]'
      );
      assert.match(aiSkeleton?.textContent ?? "", AI_CREDITS_LABEL_RE);

      await actAndDrain(() => {
        gate.release();
      });
      assert.equal(
        popover.querySelector('[data-slot="app-sidebar-ai-usage-skeleton"]'),
        null
      );
      assert.match(
        popover.querySelector('[data-slot="app-sidebar-ai-usage-row"]')
          ?.textContent ?? "",
        AI_CREDITS_VALUE_RE
      );
    },
    true,
    () => hydrateAccountAtoms("ws-account-ai-skeleton")
  );
});

test("opening before the subscription answer keeps the AI slot pending, not absent", async () => {
  const gate = deferred();
  billing.hold = gate.promise;
  billing.subscription = proSubscription();
  aiUsage.credits = {
    hard: { ai_quota: 3_000_000 },
    used: { ai_quota: 2_400_000 },
  };
  workspaceQuota.items = [{ limit: 4000, type: "cpu", used: 1000 }];
  await withSidebar(
    async () => {
      const row = document.querySelector<HTMLButtonElement>(
        '[data-slot="app-sidebar-account"]'
      );
      assert.ok(row);
      await actAndDrain(() => {
        row.click();
      });

      const popover = document.querySelector('[data-slot="popover-content"]');
      assert.ok(popover);
      // Unknown subscription: the slot is held by a label-less skeleton.
      const aiSkeleton = popover.querySelector(
        '[data-slot="app-sidebar-ai-usage-skeleton"]'
      );
      assert.ok(aiSkeleton);
      assert.equal(aiSkeleton.textContent?.trim(), "");

      // The answer lands mid-open: the row appears in the same session
      // instead of being committed away as "not applicable".
      await actAndDrain(() => {
        gate.release();
      });
      assert.match(
        popover.querySelector('[data-slot="app-sidebar-ai-usage-row"]')
          ?.textContent ?? "",
        AI_CREDITS_VALUE_RE
      );
    },
    true,
    () => hydrateAccountAtoms("ws-account-sub-pending")
  );
});

test("a failed first load collapses the usage section instead of pinning skeletons", async () => {
  billing.subscription = proSubscription();
  aiUsage.credits = null;
  workspaceQuota.items = null;
  await withSidebar(
    async () => {
      const row = document.querySelector<HTMLButtonElement>(
        '[data-slot="app-sidebar-account"]'
      );
      assert.ok(row);
      await actAndDrain(() => {
        row.click();
      });

      const popover = document.querySelector('[data-slot="popover-content"]');
      assert.ok(popover);
      for (const slot of [
        "app-sidebar-quota-skeleton",
        "app-sidebar-quota-row",
        "app-sidebar-ai-usage-skeleton",
        "app-sidebar-ai-usage-row",
      ]) {
        assert.equal(popover.querySelector(`[data-slot="${slot}"]`), null);
      }
      assert.ok(popover.querySelector('a[href="/billing?mode=upgrade"]'));
    },
    true,
    () => hydrateAccountAtoms("ws-account-usage-failed")
  );
});

test("the collapsed rail keeps the account section as an avatar button", async () => {
  billing.subscription = proSubscription();
  await withSidebar(
    async () => {
      assert.equal(sidebarState(), "collapsed");
      const row = document.querySelector<HTMLButtonElement>(
        '[data-slot="app-sidebar-account"]'
      );
      assert.ok(row);
      assert.equal(row.getAttribute("aria-label"), "Account: Ada Lovelace");

      await actAndDrain(() => {
        row.click();
      });
      const popover = document.querySelector('[data-slot="popover-content"]');
      assert.ok(popover);
      assert.match(popover.textContent ?? "", ACCOUNT_NAME_RE);
    },
    false,
    () => hydrateAccountAtoms("ws-account-rail")
  );
});
