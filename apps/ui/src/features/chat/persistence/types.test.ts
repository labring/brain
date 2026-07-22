import assert from "node:assert/strict";
import { test } from "node:test";
import { isToolUIPart, type UIMessage } from "ai";

import {
  buildAssistantApprovalResponseFromPending,
  buildAssistantContinuationFromPending,
  buildRecoveredAssistantMessageForIncompleteClientTools,
  findPendingApprovalMessageForResponse,
  findPendingAssistantMessageForContinuation,
  hasClientToolResultContinuation,
  INCOMPLETE_CLIENT_TOOL_RECOVERY_ERROR,
  isAppendableAssistantEventMessage,
  isApprovedContinuationOfPendingAssistantMessage,
  isAssistantApprovalResponseMessage,
  isAssistantContinuationMessage,
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
    isAppendableAssistantEventMessage({
      id: "data-event",
      role: "assistant",
      parts: [
        {
          type: "data-event",
          data: { ok: true },
        },
      ],
    }),
    false
  );
  assert.equal(
    isAppendableAssistantEventMessage(pendingApprovalMessage),
    false
  );
});
type ToolPartType = `tool-${string}`;

function requiredPart(
  message: UIMessage,
  index: number
): UIMessage["parts"][number] {
  const part = message.parts[index];
  assert.ok(part);
  return part;
}

function pendingClientToolMessage(
  type: ToolPartType,
  input: unknown = { intention: "open the requested view" }
): UIMessage {
  return {
    id: "msg-client-tool",
    role: "assistant",
    parts: [
      {
        type,
        toolCallId: "call-client-tool",
        state: "input-available",
        input,
      },
    ],
  };
}

function clientToolOutputCandidate(
  pending: UIMessage,
  output: unknown
): UIMessage {
  const part = requiredPart(pending, 0);
  return {
    ...pending,
    parts: [
      {
        ...part,
        output,
        state: "output-available",
      },
    ],
  } as UIMessage;
}

test("client tool outputs are rebuilt from stored inputs with canonical schemas", () => {
  const cases: Array<{
    output: unknown;
    type: ToolPartType;
  }> = [
    {
      output: { path: "/project/demo", success: true },
      type: "tool-navigateApp",
    },
    {
      output: { ok: true, status: "handled" },
      type: "tool-openProjectSurface",
    },
    {
      output: { ok: true, status: "scheduled" },
      type: "tool-refreshFrontendSwrCaches",
    },
  ];

  for (const item of cases) {
    const pending = pendingClientToolMessage(item.type);
    const candidate = clientToolOutputCandidate(pending, item.output);

    const rebuilt = buildAssistantContinuationFromPending(pending, candidate);

    assert.deepEqual(rebuilt, candidate);
    assert.equal(hasClientToolResultContinuation(candidate), true);
    assert.equal(isAssistantContinuationMessage(candidate), true);
  }
});

test("client tool output-error is bounded, trimmed, and rebuilt from storage", () => {
  const pending = pendingClientToolMessage("tool-navigateApp", {
    intention: "open the project",
    path: "/project/demo",
  });
  const pendingPart = requiredPart(pending, 0);
  const candidate = {
    ...pending,
    parts: [
      {
        ...pendingPart,
        errorText: "  browser navigation failed  ",
        state: "output-error",
      },
    ],
  } as UIMessage;

  const rebuilt = buildAssistantContinuationFromPending(pending, candidate);

  assert.deepEqual(rebuilt, {
    ...pending,
    parts: [
      {
        ...pendingPart,
        errorText: "browser navigation failed",
        state: "output-error",
      },
    ],
  });

  for (const errorText of ["   ", "x".repeat(501)]) {
    const invalid = {
      ...candidate,
      parts: [{ ...candidate.parts[0], errorText }],
    } as UIMessage;
    assert.equal(
      buildAssistantContinuationFromPending(pending, invalid),
      undefined
    );
  }
});

test("client continuation rejects forged identity, shape, input, and output", () => {
  const pending = pendingClientToolMessage("tool-navigateApp", {
    intention: "open the project",
    path: "/project/demo",
  });
  const valid = clientToolOutputCandidate(pending, {
    path: "/project/demo",
    success: true,
  });
  const validPart = requiredPart(valid, 0);

  const forgedCandidates: UIMessage[] = [
    { ...valid, id: "different-message" },
    { ...valid, parts: [...valid.parts, { type: "text", text: "injected" }] },
    {
      ...valid,
      parts: [{ ...validPart, toolCallId: "different-call" }],
    } as UIMessage,
    {
      ...valid,
      parts: [
        {
          ...validPart,
          input: { intention: "open another project", path: "/project/other" },
        },
      ],
    } as UIMessage,
    {
      ...valid,
      parts: [{ ...validPart, type: "tool-openProjectSurface" }],
    } as UIMessage,
    clientToolOutputCandidate(pending, {
      extra: "not allowed",
      path: "/project/demo",
      success: true,
    }),
  ];

  for (const forged of forgedCandidates) {
    assert.equal(
      buildAssistantContinuationFromPending(pending, forged),
      undefined
    );
  }
});

test("client continuation cannot alter stored text or server tool results", () => {
  const clientPending = pendingClientToolMessage("tool-navigateApp");
  const pending: UIMessage = {
    ...clientPending,
    parts: [
      { type: "text", text: "Opening the project." },
      ...clientPending.parts,
      {
        type: "tool-getDeployTaskStatus",
        toolCallId: "call-server-tool",
        state: "output-available",
        input: { taskId: "task-1" },
        output: { status: "running" },
      },
    ],
  };
  const storedText = requiredPart(pending, 0);
  const clientPart = requiredPart(pending, 1);
  const serverPart = requiredPart(pending, 2);
  const completedClient = {
    ...clientPart,
    output: { path: "/project", success: true },
    state: "output-available",
  } as UIMessage["parts"][number];

  const changedText = {
    ...pending,
    parts: [
      { type: "text", text: "Client supplied replacement." },
      completedClient,
      serverPart,
    ],
  } as UIMessage;
  const changedServerOutput = {
    ...pending,
    parts: [
      storedText,
      completedClient,
      {
        ...serverPart,
        output: { status: "succeeded" },
      },
    ],
  } as UIMessage;

  assert.equal(
    buildAssistantContinuationFromPending(pending, changedText),
    undefined
  );
  assert.equal(
    buildAssistantContinuationFromPending(pending, changedServerOutput),
    undefined
  );
});

test("untrusted message and tool metadata are discarded during rebuild", () => {
  const pending = pendingClientToolMessage("tool-navigateApp");
  const valid = clientToolOutputCandidate(pending, {
    path: "/project",
    success: true,
  });
  const part = requiredPart(valid, 0);
  const noisy = {
    ...valid,
    metadata: { forged: true },
    parts: [
      {
        ...part,
        resultProviderMetadata: { forged: { value: true } },
        toolMetadata: { forged: true },
      },
    ],
  } as UIMessage;

  assert.deepEqual(
    buildAssistantContinuationFromPending(pending, noisy),
    valid
  );
});

test("multi-tool continuation requires every non-provider tool to be ready", () => {
  const navigateInput = { intention: "open project", path: "/project/demo" };
  const surfaceInput = { intention: "open logs", type: "logs" };
  const pending: UIMessage = {
    id: "msg-multi",
    role: "assistant",
    parts: [
      {
        type: "tool-navigateApp",
        toolCallId: "call-navigate",
        state: "input-available",
        input: navigateInput,
      },
      {
        type: "tool-openProjectSurface",
        toolCallId: "call-surface",
        state: "input-available",
        input: surfaceInput,
      },
    ],
  };
  const pendingNavigate = requiredPart(pending, 0);
  const pendingSurface = requiredPart(pending, 1);
  const complete = {
    ...pending,
    parts: [
      {
        ...pendingNavigate,
        output: { path: "/project/demo", success: true },
        state: "output-available",
      },
      {
        ...pendingSurface,
        output: { ok: true, status: "handled" },
        state: "output-available",
      },
    ],
  } as UIMessage;
  const completedNavigate = requiredPart(complete, 0);
  const partial = {
    ...complete,
    parts: [completedNavigate, pendingSurface],
  };

  assert.deepEqual(
    buildAssistantContinuationFromPending(pending, complete),
    complete
  );
  assert.equal(
    buildAssistantContinuationFromPending(pending, partial),
    undefined
  );
});

test("client outputs can advance together with a stored approval response", () => {
  const pendingApprovalPart = requiredPart(pendingApprovalMessage, 0);
  const pending: UIMessage = {
    id: "msg-mixed",
    role: "assistant",
    parts: [
      {
        type: "tool-refreshFrontendSwrCaches",
        toolCallId: "call-refresh",
        state: "input-available",
        input: { intention: "refresh after the write" },
      },
      pendingApprovalPart,
    ],
  };
  const pendingRefresh = requiredPart(pending, 0);
  const pendingWrite = requiredPart(pending, 1);
  const candidate = {
    ...pending,
    parts: [
      {
        ...pendingRefresh,
        output: { ok: true, status: "scheduled" },
        state: "output-available",
      },
      {
        ...pendingWrite,
        approval: { id: "approval-write", approved: true },
        state: "approval-responded",
      },
    ],
  } as UIMessage;

  assert.deepEqual(
    buildAssistantContinuationFromPending(pending, candidate),
    candidate
  );
});

test("a terminal client result does not block a later approval response", () => {
  const navigateInput = {
    intention: "open the project",
    path: "/project",
  };
  const writeInput = {
    intention: "scale the deployment",
    operation: "patch",
  };
  const pending: UIMessage = {
    id: "msg-client-then-approval",
    role: "assistant",
    parts: [
      {
        type: "tool-navigateApp",
        toolCallId: "call-navigation-complete",
        state: "output-available",
        input: navigateInput,
        output: { path: "/project", success: true },
      },
      { type: "step-start" },
      {
        type: "tool-writeProductResource",
        toolCallId: "call-write-after-navigation",
        state: "approval-requested",
        input: writeInput,
        approval: { id: "approval-after-navigation" },
      },
    ],
  };
  const completedNavigation = requiredPart(pending, 0);
  const stepStart = requiredPart(pending, 1);
  const candidate: UIMessage = {
    ...pending,
    parts: [
      completedNavigation,
      stepStart,
      {
        type: "tool-writeProductResource",
        toolCallId: "call-write-after-navigation",
        state: "approval-responded",
        input: writeInput,
        approval: { id: "approval-after-navigation", approved: true },
      },
    ],
  };

  assert.equal(
    findPendingAssistantMessageForContinuation([pending], candidate),
    pending
  );
  const rebuilt = buildAssistantContinuationFromPending(pending, candidate);
  assert.ok(rebuilt);
  const rebuiltApproval = requiredPart(rebuilt, 2);
  assert.ok(isToolUIPart(rebuiltApproval));
  assert.equal(rebuiltApproval.state, "approval-responded");
});

test("legacy SWR output remains canonical across a later client continuation", () => {
  const pending: UIMessage = {
    id: "msg-legacy-refresh-then-navigation",
    role: "assistant",
    parts: [
      {
        type: "tool-refreshFrontendSwrCaches",
        toolCallId: "call-refresh-complete",
        state: "output-available",
        input: { intention: "refresh after the write" },
        output: { ok: true, status: "scheduled" },
      },
      { type: "step-start" },
      {
        type: "tool-navigateApp",
        toolCallId: "call-navigation-after-refresh",
        state: "input-available",
        input: { intention: "open the project", path: "/project" },
      },
    ],
  };
  const canonicalRefresh = requiredPart(pending, 0);
  const stepStart = requiredPart(pending, 1);
  const pendingNavigation = requiredPart(pending, 2);
  const candidate = {
    ...pending,
    parts: [
      {
        ...canonicalRefresh,
        output: { mutatedEntries: 3, ok: true },
      },
      stepStart,
      {
        ...pendingNavigation,
        output: { path: "/project", success: true },
        state: "output-available",
      },
    ],
  } as UIMessage;

  const rebuilt = buildAssistantContinuationFromPending(pending, candidate);
  assert.ok(rebuilt);
  assert.deepEqual(requiredPart(rebuilt, 0), canonicalRefresh);
  const rebuiltNavigation = requiredPart(rebuilt, 2);
  assert.ok(isToolUIPart(rebuiltNavigation));
  assert.equal(rebuiltNavigation.state, "output-available");

  const invalidLegacy = {
    ...candidate,
    parts: [
      {
        ...candidate.parts[0],
        output: { extra: true, mutatedEntries: -1, ok: true },
      },
      ...candidate.parts.slice(1),
    ],
  } as UIMessage;
  assert.equal(
    buildAssistantContinuationFromPending(pending, invalidLegacy),
    undefined
  );
});

test("pure approval continuation keeps unique approval-id message recovery", () => {
  const candidate = approvedMessage(
    "client-generated-message",
    "approval-write"
  );
  const recoveredPending = findPendingAssistantMessageForContinuation(
    [pendingApprovalMessage],
    candidate
  );
  const pendingApprovalPart = requiredPart(pendingApprovalMessage, 0);

  assert.equal(recoveredPending?.id, pendingApprovalMessage.id);
  assert.deepEqual(
    buildAssistantContinuationFromPending(recoveredPending, {
      ...candidate,
      id: recoveredPending?.id ?? candidate.id,
    }),
    {
      ...pendingApprovalMessage,
      parts: [
        {
          ...pendingApprovalPart,
          approval: { id: "approval-write", approved: true },
          state: "approval-responded",
        },
      ],
    }
  );
});

test("client result lookup never recovers a different message id", () => {
  const pending = pendingClientToolMessage("tool-navigateApp");
  const candidate = {
    ...clientToolOutputCandidate(pending, {
      path: "/project",
      success: true,
    }),
    id: "client-generated-message",
  };

  assert.equal(
    findPendingAssistantMessageForContinuation([pending], candidate),
    undefined
  );
});

test("continuation requires a new transition and rejects stale results", () => {
  const pending = pendingClientToolMessage("tool-navigateApp");
  const completed = clientToolOutputCandidate(pending, {
    path: "/project",
    success: true,
  });

  assert.equal(
    buildAssistantContinuationFromPending(pending, pending),
    undefined
  );
  assert.equal(
    buildAssistantContinuationFromPending(completed, completed),
    undefined
  );
  assert.equal(
    findPendingAssistantMessageForContinuation([completed], completed),
    undefined
  );
});

test("unknown unfinished client-like tools prevent a model continuation", () => {
  const knownPending = pendingClientToolMessage("tool-navigateApp");
  const pending: UIMessage = {
    ...knownPending,
    parts: [
      ...knownPending.parts,
      {
        type: "tool-unknownBrowserTool",
        toolCallId: "call-unknown",
        state: "input-available",
        input: {},
      },
    ],
  };
  const knownPart = requiredPart(pending, 0);
  const unknownPart = requiredPart(pending, 1);
  const candidate = {
    ...pending,
    parts: [
      {
        ...knownPart,
        output: { path: "/project", success: true },
        state: "output-available",
      },
      unknownPart,
    ],
  } as UIMessage;

  assert.equal(
    buildAssistantContinuationFromPending(pending, candidate),
    undefined
  );
});

test("legacy recovery targets only known non-provider browser tools", () => {
  const message: UIMessage = {
    id: "msg-recovery",
    role: "assistant",
    parts: [
      {
        type: "tool-navigateApp",
        toolCallId: "call-navigate",
        state: "input-available",
        input: { intention: "open project", path: "/project/demo" },
      },
      {
        type: "tool-openProjectSurface",
        toolCallId: "call-surface",
        state: "input-available",
        input: { intention: "open logs", type: "logs" },
      },
      {
        type: "tool-refreshFrontendSwrCaches",
        toolCallId: "call-refresh",
        state: "input-available",
        input: { intention: "refresh resources" },
      },
      {
        type: "tool-unknownBrowserTool",
        toolCallId: "call-unknown",
        state: "input-available",
        input: {},
      },
      {
        type: "tool-navigateApp",
        toolCallId: "call-provider",
        providerExecuted: true,
        state: "input-available",
        input: { intention: "provider call", path: "/project" },
      },
    ],
  };

  const recovered =
    buildRecoveredAssistantMessageForIncompleteClientTools(message);

  assert.ok(recovered != null);
  assert.deepEqual(
    recovered.parts.slice(0, 3).map((part) =>
      isToolUIPart(part)
        ? {
            errorText: "errorText" in part ? part.errorText : undefined,
            state: part.state,
          }
        : undefined
    ),
    Array.from({ length: 3 }, () => ({
      errorText: INCOMPLETE_CLIENT_TOOL_RECOVERY_ERROR,
      state: "output-error",
    }))
  );
  assert.deepEqual(recovered.parts[3], message.parts[3]);
  assert.deepEqual(recovered.parts[4], message.parts[4]);
  assert.equal(
    buildRecoveredAssistantMessageForIncompleteClientTools(recovered),
    undefined
  );
});

test("legacy recovery is a no-op for users and unknown incomplete tools", () => {
  assert.equal(
    buildRecoveredAssistantMessageForIncompleteClientTools({
      id: "user-message",
      role: "user",
      parts: [{ type: "text", text: "hello" }],
    }),
    undefined
  );
  assert.equal(
    buildRecoveredAssistantMessageForIncompleteClientTools(
      pendingClientToolMessage("tool-notWhitelisted")
    ),
    undefined
  );
});
