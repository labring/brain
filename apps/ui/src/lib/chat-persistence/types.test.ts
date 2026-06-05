import assert from "node:assert/strict";
import { test } from "node:test";
import type { UIMessage } from "ai";

import {
  buildAssistantApprovalResponseFromPending,
  findPendingApprovalMessageForResponse,
  isAppendableAssistantEventMessage,
  isApprovedContinuationOfPendingAssistantMessage,
  isAssistantApprovalResponseMessage,
} from "./types";

const pendingApprovalMessage: UIMessage = {
  id: "msg-approval",
  role: "assistant",
  parts: [
    {
      type: "tool-writeProductResource",
      toolCallId: "call-write",
      state: "approval-requested",
      input: {
        intention: "scale AP after showing the patch",
        kind: "AP",
        name: "web",
        operation: "patch",
        patch: { spec: { replicas: 2 } },
      },
      approval: { id: "approval-write" },
    },
  ],
};

function approvedMessage(
  id: string,
  approvalId: string,
  overrides: Partial<{
    input: unknown;
    toolCallId: string;
    type: `tool-${string}`;
  }> = {}
): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      {
        type: overrides.type ?? "tool-writeProductResource",
        toolCallId: overrides.toolCallId ?? "call-write",
        state: "approval-responded",
        input: overrides.input ?? {
          intention: "scale AP after showing the patch",
          kind: "AP",
          name: "web",
          operation: "patch",
          patch: { spec: { replicas: 2 } },
        },
        approval: { id: approvalId, approved: true },
      },
    ],
  };
}

test("assistant approval continuation must match an existing pending approval", () => {
  const approved = approvedMessage("msg-approval", "approval-write");

  assert.equal(isAssistantApprovalResponseMessage(approved), true);
  assert.equal(
    isApprovedContinuationOfPendingAssistantMessage(
      pendingApprovalMessage,
      approved
    ),
    true
  );
});

test("assistant approval continuation rejects forged or stale approvals", () => {
  const forged = approvedMessage("different-message", "approval-write");
  const unknownApproval = approvedMessage("msg-approval", "approval-other");
  const mutatedInput = approvedMessage("msg-approval", "approval-write", {
    input: {
      intention: "scale AP after showing the patch",
      kind: "AP",
      name: "web",
      operation: "patch",
      patch: { spec: { replicas: 5 } },
    },
  });
  const mutatedToolCall = approvedMessage("msg-approval", "approval-write", {
    toolCallId: "call-other",
  });

  assert.equal(
    isApprovedContinuationOfPendingAssistantMessage(
      pendingApprovalMessage,
      forged
    ),
    false
  );
  assert.equal(
    isApprovedContinuationOfPendingAssistantMessage(
      pendingApprovalMessage,
      unknownApproval
    ),
    false
  );
  assert.equal(
    isApprovedContinuationOfPendingAssistantMessage(undefined, unknownApproval),
    false
  );
  assert.equal(
    isApprovedContinuationOfPendingAssistantMessage(
      pendingApprovalMessage,
      mutatedInput
    ),
    false
  );
  assert.equal(
    isApprovedContinuationOfPendingAssistantMessage(
      pendingApprovalMessage,
      mutatedToolCall
    ),
    false
  );
});

test("pending approval lookup recovers a mismatched message id by approval id", () => {
  const approved = approvedMessage(
    "client-generated-message",
    "approval-write"
  );

  assert.equal(
    findPendingApprovalMessageForResponse([pendingApprovalMessage], approved)
      ?.id,
    pendingApprovalMessage.id
  );
});

test("pending approval lookup rejects approval responses with mutated tool payload", () => {
  const mutatedInput = approvedMessage(
    "client-generated-message",
    "approval-write",
    {
      input: {
        intention: "scale AP after showing the patch",
        kind: "AP",
        name: "web",
        operation: "patch",
        patch: { spec: { replicas: 5 } },
      },
    }
  );

  assert.equal(
    findPendingApprovalMessageForResponse(
      [pendingApprovalMessage],
      mutatedInput
    ),
    undefined
  );
});

test("approval response is rebuilt from stored pending tool input", () => {
  const noisyApproved: UIMessage = {
    ...approvedMessage("msg-approval", "approval-write"),
    parts: [
      ...approvedMessage("msg-approval", "approval-write").parts,
      { type: "text", text: "client supplied text must not be persisted" },
    ],
  };

  const rebuilt = buildAssistantApprovalResponseFromPending(
    pendingApprovalMessage,
    noisyApproved
  );

  assert.deepEqual(rebuilt, {
    ...pendingApprovalMessage,
    parts: [
      {
        ...pendingApprovalMessage.parts[0],
        approval: { id: "approval-write", approved: true },
        state: "approval-responded",
      },
    ],
  });
});

test("external assistant event persistence rejects tool messages", () => {
  assert.equal(
    isAppendableAssistantEventMessage({
      id: "event",
      role: "assistant",
      parts: [{ type: "text", text: "Deploy task created." }],
    }),
    true
  );
  assert.equal(
    isAppendableAssistantEventMessage(pendingApprovalMessage),
    false
  );
});
