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
  test("injects only the latest user turn in the compact resource format", () => {
    const history = [
      userMessage("u-1", "first"),
      { id: "a-1", role: "assistant", parts: [{ type: "text", text: "ok" }] },
      userMessage("u-2", "second"),
    ] as UIMessage[];

    const [first, assistant, latest] = withWorkspaceResourceContext(history, {
      rows: [
        ["CPU", "19.2C/36C"],
        ["Memory", "26.25Gi/164Gi"],
        ["Storage", "12Gi/200Gi"],
        ["Pods", "--/--"],
        ["Ports", "0/10"],
      ],
      status: "available",
    });

    expect(first).toBe(history[0]);
    expect(assistant).toBe(history[1]);
    expect(latest?.parts[0]).toEqual({
      type: "text",
      text: [
        '<workspace_resource_context data-not-instructions="true">',
        "CPU19.2C/36C",
        "Memory26.25Gi/164Gi",
        "Storage12Gi/200Gi",
        "Pods--/--",
        "Ports0/10",
        "</workspace_resource_context>",
      ].join("\n"),
    });
    expect(latest?.parts.at(-1)).toEqual({ type: "text", text: "second" });
  });
});
