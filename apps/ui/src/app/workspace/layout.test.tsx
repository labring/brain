import { mock, test } from "bun:test";
import assert from "node:assert/strict";
import { isValidElement, type ReactNode } from "react";

mock.module("server-only", () => ({}));

const { SessionBootstrap } = await import(
  "@/features/session/session-bootstrap"
);
const { DevboxBootstrap } = await import("@/features/shell/devbox-bootstrap");
const { default: ProjectWorkspaceLayout } = await import(
  "@/features/shell/project-workspace-layout"
);
const { StatusHintBanner } = await import(
  "@/features/status-hint/status-hint-banner"
);
const { WorkspaceArea } = await import("@/features/workspace/workspace-area");
const { default: WorkspaceLayout } = await import("./layout");

function mountedComponents(
  node: ReactNode,
  found: Set<unknown> = new Set()
): Set<unknown> {
  if (Array.isArray(node)) {
    for (const child of node) {
      mountedComponents(child, found);
    }
    return found;
  }
  if (!isValidElement(node)) {
    return found;
  }
  found.add(node.type);
  return mountedComponents(
    (node.props as { children?: ReactNode }).children,
    found
  );
}

test("workspace layout mounts the area once with the session bootstrap and the status hint", () => {
  const mounted = mountedComponents(WorkspaceLayout({ children: null }));

  assert.ok(mounted.has(SessionBootstrap), "SessionBootstrap is mounted");
  assert.ok(mounted.has(WorkspaceArea), "WorkspaceArea is mounted");
  assert.ok(mounted.has(StatusHintBanner), "StatusHintBanner is mounted");
  assert.equal(
    mounted.has(DevboxBootstrap),
    false,
    "DevboxBootstrap is absent"
  );
  assert.equal(
    mounted.has(ProjectWorkspaceLayout),
    false,
    "ProjectWorkspaceLayout is absent"
  );
});
