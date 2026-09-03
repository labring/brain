import { describe, expect, test } from "bun:test";

import type { AssistantContextPayload } from "@/features/chat/persistence/types";

import { buildAssistantWorkspaceContextPrompt } from "./workspace-context-prompt";

const PROJECT = {
  kind: "project",
  projectId: "e9226144-c507-4cd6-83ba-5289d65f6c8b",
  projectName: "eaglercraft-server",
} as const;

function promptFor(
  opts: {
    assistantContext?: AssistantContextPayload;
    kubernetesNamespace?: string;
  } = {}
): string {
  return buildAssistantWorkspaceContextPrompt({
    assistantContext: opts.assistantContext ?? PROJECT,
    kubernetesNamespace: opts.kubernetesNamespace ?? "ns-admin",
  });
}

describe("buildAssistantWorkspaceContextPrompt", () => {
  test("documents both per-message context blocks the model can receive", () => {
    const prompt = promptFor();
    expect(prompt).toContain("<selected_resource");
    expect(prompt).toContain("<workspace_resource_context");
  });

  test("does not invite the model to report an absent selection", () => {
    // Regression: the prompt used to end the selection sentence with "its
    // absence means nothing was selected", which the assistant started
    // volunteering on every turn that carried no selection.
    expect(promptFor()).not.toContain("its absence means nothing");
  });

  test("forbids reciting the blocks or announcing that one was absent", () => {
    const prompt = promptFor();
    expect(prompt).toContain("## Attached context blocks");
    expect(prompt).toContain("Do not describe, enumerate, or summarize");
    expect(prompt).toContain("was absent or empty");
    expect(prompt).toContain("ask which resource is meant");
  });

  test("forbids inferring that nothing is running from a quota reading", () => {
    // Regression: a quota snapshot of zeros led the assistant to tell the user
    // their project had nothing running, from capacity numbers alone.
    const prompt = promptFor();
    expect(prompt).toContain("not runtime state");
    expect(prompt).toContain(
      "Never infer whether resources exist or are running"
    );
    expect(prompt).toContain("read live state with tools");
  });

  test("keeps the presentation rules when no project is active", () => {
    // A workspace-scoped chat still gets the quota block, so the rules cannot
    // live behind the project branch.
    const prompt = promptFor({ assistantContext: { kind: "workspace" } });
    expect(prompt).toContain("No Brain Project is active");
    expect(prompt).toContain("## Attached context blocks");
    expect(prompt).toContain("<workspace_resource_context");
  });
});
