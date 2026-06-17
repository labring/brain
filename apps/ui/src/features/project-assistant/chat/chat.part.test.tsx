import assert from "node:assert/strict";
import { test } from "node:test";
import type { UIMessage } from "ai";
import { renderToStaticMarkup } from "react-dom/server";

import { renderChatMessageParts } from "./chat.part";

const DEPLOY_TASK_CARD_RE = /data-slot="chat-deploy-task-card"/;
const DATABASE_DEPLOY_RE = /Database Deploy/;
const POSTGRESQL_RE = /PostgreSQL/;
const DEMO_PROJECT_RE = /Demo Project/;
const DATABASE_PLAN_EVENT_RE = /Prepared database deployment plan\./;
const TEXT_FALLBACK_RE = /Deployment task task-1 was created\./;

test("chat renders generic deployment task cards for non-GitHub sources", () => {
  const message: UIMessage = {
    id: "deploy-task-created-task-1",
    role: "assistant",
    parts: [
      {
        type: "data-deploy-task",
        data: {
          events: [
            {
              message: "Prepared database deployment plan.",
              phase: "plan",
              seq: 1,
            },
          ],
          projectName: "Demo Project",
          sourceKind: "database",
          sourceLabel: "PostgreSQL",
          status: "running",
          taskId: "task-1",
        },
      },
      {
        type: "text",
        text: "Deployment task task-1 was created.",
      },
    ],
  };

  const html = renderToStaticMarkup(renderChatMessageParts({ message }));

  assert.match(html, DEPLOY_TASK_CARD_RE);
  assert.match(html, DATABASE_DEPLOY_RE);
  assert.match(html, POSTGRESQL_RE);
  assert.match(html, DEMO_PROJECT_RE);
  assert.match(html, DATABASE_PLAN_EVENT_RE);
  assert.doesNotMatch(html, TEXT_FALLBACK_RE);
});
