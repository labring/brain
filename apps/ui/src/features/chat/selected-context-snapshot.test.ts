import { afterEach, describe, expect, it } from "bun:test";

import { publishResourceDisplayNames } from "@/features/resource-display-name/resource-display-name-bridge";
import {
  buildSelectedResourceSnapshot,
  observedUidForSelectedResource,
} from "./selected-context-snapshot";

afterEach(() => publishResourceDisplayNames([]));

describe("buildSelectedResourceSnapshot", () => {
  it("captures AP identity, project, UID, and display-only name", () => {
    publishResourceDisplayNames([
      { displayName: "Orders API", key: "AP:project-ns:orders-api" },
    ]);

    expect(
      buildSelectedResourceSnapshot({
        observedUid: "uid-orders",
        projectId: " project-a ",
        selected: {
          kind: "resource",
          target: { kind: "AP", name: "orders-api", namespace: "project-ns" },
        },
      })
    ).toEqual({
      displayName: "Orders API",
      kind: "AP",
      name: "orders-api",
      namespace: "project-ns",
      observedUid: "uid-orders",
      projectId: "project-a",
      type: "resource",
    });
  });

  it("captures DB identity", () => {
    expect(
      buildSelectedResourceSnapshot({
        observedUid: "uid-db",
        projectId: "project-a",
        selected: {
          kind: "resource",
          target: { kind: "DB", name: "orders-db", namespace: "project-ns" },
        },
      })
    ).toMatchObject({
      kind: "DB",
      name: "orders-db",
      observedUid: "uid-db",
      projectId: "project-a",
    });
  });

  it("uses the owning AP identity for Public Access", () => {
    expect(
      buildSelectedResourceSnapshot({
        observedUid: "uid-ap",
        projectId: "project-a",
        selected: {
          kind: "publicAddresses",
          target: {
            apName: "orders-api",
            kind: "PublicAccess",
            namespace: "project-ns",
          },
        },
      })
    ).toMatchObject({
      kind: "PublicAccess",
      name: "orders-api",
      observedUid: "uid-ap",
    });
  });

  it("returns null for no resource, an edge, or an empty project", () => {
    expect(
      buildSelectedResourceSnapshot({ projectId: "project-a", selected: null })
    ).toBeNull();
    expect(
      buildSelectedResourceSnapshot({
        projectId: "project-a",
        selected: { edgeId: "edge-a", kind: "edge" },
      })
    ).toBeNull();
    expect(
      buildSelectedResourceSnapshot({
        projectId: " ",
        selected: {
          kind: "resource",
          target: { kind: "AP", name: "orders-api", namespace: "project-ns" },
        },
      })
    ).toBeNull();
  });
});

it("prefers the current UID after same-name resource recreation", () => {
  expect(
    observedUidForSelectedResource({
      fallback: "old-uid",
      resources: [
        {
          kind: "AP",
          name: "api",
          namespace: "default",
          observedUid: "new-uid",
        },
      ],
      selected: {
        kind: "resource",
        target: {
          kind: "AP",
          name: "api",
          namespace: "default",
          observedUid: "old-uid",
        },
      },
    })
  ).toBe("new-uid");
});

it("keeps the URL UID when the selected resource has been deleted", () => {
  expect(
    observedUidForSelectedResource({
      fallback: "old-uid",
      resources: [],
      selected: {
        kind: "resource",
        target: {
          kind: "DB",
          name: "db",
          namespace: "default",
          observedUid: "old-uid",
        },
      },
    })
  ).toBe("old-uid");
});
