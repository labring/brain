import { describe, expect, it } from "bun:test";

import type { SelectedContextReference } from "./persistence/types";
import { resolveSelectedContextAvailability } from "./selected-context";

const PROJECT_ID = "project-a";
const reference: SelectedContextReference = {
  type: "resource",
  displayName: "Orders API",
  kind: "AP",
  name: "orders-api",
  namespace: "project-ns",
  observedUid: "uid-orders",
  projectId: PROJECT_ID,
};

const resolve = (
  candidate: SelectedContextReference,
  input: Omit<
    Parameters<typeof resolveSelectedContextAvailability>[1],
    "projectId"
  >
) =>
  resolveSelectedContextAvailability(candidate, {
    ...input,
    projectId: PROJECT_ID,
  });

describe("resolveSelectedContextAvailability", () => {
  it("reports a matching resource as available when its UID is unchanged", () => {
    expect(
      resolve(reference, {
        ready: true,
        resources: [
          {
            kind: "AP",
            name: "orders-api",
            namespace: "project-ns",
            observedUid: "uid-orders",
          },
        ],
      })
    ).toBe("available");
  });

  it("reports a recreated same-name resource as unavailable", () => {
    expect(
      resolve(reference, {
        ready: true,
        resources: [
          {
            kind: "AP",
            name: "orders-api",
            namespace: "project-ns",
            observedUid: "uid-recreated",
          },
        ],
      })
    ).toBe("unavailable");
  });

  it("does not guess availability for legacy references", () => {
    expect(
      resolve(
        { ...reference, observedUid: undefined },
        {
          ready: true,
          resources: [],
        }
      )
    ).toBe("unknown");
    expect(
      resolve(
        { ...reference, projectId: undefined },
        {
          ready: true,
          resources: [],
        }
      )
    ).toBe("unknown");
  });

  it("keeps availability unknown until the resource snapshot is ready", () => {
    expect(resolve(reference, { ready: false, resources: [] })).toBe("unknown");
  });

  it("does not interpret a cross-project reference as missing", () => {
    expect(
      resolveSelectedContextAvailability(reference, {
        projectId: "project-b",
        ready: true,
        resources: [],
      })
    ).toBe("unknown");
  });

  it("reports a missing same-project resource as unavailable", () => {
    expect(resolve(reference, { ready: true, resources: [] })).toBe(
      "unavailable"
    );
  });

  it("uses the AP identity for a Public Access reference", () => {
    const publicAccess: SelectedContextReference = {
      kind: "PublicAccess",
      name: "orders-api",
      namespace: "project-ns",
      observedUid: "uid-orders",
      projectId: PROJECT_ID,
      type: "resource",
    };
    expect(
      resolve(publicAccess, {
        ready: true,
        resources: [
          {
            kind: "PublicAccess",
            name: "orders-api",
            namespace: "project-ns",
            observedUid: "uid-orders",
          },
        ],
      })
    ).toBe("available");
  });
});
