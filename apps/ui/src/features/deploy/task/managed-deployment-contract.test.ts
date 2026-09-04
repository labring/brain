import { describe, expect, it } from "bun:test";

import {
  buildAtomicStdinWriteCommand,
  buildCodexMcpConfig,
  buildCodexMcpConfigWriteCommand,
  buildManagedDeploymentLabelsFile,
  buildManagedDeploymentLabelsWriteCommand,
  CODEX_MCP_TOKEN_ENV,
  MANAGED_DEPLOYMENT_LABELS_MAX_BYTES,
  MANAGED_DEPLOYMENT_LABELS_PATH,
  MANAGED_INPUT_VALUES_MAX_BYTES,
  managedDeploymentCompletedInputSchema,
  managedDeploymentRegionEnv,
} from "./managed-deployment-contract";

function kubeconfigWithServer(server: string): string {
  return [
    "apiVersion: v1",
    "current-context: ctx",
    "clusters:",
    "  - name: cluster",
    "    cluster:",
    `      server: ${server}`,
    "contexts:",
    "  - name: ctx",
    "    context:",
    "      cluster: cluster",
  ].join("\n");
}

describe("managed deployment atomic input write", () => {
  it("writes sensitive JSON from stdin without embedding it in the command", () => {
    const command = buildAtomicStdinWriteCommand({
      allowedRoot: "/run/sealai/deployment",
      maxBytes: MANAGED_INPUT_VALUES_MAX_BYTES,
      path: "/run/sealai/deployment/inputs.json",
    });

    expect(command).toContain('cat > "$tmp"');
    expect(command).toContain(`-le ${MANAGED_INPUT_VALUES_MAX_BYTES}`);
    expect(command).toContain("umask 077");
    expect(command).toContain("mktemp");
    expect(command).toContain("mv -f");
    expect(command).toContain('chown devbox:devbox "$target_dir" "$target"');
    expect(command).not.toContain("DATABASE_PASSWORD");
  });

  it("rejects non-normalized target paths", () => {
    expect(() =>
      buildAtomicStdinWriteCommand({
        allowedRoot: "/run/sealai/deployment",
        maxBytes: MANAGED_INPUT_VALUES_MAX_BYTES,
        path: "/run/sealai/deployment/../secret.json",
      })
    ).toThrow("normalized absolute path");
  });

  it("limits atomic writes to their declared roots", () => {
    expect(() =>
      buildAtomicStdinWriteCommand({
        allowedRoot: "/run/sealai/deployment",
        maxBytes: MANAGED_INPUT_VALUES_MAX_BYTES,
        path: "/home/devbox/project/other.json",
      })
    ).toThrow("allowed root");
  });

  it("rejects non-positive byte limits", () => {
    expect(() =>
      buildAtomicStdinWriteCommand({
        allowedRoot: "/run/sealai/deployment",
        maxBytes: 0,
        path: "/run/sealai/deployment/inputs.json",
      })
    ).toThrow("positive integer");
  });
});

describe("managed deployment labels file", () => {
  const labels = {
    "brain.io/managed-by": "brain",
    "brain.io/project-id": "project-1",
    "brain.io/deployment-kind": "template",
  };

  it("serializes labels as newline-terminated JSON that round-trips", () => {
    const contents = buildManagedDeploymentLabelsFile(labels);

    expect(contents.endsWith("\n")).toBe(true);
    expect(JSON.parse(contents)).toEqual(labels);
  });

  it("rejects empty label sets", () => {
    expect(() => buildManagedDeploymentLabelsFile({})).toThrow(
      "must not be empty"
    );
  });

  it("rejects label sets over the byte limit", () => {
    expect(() =>
      buildManagedDeploymentLabelsFile({
        big: "x".repeat(MANAGED_DEPLOYMENT_LABELS_MAX_BYTES),
      })
    ).toThrow("exceed their byte limit");
  });

  it("writes the labels file atomically under the fixed input root", () => {
    const command = buildManagedDeploymentLabelsWriteCommand();

    expect(MANAGED_DEPLOYMENT_LABELS_PATH).toBe(
      "/run/sealai/deployment/labels.json"
    );
    expect(command).toContain('cat > "$tmp"');
    expect(command).toContain("/run/sealai/deployment/labels.json");
    expect(command).toContain(`-le ${MANAGED_DEPLOYMENT_LABELS_MAX_BYTES}`);
    expect(command).toContain("chmod 0600");
    expect(command).not.toContain("brain.io");
    expect(command).not.toContain("project-1");
  });
});

describe("managed deployment region env", () => {
  it("derives the region and Template API URL from the kubeconfig server host", () => {
    expect(
      managedDeploymentRegionEnv(
        kubeconfigWithServer("https://usw-1.sealos.io:6443")
      )
    ).toEqual({
      SEALOS_REGION: "https://usw-1.sealos.io",
      SEALAI_TEMPLATE_API_URL: "https://template.usw-1.sealos.io",
    });
  });

  it("yields no region for in-cluster kubeconfig servers", () => {
    expect(
      managedDeploymentRegionEnv(
        kubeconfigWithServer("https://kubernetes.default.svc")
      )
    ).toEqual({});
    expect(
      managedDeploymentRegionEnv(
        kubeconfigWithServer("https://kubernetes.default.svc.cluster.local:443")
      )
    ).toEqual({});
  });

  it("returns no env for empty or invalid kubeconfigs", () => {
    expect(managedDeploymentRegionEnv("")).toEqual({});
    expect(managedDeploymentRegionEnv("   ")).toEqual({});
    expect(managedDeploymentRegionEnv("not: [valid")).toEqual({});
    expect(managedDeploymentRegionEnv("apiVersion: v1\nclusters: []")).toEqual(
      {}
    );
  });
});

describe("Codex MCP runtime config", () => {
  it("uses the task endpoint and env-backed token without persisting the token", () => {
    const config = buildCodexMcpConfig({
      url: "https://brain.example.com/api/deploy-agent/mcp/v1",
    });

    expect(config).toContain(
      'url = "https://brain.example.com/api/deploy-agent/mcp/v1"'
    );
    expect(config).toContain(`bearer_token_env_var = "${CODEX_MCP_TOKEN_ENV}"`);
    expect(config).toContain(
      'enabled_tools = ["template_ready", "deployment_completed"]'
    );
    expect(config).not.toContain("token-value");
  });

  it("rejects non-http MCP endpoints", () => {
    expect(() => buildCodexMcpConfig({ url: "file:///tmp/mcp" })).toThrow(
      "absolute http(s) URL"
    );
  });

  it("writes the Codex config atomically under the Codex home", () => {
    const command = buildCodexMcpConfigWriteCommand();

    expect(command).toContain('cat > "$tmp"');
    expect(command).toContain("/codex-home/config.toml");
    expect(command).toContain("-le 16384");
    expect(command).toContain("chmod 0600");
  });
});

describe("managed deployment completed input", () => {
  const workload = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    name: "demo",
    namespace: "tenant-a",
  };

  it("accepts an optional http(s) publicUrl", () => {
    expect(
      managedDeploymentCompletedInputSchema.safeParse({
        publicUrl: "https://demo.tenant-a.sealos.io",
        workloads: [workload],
      }).success
    ).toBe(true);
    expect(
      managedDeploymentCompletedInputSchema.safeParse({
        workloads: [workload],
      }).success
    ).toBe(true);
  });

  it("rejects a non-http publicUrl", () => {
    expect(
      managedDeploymentCompletedInputSchema.safeParse({
        publicUrl: "ftp://demo.example",
        workloads: [workload],
      }).success
    ).toBe(false);
    expect(
      managedDeploymentCompletedInputSchema.safeParse({
        publicUrl: "not-a-url",
        workloads: [workload],
      }).success
    ).toBe(false);
  });
});
