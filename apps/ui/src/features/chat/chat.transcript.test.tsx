import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@testing-library/react/pure";
import type { UIMessage } from "ai";
import { withTestDom } from "@/features/project-canvas/react-test-harness";
import { ChatTranscript } from "./chat.transcript";
import {
  SELECTED_CONTEXT_PART_TYPE,
  SELECTED_RESOURCE_CONTEXT_PART_TYPE,
} from "./persistence/types";

const LEGACY_API_LABEL_RE = /Legacy API/;
const AP_KIND_RE = /AP/;
const UNAVAILABLE_LABEL_RE = /Unavailable/;

function userMessage(parts: UIMessage["parts"]): UIMessage {
  return { id: "user-1", role: "user", parts } as UIMessage;
}

test("transcript shows a message-scoped selected context chip with its snapshot label", async () => {
  await withTestDom(async (act) => {
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <ChatTranscript
            messages={[
              userMessage([
                {
                  type: SELECTED_CONTEXT_PART_TYPE,
                  data: {
                    type: "resource",
                    displayName: "My Redis",
                    kind: "DB",
                    name: "redis-x7k2",
                    namespace: "project-ns",
                    observedUid: "redis-uid",
                  },
                },
                { type: "text", text: "show the status" },
              ]),
            ]}
            selectedContextAvailability={() => "available"}
          />
        );
      });

      const chip = rendered?.container.querySelector(
        '[data-slot="chat-selected-context"]'
      );
      assert.ok(chip);
      assert.ok((chip?.textContent ?? "").includes("My Redis"));
      assert.ok((chip?.textContent ?? "").includes("DB"));
      assert.equal(
        chip?.getAttribute("aria-label"),
        "Referenced: My Redis · DB"
      );
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("transcript marks a deleted selected resource unavailable without changing the snapshot label", async () => {
  await withTestDom(async (act) => {
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <ChatTranscript
            messages={[
              userMessage([
                {
                  type: SELECTED_CONTEXT_PART_TYPE,
                  data: {
                    type: "resource",
                    displayName: "Old API name",
                    kind: "AP",
                    name: "api-x7k2",
                    namespace: "project-ns",
                    observedUid: "old-uid",
                  },
                },
                { type: "text", text: "restart this" },
              ]),
            ]}
            selectedContextAvailability={() => "unavailable"}
          />
        );
      });

      const chip = rendered?.container.querySelector(
        '[data-slot="chat-selected-context"]'
      );
      assert.ok(chip);
      assert.ok((chip?.textContent ?? "").includes("Old API name"));
      assert.ok((chip?.textContent ?? "").includes("Unavailable"));
      assert.equal(
        chip?.getAttribute("aria-label"),
        "Referenced: Old API name · AP · Unavailable"
      );
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("transcript renders a legacy selected-resource part for compatibility", async () => {
  await withTestDom(async (act) => {
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <ChatTranscript
            messages={[
              userMessage([
                {
                  type: SELECTED_RESOURCE_CONTEXT_PART_TYPE,
                  data: {
                    displayName: "Legacy API",
                    kind: "AP",
                    name: "legacy-api",
                    namespace: "project-ns",
                  },
                },
                { type: "text", text: "show logs" },
              ]),
            ]}
            selectedContextAvailability={() => "unknown"}
          />
        );
      });

      const chip = rendered?.container.querySelector(
        '[data-slot="chat-selected-context"]'
      );
      assert.ok(chip);
      assert.match(chip?.textContent ?? "", LEGACY_API_LABEL_RE);
      assert.match(chip?.textContent ?? "", AP_KIND_RE);
      assert.doesNotMatch(chip?.textContent ?? "", UNAVAILABLE_LABEL_RE);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});
