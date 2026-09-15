import { afterEach, beforeEach, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { getDefaultStore } from "jotai";
import type { ReactNode } from "react";

import {
  actAndDrain,
  defineGlobal,
  type GlobalOverride,
  installTestDom,
  jsonResponse,
  requestUrl,
  restoreActEnvironment,
  restoreGlobal,
  setActEnvironment,
  type TestDom,
} from "@/features/project-canvas/react-test-harness";
import type { SessionWorkspace } from "@/features/session/session-schema";
import {
  appTokenAtom,
  currentWorkspaceAtom,
  kubeconfigAtom,
  namespaceAtom,
  regionalTokenAtom,
  sessionUserAtom,
  workspacesAtom,
} from "@/lib/auth-store";
import { REGION_TOKEN_HEADER } from "@/lib/region-token-header";

import type { WorkspaceMember } from "./workspace-details-schema";
import {
  INVITE_FIRST_REASON,
  SWITCH_FIRST_REASON,
} from "./workspace-gating-core";

// The area's external facts — the route and Brain's `/api` — are stood in
// for; the assertions are the rendered DOM, the router calls, the toasts,
// and the requests issued.
const route = {
  params: {} as { uid?: string },
  replaced: [] as string[],
};
const toasts: string[] = [];
const copied: string[] = [];

// Next's router is one stable object per app; the stand-in must be too, or
// every effect that lists it re-runs on every render.
const router = {
  replace: (href: string) => {
    route.replaced.push(href);
  },
};
mock.module("next/navigation", () => ({
  useParams: () => route.params,
  usePathname: () => "/workspace",
  useRouter: () => router,
}));
mock.module("next/link", () => ({
  default({
    children,
    href,
    ...props
  }: { children?: ReactNode; href: string } & Record<string, unknown>) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));
mock.module("sonner", () => ({
  toast: (message: string) => {
    toasts.push(message);
  },
}));

const ACME_NAME_RE = /Acme/;
const ACME_ID_RE = /ns-acme/;

const ME = {
  avatar: "",
  crName: "ada",
  name: "Ada Lovelace",
  userId: "usr-ada",
  userUid: "user-uid-ada",
};

const PERSONAL: SessionWorkspace = {
  createdAt: "2026-01-05T09:00:00.000Z",
  id: "ns-personal",
  isPersonal: true,
  name: "private team",
  role: "Owner",
  uid: "uid-personal",
};
const acme = (role: SessionWorkspace["role"]): SessionWorkspace => ({
  createdAt: "2026-02-14T09:00:00.000Z",
  id: "ns-acme",
  isPersonal: false,
  name: "Acme",
  role,
  uid: "uid-acme",
});
const SOLO: SessionWorkspace = {
  createdAt: "2026-09-01T09:00:00.000Z",
  id: "ns-solo",
  isPersonal: false,
  name: "Solo",
  role: "Owner",
  uid: "uid-solo",
};

function member(
  crName: string,
  nickname: string,
  role: WorkspaceMember["role"],
  joinedAt: string,
  alias: string | null = null
): WorkspaceMember {
  return {
    alias,
    avatarUrl: "",
    crName,
    crUid: `cr-${crName}`,
    joinedAt,
    nickname,
    role,
    userUid: `uid-${crName}`,
  };
}

const MEMBERS: Record<string, WorkspaceMember[]> = {
  // Acme as its Owner (scenario "owner"), a Manager, or a Developer.
  "developer:uid-acme": [
    member("kai", "Kai", "Owner", "2026-02-14T09:00:00.000Z"),
    member("ming", "Ming", "Manager", "2026-02-15T09:00:00.000Z", "Docs PM"),
    member("ada", "Ada Lovelace", "Developer", "2026-03-05T09:00:00.000Z"),
  ],
  "manager:uid-acme": [
    member("rui", "Rui", "Owner", "2026-02-14T09:00:00.000Z"),
    member("ada", "Ada Lovelace", "Manager", "2026-02-15T09:00:00.000Z"),
    member("yu", "Yu", "Manager", "2026-02-25T09:00:00.000Z"),
    member("qi", "Qi", "Developer", "2026-07-30T09:00:00.000Z"),
  ],
  "owner:uid-acme": [
    member("ada", "Ada Lovelace", "Owner", "2026-02-14T09:00:00.000Z"),
    member(
      "lin",
      "Lin Wei",
      "Manager",
      "2026-02-20T09:00:00.000Z",
      "Frontend lead"
    ),
    member("chen", "Chen Jie", "Developer", "2026-04-11T09:00:00.000Z"),
  ],
  "owner:uid-solo": [
    member("ada", "Ada Lovelace", "Owner", "2026-09-01T09:00:00.000Z"),
  ],
};
const PERSONAL_MEMBERS = [
  member("ada", "Ada Lovelace", "Owner", "2026-01-05T09:00:00.000Z"),
];

type Scenario = "developer" | "manager" | "owner" | "personal-only";

const WORKSPACES: Record<Scenario, SessionWorkspace[]> = {
  developer: [PERSONAL, acme("Developer")],
  manager: [PERSONAL, acme("Manager")],
  owner: [PERSONAL, acme("Owner"), SOLO],
  "personal-only": [PERSONAL],
};

const fixtures = {
  plans: {
    "ns-acme": "Pro",
    "ns-personal": "Hobby",
    "ns-solo": null,
  } as Record<string, string | null>,
  scenario: "owner" as Scenario,
};
const requests: {
  body: unknown;
  headers: Headers;
  method: string;
  url: string;
}[] = [];

function answer(url: string, body: unknown): Response {
  if (url === "/api/workspace/list") {
    return jsonResponse(WORKSPACES[fixtures.scenario]);
  }
  if (url === "/api/workspace/details") {
    const uid = (body as { uid: string }).uid;
    const workspace = WORKSPACES[fixtures.scenario].find(
      (candidate) => candidate.uid === uid
    );
    if (workspace == null) {
      return new Response(JSON.stringify({ error: "workspace_not_found" }), {
        headers: { "content-type": "application/json" },
        status: 404,
      });
    }
    const members = workspace.isPersonal
      ? PERSONAL_MEMBERS
      : MEMBERS[`${fixtures.scenario}:${uid}`];
    return jsonResponse({ members, workspace });
  }
  if (url.startsWith("/api/billing/workspace-plans?")) {
    return jsonResponse({ plans: fixtures.plans });
  }
  return new Response("{}", { status: 404 });
}

function fetchStub(input: unknown, init?: RequestInit): Promise<Response> {
  const url = requestUrl(input);
  const headers = new Headers(init?.headers);
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  requests.push({ body, headers, method: init?.method ?? "GET", url });
  return Promise.resolve(answer(url, body));
}

// Base UI resolves its isomorphic layout effect at module load — with no
// DOM registered it becomes a permanent noop and menus can never open.
const moduleDom = installTestDom();
const { render } = await import("@testing-library/react/pure");
const { JotaiProvider } = await import("@/features/shell/jotai-provider");
const { WorkspaceArea } = await import("./workspace-area");
const { WORKSPACE_NOT_IN_LIST_NOTICE } = await import(
  "./workspace-area-route-core"
);
const { WORKSPACE_ID_COPIED_NOTICE } = await import(
  "./workspace-detail-header"
);
await moduleDom.restore();

let dom: TestDom;
let actEnvironment: boolean | undefined;
let fetchOverride: GlobalOverride;
let rendered: ReturnType<typeof render> | undefined;
let sessionCounter = 0;

// Each scenario gets its own regional token so SWR never replays another
// test's details across the credential-keyed cache.
function hydrate(scenario: Scenario, currentUid: string) {
  fixtures.scenario = scenario;
  sessionCounter += 1;
  const workspaces = WORKSPACES[scenario];
  const current = workspaces.find((workspace) => workspace.uid === currentUid);
  assert.ok(current, `${currentUid} is in the ${scenario} list`);
  const store = getDefaultStore();
  store.set(appTokenAtom, "desktop-app-token");
  store.set(kubeconfigAtom, "apiVersion: v1");
  store.set(namespaceAtom, current.id);
  store.set(regionalTokenAtom, `regional-${scenario}-${sessionCounter}`);
  store.set(currentWorkspaceAtom, current);
  store.set(workspacesAtom, workspaces);
  store.set(sessionUserAtom, ME);
}

beforeEach(() => {
  dom = installTestDom();
  actEnvironment = setActEnvironment(true);
  fetchOverride = defineGlobal("fetch", fetchStub);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        copied.push(text);
        return Promise.resolve();
      },
    },
  });
  route.params = {};
  route.replaced = [];
  toasts.length = 0;
  copied.length = 0;
  requests.length = 0;
});

afterEach(async () => {
  await actAndDrain(() => {
    rendered?.unmount();
    rendered = undefined;
  }).catch(() => undefined);
  restoreGlobal(fetchOverride);
  restoreActEnvironment(actEnvironment);
  await dom.restore();
});

async function mountArea(uid: string | undefined) {
  route.params = uid == null ? {} : { uid };
  await actAndDrain(() => {
    rendered = render(
      <JotaiProvider>
        <WorkspaceArea />
      </JotaiProvider>
    );
  });
  // The details and plans land on the next ticks.
  await actAndDrain(() => undefined, 20);
}

function byLabel(label: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}

function bySlot(slot: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
}

function allBySlot(slot: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-slot="${slot}"]`)];
}

function memberRowNames(): string[] {
  return allBySlot("workspace-member-row").map(
    (row) => row.querySelector("td span.truncate")?.textContent ?? ""
  );
}

function tableHeadCount(): number {
  return document.querySelectorAll('[data-slot="table-head"]').length;
}

async function openActionsMenu(): Promise<HTMLElement> {
  const trigger = byLabel("Workspace actions");
  assert.ok(trigger, "the ⋯ menu trigger is rendered");
  await actAndDrain(() => {
    trigger.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 })
    );
    trigger.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 })
    );
    trigger.click();
  });
  const menu = bySlot("dropdown-menu-content");
  assert.ok(menu, "the ⋯ menu opened");
  return menu;
}

function menuItems(menu: HTMLElement): {
  disabled: boolean;
  label: string;
  reason: string | null;
}[] {
  return [
    ...menu.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
  ].map((item) => ({
    disabled:
      item.hasAttribute("data-disabled") || item.ariaDisabled === "true",
    label: item.querySelector("span > span")?.textContent ?? "",
    reason:
      item.querySelector('[data-slot="workspace-action-reason"]')
        ?.textContent ?? null,
  }));
}

test("the Owner of the current Team Workspace: every control, delete waiting for a switch, rows gated per member", async () => {
  hydrate("owner", "uid-acme");
  await mountArea("uid-acme");

  // The list: Desktop's order, the current dot, roles, the create row.
  const rows = allBySlot("workspace-area-row");
  assert.deepEqual(
    rows.map((row) => row.textContent),
    ["private teamPersonal", "AcmeCurrent workspaceOwner", "SoloOwner"].map(
      (text) => text.replace("Current workspace", "")
    )
  );
  assert.equal(rows[1]?.getAttribute("aria-current"), "page");
  assert.ok(rows[1]?.querySelector('[data-slot="workspace-area-current-dot"]'));
  assert.equal(
    rows[0]?.querySelector('[data-slot="workspace-area-current-dot"]'),
    null
  );
  assert.equal(
    bySlot("workspace-area-create")?.getAttribute("href"),
    "/billing?mode=create"
  );

  // The header: name, plan, Current, the role line, the copyable id.
  const header = bySlot("workspace-detail-header");
  assert.ok(header);
  assert.match(header.textContent ?? "", ACME_NAME_RE);
  assert.equal(bySlot("plan-badge")?.textContent, "Pro");
  assert.ok(bySlot("workspace-current-badge"));
  assert.equal(bySlot("workspace-detail-role")?.textContent, "You're Owner");
  assert.match(byLabel("Copy workspace ID")?.textContent ?? "", ACME_ID_RE);
  assert.equal(byLabel("Leave workspace"), null, "the Owner cannot leave");

  const items = menuItems(await openActionsMenu());
  assert.deepEqual(items, [
    { disabled: false, label: "Rename…", reason: null },
    { disabled: false, label: "Transfer ownership…", reason: null },
    {
      disabled: true,
      label: "Delete workspace…",
      reason: SWITCH_FIRST_REASON,
    },
  ]);

  // The members: count, Invite, a select for the others, You on my row,
  // the alias subline, the pencil everywhere, remove for the others only.
  assert.equal(bySlot("workspace-members-count")?.textContent, "3");
  assert.ok(byLabel("Invite member"));
  assert.deepEqual(memberRowNames(), ["Ada Lovelace", "Lin Wei", "Chen Jie"]);
  assert.equal(allBySlot("workspace-member-you").length, 1);
  assert.equal(bySlot("workspace-member-alias")?.textContent, "Frontend lead");
  assert.ok(byLabel("Role of Lin Wei"));
  assert.ok(byLabel("Role of Chen Jie"));
  assert.equal(byLabel("Role of Ada Lovelace"), null);
  assert.deepEqual(
    allBySlot("workspace-member-role").map((role) => role.textContent),
    ["Owner"]
  );
  assert.ok(byLabel("Set alias for Ada Lovelace"));
  assert.ok(byLabel("Edit alias for Lin Wei"));
  assert.ok(byLabel("Remove Lin Wei"));
  assert.ok(byLabel("Remove Chen Jie"));
  assert.equal(byLabel("Remove Ada Lovelace"), null);
  assert.equal(tableHeadCount(), 4);

  // The details read went through the session fetch with the uid.
  const details = requests.find((r) => r.url === "/api/workspace/details");
  assert.ok(details);
  assert.equal(details.method, "POST");
  assert.deepEqual(details.body, { uid: "uid-acme" });
  assert.equal(
    details.headers.get(REGION_TOKEN_HEADER),
    `regional-owner-${sessionCounter}`
  );
  assert.deepEqual(route.replaced, []);
  assert.deepEqual(toasts, []);
});

test("the Owner managing a Workspace they are alone in and not working in: delete is live, transfer waits for a member", async () => {
  hydrate("owner", "uid-acme");
  await mountArea("uid-solo");

  assert.equal(bySlot("workspace-current-badge"), null);
  assert.equal(bySlot("plan-payg")?.textContent, "PAYG");
  const items = menuItems(await openActionsMenu());
  assert.deepEqual(items, [
    { disabled: false, label: "Rename…", reason: null },
    {
      disabled: true,
      label: "Transfer ownership…",
      reason: INVITE_FIRST_REASON,
    },
    { disabled: false, label: "Delete workspace…", reason: null },
  ]);
  assert.deepEqual(memberRowNames(), ["Ada Lovelace"]);
  // Nobody removable: no action column at all.
  assert.equal(tableHeadCount(), 3);
});

test("a Manager: invites and removes Developers, sets any alias, changes no role, leaves unless it is the current Workspace", async () => {
  hydrate("manager", "uid-personal");
  await mountArea("uid-acme");

  assert.equal(byLabel("Workspace actions"), null, "no ⋯ menu");
  const leave = byLabel("Leave workspace");
  assert.ok(leave);
  assert.equal(leave.hasAttribute("disabled"), false);
  assert.equal(bySlot("workspace-detail-role")?.textContent, "You're Manager");
  assert.ok(byLabel("Invite member"));

  assert.deepEqual(memberRowNames(), ["Rui", "Ada Lovelace", "Yu", "Qi"]);
  assert.equal(document.querySelectorAll('[aria-label^="Role of"]').length, 0);
  assert.deepEqual(
    allBySlot("workspace-member-role").map((role) => role.textContent),
    ["Owner", "Manager", "Manager", "Developer"]
  );
  assert.ok(byLabel("Set alias for Rui"), "the Owner's alias too");
  assert.ok(byLabel("Set alias for Ada Lovelace"), "my own alias too");
  assert.ok(byLabel("Remove Qi"));
  assert.equal(byLabel("Remove Yu"), null);
  assert.equal(byLabel("Remove Rui"), null);
  assert.equal(byLabel("Remove Ada Lovelace"), null);
  assert.equal(tableHeadCount(), 4);
});

test("a Manager working in the Workspace cannot leave it yet", async () => {
  hydrate("manager", "uid-acme");
  await mountArea("uid-acme");

  const leave = byLabel("Leave workspace");
  assert.ok(leave);
  assert.equal(leave.hasAttribute("disabled"), true);
  assert.ok(bySlot("workspace-current-badge"));
});

test("a Developer reads the member table and can leave; nothing else is offered", async () => {
  hydrate("developer", "uid-personal");
  await mountArea("uid-acme");

  assert.equal(byLabel("Workspace actions"), null);
  assert.ok(byLabel("Leave workspace"));
  assert.equal(byLabel("Invite member"), null);
  assert.deepEqual(memberRowNames(), ["Kai", "Ming", "Ada Lovelace"]);
  assert.equal(allBySlot("workspace-member-alias-edit").length, 0);
  assert.equal(allBySlot("workspace-member-remove").length, 0);
  assert.equal(tableHeadCount(), 3, "no action column");
  assert.equal(document.querySelectorAll('[aria-label^="Role of"]').length, 0);
  assert.equal(bySlot("workspace-member-alias")?.textContent, "Docs PM");
});

test("only a Personal Workspace: one row and Create, the detail with Rename alone and a member table of one", async () => {
  hydrate("personal-only", "uid-personal");
  await mountArea("uid-personal");

  assert.equal(allBySlot("workspace-area-row").length, 1);
  assert.ok(bySlot("workspace-area-create"));
  assert.equal(
    bySlot("workspace-detail-role")?.textContent,
    "Personal workspace"
  );
  assert.equal(byLabel("Leave workspace"), null);
  const menu = await openActionsMenu();
  assert.deepEqual(menuItems(menu), [
    { disabled: false, label: "Rename…", reason: null },
  ]);
  assert.equal(
    menu.querySelector('[data-slot="dropdown-menu-separator"]'),
    null
  );
  assert.equal(bySlot("workspace-members-count")?.textContent, "1");
  assert.equal(allBySlot("workspace-member-you").length, 1);
  assert.equal(tableHeadCount(), 3);
});

test("/workspace replaces itself with the current Workspace, silently", async () => {
  hydrate("owner", "uid-acme");
  await mountArea(undefined);

  assert.deepEqual(route.replaced, ["/workspace/uid-acme"]);
  assert.deepEqual(toasts, []);
  assert.equal(bySlot("workspace-detail"), null);
});

test("a uid outside the list falls back to the current Workspace and says so once", async () => {
  hydrate("owner", "uid-acme");
  await mountArea("uid-elsewhere");

  assert.deepEqual(route.replaced, ["/workspace/uid-acme"]);
  assert.deepEqual(toasts, [WORKSPACE_NOT_IN_LIST_NOTICE]);
  assert.equal(
    requests.some((r) => r.url === "/api/workspace/details"),
    false,
    "no details read for a Workspace outside the list"
  );
});

test("the close button returns to the recorded entry point, or home on a direct entry", async () => {
  hydrate("owner", "uid-acme");
  await mountArea("uid-acme");
  assert.equal(byLabel("Close workspaces")?.getAttribute("href"), "/");

  await actAndDrain(() => {
    rendered?.unmount();
    rendered = undefined;
  });
  window.sessionStorage.setItem("workspace-return-route", "/project/alpha");
  await mountArea("uid-acme");
  assert.equal(
    byLabel("Close workspaces")?.getAttribute("href"),
    "/project/alpha"
  );
});

test("copying the workspace id writes the namespace id and says so", async () => {
  hydrate("owner", "uid-acme");
  await mountArea("uid-acme");

  const copy = byLabel("Copy workspace ID");
  assert.ok(copy);
  await actAndDrain(() => {
    copy.click();
  });
  assert.deepEqual(copied, ["ns-acme"]);
  assert.deepEqual(toasts, [WORKSPACE_ID_COPIED_NOTICE]);
});
