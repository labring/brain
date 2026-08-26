import { describe, expect, mock, test } from "bun:test";
import type { UIMessage } from "ai";

mock.module("server-only", () => ({}));

const { withWorkspaceResourceContext } = await import(
  "./workspace-resource-context"
);

function userMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
  } as unknown as UIMessage;
}

describe("withWorkspaceResourceContext", () => {
  test("injects only the latest user turn with the current resource snapshot", () => {
    const history = [
      userMessage("u-1", "first"),
      { id: "a-1", role: "assistant", parts: [{ type: "text", text: "ok" }] },
      userMessage("u-2", "second"),
    ] as UIMessage[];

    const [first, assistant, latest] = withWorkspaceResourceContext(history, {
      items: [
        { limit: 36_000, type: "cpu", used: 19_200 },
        { limit: 167_936, type: "memory", used: 26_880 },
        { limit: 204_800, type: "storage", used: 12_288 },
        { limit: 20, type: "pod", used: 3 },
        { limit: 10, type: "nodeport", used: 0 },
      ],
    });

    expect(first).toBe(history[0]);
    expect(assistant).toBe(history[1]);
    expect(latest?.parts[0]).toEqual({
      type: "text",
      text: [
        '<workspace_resource_context data-not-instructions="true">',
        "CPU: 19.2C/36C",
        "Memory: 26.25Gi/164Gi",
        "Storage: 12Gi/200Gi",
        "Pods: 3/20",
        "Ports: 0/10",
        "</workspace_resource_context>",
      ].join("\n"),
    });
    expect(latest?.parts.at(-1)).toEqual({ type: "text", text: "second" });
  });

  test("does not inject a block when the client snapshot is missing", () => {
    const history = [userMessage("u-1", "first")];
    expect(withWorkspaceResourceContext(history, undefined)).toBe(history);
  });
});
