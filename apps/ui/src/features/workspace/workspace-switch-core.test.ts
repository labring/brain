import assert from "node:assert/strict";
import { test } from "node:test";

import {
  workspaceSwitchLanding,
  workspaceSwitchUrl,
} from "./workspace-switch-core";

// Spec §C.6: the Billing Area and the Workspace Area keep their page across
// a switch; anywhere else lands on the Project list.
test("a Billing Area page keeps its path and query across the switch", () => {
  assert.equal(
    workspaceSwitchLanding({ pathname: "/billing", search: "?mode=upgrade" }),
    "/billing?mode=upgrade"
  );
  assert.equal(
    workspaceSwitchLanding({ pathname: "/billing/costs", search: "" }),
    "/billing/costs"
  );
});

test("a Workspace Area page keeps its path across the switch", () => {
  assert.equal(
    workspaceSwitchLanding({ pathname: "/workspace/uid-1", search: "" }),
    "/workspace/uid-1"
  );
});

test("everywhere else lands on the Project list", () => {
  assert.equal(
    workspaceSwitchLanding({ pathname: "/project/alpha", search: "?pane=x" }),
    "/project"
  );
  assert.equal(
    workspaceSwitchLanding({ pathname: "/", search: "" }),
    "/project"
  );
  // A prefix match is not an area match.
  assert.equal(
    workspaceSwitchLanding({ pathname: "/billingx", search: "" }),
    "/project"
  );
});

test("the Desktop deep link encodes the openapp value once and names the Workspace", () => {
  assert.equal(
    workspaceSwitchUrl({
      cloudDomain: "cloud.example.test",
      landing: "/billing?mode=upgrade",
      workspaceUid: "22222222-2222-4222-8222-222222222222",
    }),
    "https://cloud.example.test/?openapp=system-brain%3F%2Fbilling%3Fmode%3Dupgrade&workspaceUid=22222222-2222-4222-8222-222222222222"
  );
});

// Desktop's grammar is `appkey?<path>?<query>`: a landing without a query
// still writes the second `?`, or Desktop reads the path as the app query.
test("the deep link keeps an explicit scheme, trims slashes, and is null without a domain", () => {
  assert.equal(
    workspaceSwitchUrl({
      cloudDomain: "http://cloud.example.test///",
      landing: "/project",
      workspaceUid: "u",
    }),
    "http://cloud.example.test/?openapp=system-brain%3F%2Fproject%3F&workspaceUid=u"
  );
  assert.equal(
    workspaceSwitchUrl({
      cloudDomain: "  ",
      landing: "/project",
      workspaceUid: "u",
    }),
    null
  );
});
