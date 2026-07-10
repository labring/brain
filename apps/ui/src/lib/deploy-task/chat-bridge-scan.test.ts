import assert from "node:assert/strict";
import { test } from "node:test";

import type { UIMessage } from "ai";

import { scanMessagesForDeployTaskCreations } from "./chat-bridge-scan";

type Part = UIMessage["parts"][number];

function createDeployTaskToolPart(
  taskId: string,
  projectId: string,
  state = "output-available"
): Part {
  return {
    output: { ok: true, task: { id: taskId, projectId } },
    state,
    toolCallId: `call-${taskId}`,
    type: "tool-createDeployTask",
  } as unknown as Part;
}

function textPart(text: string): Part {
  return { text, type: "text" } as Part;
}

function message(id: string, parts: Part[]): UIMessage {
  return { id, parts, role: "assistant" } as UIMessage;
}

test("first scan (empty cursor) collects details from all messages and records parts counts", () => {
  const messages = [
    message("m1", [textPart("hi")]),
    message("m2", [
      textPart("deploying"),
      createDeployTaskToolPart("task-a", "project-1"),
    ]),
  ];

  const scan = scanMessagesForDeployTaskCreations({
    messages,
    projectId: "project-1",
    scannedParts: new Map(),
    seenTaskIds: new Set(),
  });

  assert.deepEqual(scan.details, [
    { projectId: "project-1", taskId: "task-a" },
  ]);
  assert.equal(scan.scannedParts.get("m1"), 1);
  assert.equal(scan.scannedParts.get("m2"), 2);
});

test("parts covered by the cursor are not re-reported, even with empty seenTaskIds", () => {
  const messages = [
    message("m1", [
      textPart("deploying"),
      createDeployTaskToolPart("task-a", "project-1"),
    ]),
  ];

  const scan = scanMessagesForDeployTaskCreations({
    messages,
    projectId: "project-1",
    scannedParts: new Map([["m1", 2]]),
    seenTaskIds: new Set(),
  });

  assert.deepEqual(scan.details, []);
  assert.equal(scan.scannedParts.get("m1"), 2);
});

test("task ids in seenTaskIds are excluded, and a task id repeated within one pass is reported once", () => {
  const messages = [
    message("m1", [
      createDeployTaskToolPart("task-seen", "project-1"),
      createDeployTaskToolPart("task-new", "project-1"),
      createDeployTaskToolPart("task-new", "project-1"),
    ]),
  ];

  const scan = scanMessagesForDeployTaskCreations({
    messages,
    projectId: "project-1",
    scannedParts: new Map(),
    seenTaskIds: new Set(["task-seen"]),
  });

  assert.deepEqual(scan.details, [
    { projectId: "project-1", taskId: "task-new" },
  ]);
});

test("creations for another project are excluded while the cursor still advances", () => {
  const messages = [
    message("m1", [createDeployTaskToolPart("task-a", "project-other")]),
  ];

  const scan = scanMessagesForDeployTaskCreations({
    messages,
    projectId: "project-1",
    scannedParts: new Map(),
    seenTaskIds: new Set(),
  });

  assert.deepEqual(scan.details, []);
  assert.equal(scan.scannedParts.get("m1"), 1);
});

test("a message with fewer parts than the cursor recorded is rescanned from the start", () => {
  const messages = [
    message("m1", [createDeployTaskToolPart("task-a", "project-1")]),
  ];

  const scan = scanMessagesForDeployTaskCreations({
    messages,
    projectId: "project-1",
    scannedParts: new Map([["m1", 3]]),
    seenTaskIds: new Set(),
  });

  assert.deepEqual(scan.details, [
    { projectId: "project-1", taskId: "task-a" },
  ]);
  assert.equal(scan.scannedParts.get("m1"), 1);
});

test("streaming append: only parts past the cursor are examined and reported", () => {
  const first = scanMessagesForDeployTaskCreations({
    messages: [
      message("m1", [
        textPart("working"),
        createDeployTaskToolPart("task-a", "project-1"),
      ]),
    ],
    projectId: "project-1",
    scannedParts: new Map(),
    seenTaskIds: new Set(),
  });

  const second = scanMessagesForDeployTaskCreations({
    messages: [
      message("m1", [
        textPart("working"),
        createDeployTaskToolPart("task-a", "project-1"),
        createDeployTaskToolPart("task-b", "project-1"),
        textPart("done"),
      ]),
    ],
    projectId: "project-1",
    scannedParts: first.scannedParts,
    seenTaskIds: new Set(["task-a"]),
  });

  assert.deepEqual(second.details, [
    { projectId: "project-1", taskId: "task-b" },
  ]);
  assert.equal(second.scannedParts.get("m1"), 4);
});

test("a create tool part that settles in place (same parts length) is reported once it settles", () => {
  // The AI SDK appends tool parts in a pending state and later mutates the
  // same part to `output-available` without changing `parts.length`.
  const pending = [
    message("m1", [
      textPart("deploying"),
      createDeployTaskToolPart("task-a", "project-1", "approval-requested"),
    ]),
  ];
  const first = scanMessagesForDeployTaskCreations({
    messages: pending,
    projectId: "project-1",
    scannedParts: new Map(),
    seenTaskIds: new Set(),
  });
  assert.deepEqual(first.details, []);

  const settled = [
    message("m1", [
      textPart("deploying"),
      createDeployTaskToolPart("task-a", "project-1"),
    ]),
  ];
  const second = scanMessagesForDeployTaskCreations({
    messages: settled,
    projectId: "project-1",
    scannedParts: first.scannedParts,
    seenTaskIds: new Set(),
  });
  assert.deepEqual(second.details, [
    { projectId: "project-1", taskId: "task-a" },
  ]);
  assert.equal(second.scannedParts.get("m1"), 2);
});

test("the cursor never advances past the first unsettled create tool part", () => {
  const messages = [
    message("m1", [
      createDeployTaskToolPart("task-pending", "project-1", "input-streaming"),
      createDeployTaskToolPart("task-done", "project-1"),
      textPart("tail"),
    ]),
  ];
  const scan = scanMessagesForDeployTaskCreations({
    messages,
    projectId: "project-1",
    scannedParts: new Map(),
    seenTaskIds: new Set(),
  });
  // The settled creation past the pending part is still reported...
  assert.deepEqual(scan.details, [
    { projectId: "project-1", taskId: "task-done" },
  ]);
  // ...but the cursor parks before the pending part so its own settling
  // is observed by a later scan.
  assert.equal(scan.scannedParts.get("m1"), 0);
});

test("message ids absent from the current messages are dropped from the next cursor", () => {
  const scan = scanMessagesForDeployTaskCreations({
    messages: [message("m2", [textPart("new thread")])],
    projectId: "project-1",
    scannedParts: new Map([["m1", 5]]),
    seenTaskIds: new Set(),
  });

  assert.equal(scan.scannedParts.has("m1"), false);
  assert.equal(scan.scannedParts.get("m2"), 1);
});
