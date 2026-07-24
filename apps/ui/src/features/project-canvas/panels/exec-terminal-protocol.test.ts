import assert from "node:assert/strict";
import { test } from "node:test";

import { buildExecTerminalInitMessage } from "./exec-terminal-protocol";

test("AP terminal init sends an encoded kubeconfig credential", () => {
  assert.deepEqual(
    buildExecTerminalInitMessage({
      descriptor: {
        kind: "ap",
        name: "api",
        namespace: "ns-user",
      },
      rawKubeconfig: "token: abc+%2B%\nname: 用户",
    }),
    {
      kind: "ap",
      kubeconfig: "token%3A%20abc%2B%252B%25%0Aname%3A%20%E7%94%A8%E6%88%B7",
      name: "api",
      namespace: "ns-user",
      type: "init",
    }
  );
});

test("DB terminal init keeps its project ownership selector", () => {
  assert.deepEqual(
    buildExecTerminalInitMessage({
      descriptor: {
        kind: "db",
        name: "postgres",
        namespace: "ns-user",
        projectId: "project-1",
      },
      rawKubeconfig: "token: abc+%2B%\nname: 用户",
    }),
    {
      kind: "db",
      kubeconfig: "token%3A%20abc%2B%252B%25%0Aname%3A%20%E7%94%A8%E6%88%B7",
      name: "postgres",
      namespace: "ns-user",
      projectId: "project-1",
      type: "init",
    }
  );
});
