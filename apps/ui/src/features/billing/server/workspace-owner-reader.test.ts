import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));
const { readWorkspaceOwnerStanding } = await import("./workspace-owner-reader");

const NAMESPACE = {
  apiVersion: "v1",
  kind: "Namespace",
  metadata: {
    annotations: { "debt.sealos/status": "SuspendCompleted" },
    labels: { "user.sealos.io/owner": "alice" },
    name: "ns-alice",
  },
};

describe("readWorkspaceOwnerStanding", () => {
  let previousApiUrl: string | undefined;
  beforeEach(() => {
    previousApiUrl = process.env.API_URL;
    process.env.API_URL = "http://api.internal:9000";
  });
  afterEach(() => {
    process.env.API_URL = previousApiUrl;
  });

  it("gets the Namespace object with the request kubeconfig and judges it against the verified crName", async () => {
    let seen: { init: RequestInit; url: URL } | undefined;
    const standing = await readWorkspaceOwnerStanding(
      {
        crName: "bob",
        encodedKubeconfig: "encoded-kubeconfig",
        namespace: "ns-alice",
      },
      (url, init) => {
        seen = { init, url };
        return Promise.resolve(Response.json(NAMESPACE));
      }
    );
    expect(standing).toEqual({ isOwner: false, platformDebt: true });
    expect(seen?.url.pathname).toBe("/api/k8s/v1alpha1/get");
    expect(seen?.url.searchParams.get("kind")).toBe("namespaces");
    expect(seen?.url.searchParams.get("name")).toBe("ns-alice");
    expect(seen?.init.method).toBe("GET");
    expect((seen?.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer encoded-kubeconfig"
    );
  });

  it("lands a denied read in the unknown-owner branch, never an error", async () => {
    const standing = await readWorkspaceOwnerStanding(
      {
        crName: "alice",
        encodedKubeconfig: "encoded-kubeconfig",
        namespace: "ns-alice",
      },
      () =>
        Promise.resolve(
          Response.json({ code: 403, kind: "Status" }, { status: 403 })
        )
    );
    expect(standing).toEqual({ isOwner: null, platformDebt: null });
  });

  it("resolves unknown when the read throws or the API is not configured", async () => {
    expect(
      await readWorkspaceOwnerStanding(
        {
          crName: "alice",
          encodedKubeconfig: "encoded-kubeconfig",
          namespace: "ns-alice",
        },
        () => Promise.reject(new Error("api down"))
      )
    ).toEqual({ isOwner: null, platformDebt: null });

    process.env.API_URL = "";
    expect(
      await readWorkspaceOwnerStanding(
        {
          crName: "alice",
          encodedKubeconfig: "encoded-kubeconfig",
          namespace: "ns-alice",
        },
        () => Promise.resolve(Response.json(NAMESPACE))
      )
    ).toEqual({ isOwner: null, platformDebt: null });
  });
});
