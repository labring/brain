import assert from "node:assert/strict";
import { test } from "node:test";

import { API_ROUTES } from "../constants";
import {
  buildNotificationCRListRequest,
  buildNotificationCRReadRequest,
  notificationCRReadPath,
} from "./use-notification-crs";

const KUBECONFIG = "apiVersion: v1\nclusters: []";
const AUTHORIZATION = "Bearer apiVersion%3A%20v1%0Aclusters%3A%20%5B%5D";

test("the list request reads the namespace's Notification CRs with the kubeconfig bearer", () => {
  const got = buildNotificationCRListRequest({
    kubeconfig: KUBECONFIG,
    namespace: "ns-a",
  });

  assert.equal(got.method, "GET");
  assert.equal(got.path, API_ROUTES.notification.root);
  assert.deepEqual(got.query, { namespace: "ns-a" });
  assert.deepEqual(got.header, { Authorization: AUTHORIZATION });
});

test("the mark-read request patches one CR by name", () => {
  const got = buildNotificationCRReadRequest({
    kubeconfig: KUBECONFIG,
    name: "debt-choice-debtperiod",
    namespace: "ns-a",
  });

  assert.equal(got.method, "PATCH");
  assert.equal(
    got.path,
    "/api/notification/v1alpha1/debt-choice-debtperiod/read"
  );
  assert.deepEqual(got.query, { namespace: "ns-a" });
  assert.deepEqual(got.header, { Authorization: AUTHORIZATION });
});

test("CR names are path-encoded", () => {
  assert.equal(
    notificationCRReadPath("weird/name"),
    "/api/notification/v1alpha1/weird%2Fname/read"
  );
});
