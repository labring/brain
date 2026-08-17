import { describe, expect, it } from "bun:test";

import {
  buildAtomicStdinWriteCommand,
  buildCodexMcpConfig,
  buildCodexMcpConfigWriteCommand,
  CODEX_MCP_TOKEN_ENV,
  MANAGED_INPUT_VALUES_MAX_BYTES,
  managedDeploymentCompletedInputSchema,
} from "./managed-deployment-contract";

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
