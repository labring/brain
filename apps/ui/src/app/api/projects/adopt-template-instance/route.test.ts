import { mock } from "bun:test";
import assert from "node:assert/strict";
import { test } from "node:test";

const HEADER_WHITESPACE_RE = /\s+/;

class TemplateInstanceAdoptionError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TemplateInstanceAdoptionError";
    this.status = status;
  }
}

interface AdoptInput {
  instanceName: string;
  namespace: string;
}

interface AdoptResult {
  adoption: {
    discoveredCount: number;
    instanceName: string;
    instanceUid: string;
    labeledCount: number;
    status: "adopted";
    warnings: string[];
  };
  project: {
    createdAt: string;
    description: string;
    displayName: string;
    id: string;
    namespace: string;
    updatedAt: string;
  };
}

const adopt: { impl: (input: AdoptInput) => Promise<AdoptResult> } = {
  impl: () => Promise.reject(new Error("adoptTemplateInstance is not stubbed")),
};

mock.module("server-only", () => ({}));
mock.module("@/lib/project-persistence/adopt-template-instance", () => ({
  TemplateInstanceAdoptionError,
  adoptTemplateInstance: (input: AdoptInput) => adopt.impl(input),
}));
mock.module("@/lib/request-kubeconfig-auth", () => ({
  authorizeKubeconfigNamespace: (input: { encodedKubeconfig?: string }) => {
    const encodedKubeconfig = input.encodedKubeconfig ?? "";
    if (encodedKubeconfig === "") {
      return Promise.resolve({
        code: "authentication_required" as const,
        ok: false as const,
      });
    }
    if (encodedKubeconfig === "invalid-kc") {
      return Promise.resolve({
        code: "invalid_kubeconfig" as const,
        ok: false as const,
      });
    }
    if (encodedKubeconfig === "unresolved-kc") {
      return Promise.resolve({
        code: "namespace_unresolved" as const,
        ok: false as const,
      });
    }
    if (encodedKubeconfig === "forbidden-kc") {
      return Promise.resolve({
        code: "verification_failed" as const,
        message: "Kubeconfig is not authorized for this namespace.",
        ok: false as const,
        status: 403,
      });
    }
    return Promise.resolve({
      encodedKubeconfig,
      kubeconfig: "decoded",
      namespace: "ns-from-kubeconfig",
      ok: true as const,
    });
  },
  encodedKubeconfigFromRequest: (request: Request) => {
    const value = request.headers.get("authorization")?.trim() ?? "";
    const [scheme, ...rest] = value.split(HEADER_WHITESPACE_RE);
    if (scheme?.toLowerCase() !== "bearer") {
      return "";
    }
    return rest.join(" ").trim();
  },
}));

const { POST } = await import("./route");

function request(input: { body?: unknown; kubeconfig?: string }): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (input.kubeconfig !== undefined) {
    headers.set("Authorization", `Bearer ${input.kubeconfig}`);
  }
  return new Request(
    "https://brain.test/api/projects/adopt-template-instance",
    {
      body: JSON.stringify(input.body ?? { instanceName: "memos" }),
      headers,
      method: "POST",
    }
  );
}

test("missing kubeconfig is 401", async () => {
  const response = await POST(request({}) as never);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "Authentication is required.",
  });
});

test("invalid kubeconfig is 400", async () => {
  const response = await POST(request({ kubeconfig: "invalid-kc" }) as never);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid kubeconfig." });
});

test("unresolved kubeconfig namespace is 400", async () => {
  const response = await POST(
    request({ kubeconfig: "unresolved-kc" }) as never
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Could not resolve namespace from kubeconfig.",
  });
});

test("namespace authorization failure is 403", async () => {
  const response = await POST(request({ kubeconfig: "forbidden-kc" }) as never);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "Namespace is not accessible.",
  });
});

test("invalid body is 400", async () => {
  const response = await POST(request({ body: {}, kubeconfig: "ok" }) as never);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Invalid project request.",
  });
});

test("body namespace is ignored; kubeconfig namespace is used", async () => {
  let capturedNamespace = "";
  adopt.impl = (input) => {
    capturedNamespace = input.namespace;
    return Promise.resolve({
      adoption: {
        discoveredCount: 1,
        instanceName: input.instanceName,
        instanceUid: "uid-1",
        labeledCount: 1,
        status: "adopted",
        warnings: [],
      },
      project: {
        createdAt: "2026-01-01T00:00:00.000Z",
        description: "",
        displayName: "memos",
        id: "project-1",
        namespace: input.namespace,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
  };

  const response = await POST(
    request({
      body: {
        instanceName: "memos",
        namespace: "ns-from-body",
      },
      kubeconfig: "ok",
    }) as never
  );
  assert.equal(response.status, 200);
  assert.equal(capturedNamespace, "ns-from-kubeconfig");
  const payload = (await response.json()) as {
    adoption: { status: string };
    project: { id: string; namespace: string };
  };
  assert.equal(payload.adoption.status, "adopted");
  assert.equal(payload.project.namespace, "ns-from-kubeconfig");
});

test("adoption errors keep their status and { error } shape", async () => {
  adopt.impl = () =>
    Promise.reject(
      new TemplateInstanceAdoptionError(404, "Template instance not found.")
    );
  const response = await POST(request({ kubeconfig: "ok" }) as never);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Template instance not found.",
  });
});

test("unexpected persistence failures are 503", async () => {
  adopt.impl = () => Promise.reject(new Error("ECONNREFUSED"));
  const response = await POST(request({ kubeconfig: "ok" }) as never);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Project persistence is unavailable.",
  });
});
