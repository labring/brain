import assert from "node:assert/strict";
import { test } from "node:test";

import { API_ROUTES } from "../constants";
import { buildWorkloadLogsRequest } from "./use-workload-logs";

test("workload logs request maps target and window to telemetry logs query", () => {
  const got = buildWorkloadLogsRequest({
    kubeconfig: "apiVersion: v1\nclusters: []",
    limit: 250,
    search: "error",
    target: { kind: "db", name: "postgres", namespace: "project-a" },
    window: {
      end: new Date("2026-05-18T01:00:00.500Z"),
      start: new Date("2026-05-18T00:00:00.500Z"),
    },
  });

  assert.equal(got.method, "GET");
  assert.equal(got.path, API_ROUTES.telemetry.logs);
  assert.deepEqual(got.header, {
    Authorization: "Bearer apiVersion%3A%20v1%0Aclusters%3A%20%5B%5D",
  });
  assert.deepEqual(got.query, {
    container: undefined,
    end: 1_779_066_000,
    kind: "db",
    limit: 250,
    name: "postgres",
    namespace: "project-a",
    search: "error",
    start: 1_779_062_400,
  });
});

test("workload logs request includes container when provided", () => {
  const got = buildWorkloadLogsRequest({
    container: "api",
    kubeconfig: "kubeconfig",
    target: { kind: "ap", name: "web", namespace: "project-a" },
    window: {
      end: new Date("2026-05-18T01:00:00.000Z"),
      start: new Date("2026-05-18T00:00:00.000Z"),
    },
  });

  assert.equal(got.query?.container, "api");
  assert.equal(got.query?.kind, "ap");
  assert.equal(got.query?.name, "web");
});
