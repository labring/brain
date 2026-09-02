import { describe, expect, it } from "bun:test";

import type { SelectedContextReference } from "./persistence/types";
import { resolveSelectedContextAvailability } from "./selected-context";

const reference: SelectedContextReference = {
  type: "resource",
  displayName: "Orders API",
  kind: "AP",
  name: "orders-api",
  namespace: "project-ns",
  observedUid: "uid-orders",
};

describe("resolveSelectedContextAvailability", () => {
  it("reports a matching resource as available when its UID is unchanged", () => {
    expect(
      resolveSelectedContextAvailability(reference, {
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
      resolveSelectedContextAvailability(reference, {
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

  it("does not guess availability for a legacy reference without a UID", () => {
    expect(
      resolveSelectedContextAvailability(
        { ...reference, observedUid: undefined },
        {
          ready: true,
          resources: [
            {
              kind: "AP",
              name: "orders-api",
              namespace: "project-ns",
              observedUid: "uid-orders",
            },
          ],
        }
      )
    ).toBe("unknown");
  });

  it("keeps availability unknown until the project resource snapshot is ready", () => {
    expect(
      resolveSelectedContextAvailability(reference, {
        ready: false,
        resources: [],
      })
    ).toBe("unknown");
  });

  it("reports a missing resource as unavailable after a ready snapshot", () => {
    expect(
      resolveSelectedContextAvailability(reference, {
        ready: true,
        resources: [],
      })
    ).toBe("unavailable");
  });
});
