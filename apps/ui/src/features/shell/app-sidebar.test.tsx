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
import type { SessionWorkspace } from "@/features/session/session-schema";
import {
  appTokenAtom,
  currentWorkspaceAtom,
  desktopDomainAtom,
  kubeconfigAtom,
  namespaceAtom,
  regionalTokenAtom,
  sessionUserAtom,
  workspacesAtom,
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
  if (url === "/api/workspace/list") {
    return jsonResponse(workspaceRoutes.list);
  }
  if (url.startsWith("/api/billing/workspace-plans?")) {
    if (workspaceRoutes.plans == null) {
      return new Response("{}", { status: 500 });
    }
    return jsonResponse({ plans: workspaceRoutes.plans });
  }
  return new Response("{}", { status: 404 });
}

// The Brain Session's Workspace list: Personal first, as Desktop orders it.
const PERSONAL_WORKSPACE: SessionWorkspace = {
  createdAt: "2026-01-05T09:00:00.000Z",
  id: "ns-personal",
  isPersonal: true,
  name: "private team",
  role: "Owner",
  uid: "uid-personal",
};
const ACME_WORKSPACE: SessionWorkspace = {
  createdAt: "2026-02-14T09:00:00.000Z",
  id: "ns-acme",
  isPersonal: false,
  name: "Acme",
  role: "Manager",
  uid: "uid-acme",
};
const SANDBOX_WORKSPACE: SessionWorkspace = {
  createdAt: "2026-03-01T09:00:00.000Z",
  id: "ns-sandbox",
  isPersonal: false,
  name: "Sandbox",
  role: "Developer",
  uid: "uid-sandbox",
};
const SESSION_WORKSPACES = [
  PERSONAL_WORKSPACE,
  ACME_WORKSPACE,
  SANDBOX_WORKSPACE,
];
// What `GET /api/workspace/list` and `GET /api/billing/workspace-plans`
// answer; null plans = the route fails.
const workspaceRoutes = {
  list: SESSION_WORKSPACES as SessionWorkspace[],
  plans: {
    "ns-acme": "Pro",
    "ns-personal": "Hobby",
    "ns-sandbox": null,
  } as Record<string, string | null> | null,
};
// The Desktop iframe facts the Switcher reads (spec §C.6), stood in for.
const switchEnvironment = { inIframe: true, navigations: [] as string[] };
const ACME_SWITCH_LABEL = '[aria-label="Switch to Acme"]';
const ACME_NAME_RE = /Acme/;
const MANAGER_ROLE_RE = /Manager/;
const PERSONAL_ROLE_RE = /Personal/;
const DEVELOPER_ROLE_RE = /Developer/;

// Each scenario gets its own workspace so SWR's cache never replays another
// test's subscription summary. The session lands in the Acme Workspace.
function hydrateAccountAtoms(workspace: string) {
  const store = getDefaultStore();
  store.set(appTokenAtom, "desktop-app-token");
  store.set(kubeconfigAtom, "apiVersion: v1");
  store.set(namespaceAtom, workspace);
  store.set(regionalTokenAtom, `regional-${workspace}`);
  store.set(currentWorkspaceAtom, { ...ACME_WORKSPACE, id: workspace });
  store.set(workspacesAtom, SESSION_WORKSPACES);
  store.set(desktopDomainAtom, "cloud.test");
  store.set(sessionUserAtom, {
    avatar: "",
    crName: "ada",
    name: ACCOUNT_USER.name,
    userId: ACCOUNT_USER.id,
    userUid: "user-uid-ada",
  });
}

async function openWorkspaceSwitcher(): Promise<Element> {
  const row = document.querySelector<HTMLButtonElement>(
    '[data-slot="app-sidebar-workspace"]'
  );
  assert.ok(row);
  await actAndDrain(() => {
    row.click();
  });
  const card = document.querySelector(
    '[data-slot="app-sidebar-workspace-card"]'
  );
  assert.ok(card);
  const popover = card.closest('[data-slot="popover-content"]');
  assert.ok(popover);
  return popover;
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

mock.module("@/features/workspace/workspace-switch-environment", () => ({
  isSwitchAvailable: () => switchEnvironment.inIframe,
  navigateTopWindow: (url: string) => {
    switchEnvironment.navigations.push(url);
  },
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
    workspaceRoutes.list = SESSION_WORKSPACES;
    workspaceRoutes.plans = {
      "ns-acme": "Pro",
      "ns-personal": "Hobby",
      "ns-sandbox": null,
    };
    switchEnvironment.inIframe = true;
    switchEnvironment.navigations = [];
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

test("a remembered Expanded state renders Expanded and the brand slot collapses it in place", async () => {
  await withSidebar(async () => {
    assert.equal(sidebarState(), "expanded");
    // The brand slot is the only collapse / expand control: no wordmark,
    // no separate collapse button.
    const brand = document.querySelector<HTMLButtonElement>(
      '[aria-label="Collapse sidebar"]'
    );
    assert.ok(brand);
    assert.equal(brand.getAttribute("aria-expanded"), "true");
    assert.equal(brand.getAttribute("aria-controls"), "app-sidebar-nav");
    assert.equal(brand.getAttribute("data-slot"), "app-sidebar-collapse");
    assert.equal(
      document.querySelectorAll('[aria-label$="sidebar"]').length,
      1
    );
    assert.equal(
      document
        .querySelector('[data-slot="sidebar-header"]')
        ?.textContent?.includes("Sealos"),
      false
    );

    await actAndDrain(() => {
      // Activating the brand slot focuses it first (mouse or keyboard);
      // the focus transfer only fires when focus sat inside the sidebar.
      brand.focus();
      brand.click();
    });

    assert.equal(sidebarState(), "collapsed");
    assert.equal(cookieValue(SIDEBAR_COOKIE_NAME), "false");
    // Same element, flipped: label, expanded state, data-slot — and focus
    // never left it.
    assert.equal(brand.getAttribute("aria-label"), "Expand sidebar");
    assert.equal(brand.getAttribute("aria-expanded"), "false");
    assert.equal(brand.getAttribute("data-slot"), "app-sidebar-expand");
    assert.equal(document.activeElement, brand);
  });
});

test("the collapsed brand slot expands the sidebar in place and keeps focus", async () => {
  await withSidebar(async () => {
    assert.equal(sidebarState(), "collapsed");
    const brand = document.querySelector<HTMLButtonElement>(
      '[aria-label="Expand sidebar"]'
    );
    assert.ok(brand);
    assert.equal(brand.getAttribute("data-slot"), "app-sidebar-expand");
    await actAndDrain(() => {
      brand.focus();
      brand.click();
    });
    assert.equal(sidebarState(), "expanded");
    assert.equal(cookieValue(SIDEBAR_COOKIE_NAME), "true");
    assert.equal(brand.getAttribute("aria-label"), "Collapse sidebar");
    assert.equal(brand.getAttribute("data-slot"), "app-sidebar-collapse");
    assert.equal(document.activeElement, brand);
  }, false);
});

test("the brand swap keeps only the opacity crossfade under reduced motion", async () => {
  const motionClasses = () =>
    [
      ...(document
        .querySelector('[data-slot="app-sidebar-brand"]')
        ?.querySelectorAll("*") ?? []),
    ].flatMap((el) => [...el.classList]);
  await withSidebar(() => {
    const classes = motionClasses();
    assert.ok(classes.some((cls) => cls.includes("scale-80")));
    assert.ok(classes.some((cls) => cls.includes("blur-[2px]")));
    assert.ok(classes.includes("ease-out-strong"));
  });
  await withSidebar(
    () => {
      const classes = motionClasses();
      assert.equal(
        classes.some((cls) => cls.includes("scale-")),
        false
      );
      assert.equal(
        classes.some((cls) => cls.includes("blur-")),
        false
      );
      assert.ok(classes.includes("transition-opacity"));
    },
    true,
    () => {
      window.matchMedia = ((query: string) => ({
        addEventListener: () => undefined,
        matches: query.includes("prefers-reduced-motion"),
        removeEventListener: () => undefined,
      })) as unknown as typeof window.matchMedia;
    }
  );
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

    // Expanding brings the session collapse flag back. Both queries hit the
    // same brand-slot element; its label flipped with the state.
    const expand = document.querySelector<HTMLButtonElement>(
      '[aria-label="Expand sidebar"]'
    );
    assert.ok(expand);
    assert.equal(expand, collapse);
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
    // The Expanded brand slot has neither a tooltip nor a title: its glyph
    // only appears on hover, and the tooltip exists only in the rail.
    assert.equal(collapse.getAttribute("title"), null);
    assert.equal(collapse.getAttribute("data-slot"), "app-sidebar-collapse");
    await actAndDrain(() => {
      collapse.click();
    });

    const collapsedRow = document.querySelector('a[href="/project/beta"]');
    assert.ok(collapsedRow);
    assert.equal(collapsedRow.getAttribute("title"), null);
    assert.equal(collapsedRow.getAttribute("data-slot"), "tooltip-trigger");
  });
});

test("the account row shows the session identity; the plan badge sits on the Workspace Switcher row", async () => {
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
      // The plan is a Workspace fact: never on the account row.
      assert.equal(row.querySelector('[data-slot="plan-badge"]'), null);
      assert.equal(row.textContent?.includes("PAYG"), false);

      const switcher = document.querySelector<HTMLButtonElement>(
        '[data-slot="app-sidebar-workspace"]'
      );
      assert.ok(switcher);
      assert.equal(
        switcher.getAttribute("aria-label"),
        "Workspace: Acme. Switch workspace"
      );
      assert.equal(
        switcher
          .querySelector('[data-slot="workspace-avatar"]')
          ?.getAttribute("data-shape"),
        "square"
      );
      assert.equal(
        switcher.querySelector('[data-slot="plan-badge"]')?.textContent?.trim(),
        "PRO"
      );
      // Single line: no status hint in a quiet state.
      assert.equal(
        switcher.querySelector('[data-slot="app-sidebar-workspace-status"]'),
        null
      );
    },
    true,
    () => hydrateAccountAtoms("ws-account-row")
  );
});

test("an attention lifecycle grows the Switcher row a second line; the account ID line stays", async () => {
  billing.subscription = proSubscription({ Status: "debt" });
  await withSidebar(
    () => {
      assert.equal(
        document
          .querySelector('[data-slot="app-sidebar-workspace-status"]')
          ?.textContent?.trim(),
        "Payment due · service limited"
      );
      assert.equal(
        document
          .querySelector('[data-slot="app-sidebar-account-status"]')
          ?.textContent?.trim(),
        `ID: ${ACCOUNT_USER.id}`
      );
    },
    true,
    () => hydrateAccountAtoms("ws-account-debt")
  );
});

test("a failed subscription read leaves the Switcher row single-line without a badge", async () => {
  billing.subscription = null;
  await withSidebar(
    () => {
      const switcher = document.querySelector(
        '[data-slot="app-sidebar-workspace"]'
      );
      assert.ok(switcher);
      assert.equal(switcher.querySelector('[data-slot="plan-badge"]'), null);
      assert.equal(switcher.querySelector('[data-slot="plan-payg"]'), null);
      assert.equal(
        switcher.querySelector('[data-slot="app-sidebar-workspace-status"]'),
        null
      );
      assert.equal(
        document
          .querySelector('[data-slot="app-sidebar-account-status"]')
          ?.textContent?.trim(),
        `ID: ${ACCOUNT_USER.id}`
      );
    },
    true,
    () => hydrateAccountAtoms("ws-account-degraded")
  );
});

test("the Switcher popover lists the current card, Switch to, New and Manage — and no pending invitations", async () => {
  billing.subscription = proSubscription();
  await withSidebar(
    async () => {
      const popover = await openWorkspaceSwitcher();
      const card = popover.querySelector(
        '[data-slot="app-sidebar-workspace-card"]'
      );
      assert.ok(card);
      assert.match(card.textContent ?? "", ACME_NAME_RE);
      assert.match(card.textContent ?? "", MANAGER_ROLE_RE);
      assert.equal(
        card.querySelector('[data-slot="plan-badge"]')?.textContent?.trim(),
        "PRO"
      );

      // Every other Workspace, Personal first, with role and plan.
      const rows = [
        ...popover.querySelectorAll<HTMLButtonElement>(
          '[data-slot="app-sidebar-workspace-switch"]'
        ),
      ];
      assert.deepEqual(
        rows.map((row) => row.getAttribute("aria-label")),
        ["Switch to private team", "Switch to Sandbox"]
      );
      assert.match(rows[0]?.textContent ?? "", PERSONAL_ROLE_RE);
      assert.equal(
        rows[0]?.querySelector('[data-slot="plan-badge"]')?.textContent?.trim(),
        "Hobby"
      );
      assert.match(rows[1]?.textContent ?? "", DEVELOPER_ROLE_RE);
      assert.ok(rows[1]?.querySelector('[data-slot="plan-payg"]'));
      assert.equal(
        rows.every((row) => !row.disabled),
        true
      );
      assert.equal(
        popover.querySelector(
          '[data-slot="app-sidebar-workspace-switch-notice"]'
        ),
        null
      );

      assert.ok(popover.querySelector('a[href="/billing?mode=create"]'));
      assert.ok(popover.querySelector('a[href="/workspace/uid-acme"]'));
      assert.equal(popover.textContent?.includes("Pending"), false);
      assert.equal(popover.textContent?.includes("Usage"), false);
      assert.equal(popover.textContent?.includes("Billing"), false);
      assert.equal(
        popover.querySelector('a[href="/billing?mode=upgrade"]'),
        null
      );
    },
    true,
    () => hydrateAccountAtoms("ws-switcher-popover")
  );
});

test("choosing another Workspace hands the top window to Desktop's deep link, landing by area", async () => {
  billing.subscription = proSubscription();
  await withSidebar(
    async () => {
      window.history.replaceState(null, "", "/billing?mode=upgrade");
      const popover = await openWorkspaceSwitcher();
      const acme = popover.querySelector<HTMLButtonElement>(
        '[aria-label="Switch to Sandbox"]'
      );
      assert.ok(acme);
      await actAndDrain(() => {
        acme.click();
      });
      assert.deepEqual(switchEnvironment.navigations, [
        "https://cloud.test/?openapp=system-brain%3F%2Fbilling%3Fmode%3Dupgrade&workspaceUid=uid-sandbox",
      ]);
      // The popover closed on the way out.
      assert.equal(
        document.querySelector('[data-slot="app-sidebar-workspace-card"]'),
        null
      );

      // From inside a Project the switch lands on the Project list.
      window.history.replaceState(null, "", "/project/alpha?pane=chat");
      const reopened = await openWorkspaceSwitcher();
      const personal = reopened.querySelector<HTMLButtonElement>(
        '[aria-label="Switch to private team"]'
      );
      assert.ok(personal);
      await actAndDrain(() => {
        personal.click();
      });
      assert.equal(
        switchEnvironment.navigations[1],
        "https://cloud.test/?openapp=system-brain%3F%2Fproject%3F&workspaceUid=uid-personal"
      );
    },
    true,
    () => hydrateAccountAtoms("ws-switcher-switch")
  );
});

test("outside the Desktop iframe the Switch to rows are disabled with a notice; New and Manage stay", async () => {
  billing.subscription = proSubscription();
  switchEnvironment.inIframe = false;
  await withSidebar(
    async () => {
      const popover = await openWorkspaceSwitcher();
      const rows = [
        ...popover.querySelectorAll<HTMLButtonElement>(
          '[data-slot="app-sidebar-workspace-switch"]'
        ),
      ];
      assert.equal(rows.length, 2);
      assert.equal(
        rows.every((row) => row.disabled),
        true
      );
      assert.ok(
        popover.querySelector(
          '[data-slot="app-sidebar-workspace-switch-notice"]'
        )
      );
      await actAndDrain(() => {
        rows[0]?.click();
      });
      assert.deepEqual(switchEnvironment.navigations, []);
      assert.ok(popover.querySelector('a[href="/billing?mode=create"]'));
      assert.ok(popover.querySelector('a[href="/workspace/uid-acme"]'));
    },
    true,
    () => hydrateAccountAtoms("ws-switcher-standalone")
  );
});

test("inside Desktop, the rows wait for the host config's domain instead of guessing one", async () => {
  billing.subscription = proSubscription();
  await withSidebar(
    async () => {
      const popover = await openWorkspaceSwitcher();
      const rows = [
        ...popover.querySelectorAll<HTMLButtonElement>(
          '[data-slot="app-sidebar-workspace-switch"]'
        ),
      ];
      assert.equal(
        rows.every((row) => row.disabled),
        true
      );
      assert.equal(
        popover
          .querySelector('[data-slot="app-sidebar-workspace-switch-notice"]')
          ?.textContent?.includes("Waiting for Sealos Desktop"),
        true
      );
    },
    true,
    () => {
      hydrateAccountAtoms("ws-switcher-no-domain");
      getDefaultStore().set(desktopDomainAtom, "");
    }
  );
});

test("a failed plans read leaves the Switch to rows without badges", async () => {
  billing.subscription = proSubscription();
  workspaceRoutes.plans = null;
  await withSidebar(
    async () => {
      const popover = await openWorkspaceSwitcher();
      const rows = [
        ...popover.querySelectorAll(
          '[data-slot="app-sidebar-workspace-switch"]'
        ),
      ];
      assert.equal(rows.length, 2);
      for (const row of rows) {
        assert.equal(row.querySelector('[data-slot="plan-badge"]'), null);
        assert.equal(row.querySelector('[data-slot="plan-payg"]'), null);
      }
    },
    true,
    () => hydrateAccountAtoms("ws-switcher-plans-failed")
  );
});

test("the Switcher follows the refreshed Workspace list from the route", async () => {
  billing.subscription = proSubscription();
  workspaceRoutes.list = [
    PERSONAL_WORKSPACE,
    ACME_WORKSPACE,
    {
      ...SANDBOX_WORKSPACE,
      id: "ns-new",
      name: "Newly joined",
      uid: "uid-new",
    },
  ];
  await withSidebar(
    async () => {
      const popover = await openWorkspaceSwitcher();
      assert.ok(popover.querySelector('[aria-label="Switch to Newly joined"]'));
      assert.equal(
        popover.querySelector('[aria-label="Switch to Sandbox"]'),
        null
      );
    },
    true,
    () => hydrateAccountAtoms("ws-switcher-refresh")
  );
});

test("Cmd+B closes an open Switcher popover", async () => {
  billing.subscription = proSubscription();
  await withSidebar(
    async () => {
      await openWorkspaceSwitcher();
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
      assert.equal(
        document.querySelector('[data-slot="app-sidebar-workspace-card"]'),
        null
      );
    },
    true,
    () => hydrateAccountAtoms("ws-switcher-cmd-b")
  );
});

test("the collapsed rail keeps the Workspace Switcher as an avatar that opens the popover", async () => {
  billing.subscription = proSubscription();
  await withSidebar(
    async () => {
      assert.equal(sidebarState(), "collapsed");
      const switcher = document.querySelector<HTMLButtonElement>(
        '[data-slot="app-sidebar-workspace"]'
      );
      assert.ok(switcher);
      assert.equal(
        switcher.getAttribute("aria-label"),
        "Workspace: Acme. Switch workspace"
      );
      assert.ok(switcher.querySelector('[data-slot="workspace-avatar"]'));
      const popover = await openWorkspaceSwitcher();
      assert.ok(popover.querySelector(ACME_SWITCH_LABEL) == null);
      assert.ok(popover.querySelector('[aria-label="Switch to Sandbox"]'));
    },
    false,
    () => hydrateAccountAtoms("ws-switcher-rail")
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
