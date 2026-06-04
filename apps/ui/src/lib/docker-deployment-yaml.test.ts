import assert from "node:assert/strict";
import { test } from "node:test";
import YAML from "yaml";

import { renderDockerDeploymentYaml } from "./docker-deployment-yaml";

const PLATFORM_ADDRESS_ID_RE = /^pa_[a-z0-9]{6,32}$/;
const PLATFORM_ADDRESS_DOMAIN_PREFIX_RE = /^[a-z]{6}$/;

test("renderDockerDeploymentYaml writes Docker settings into a direct AP manifest", () => {
  const out = YAML.parse(
    renderDockerDeploymentYaml({
      name: "project-a-api",
      namespace: "ns-admin",
      platformAddressId: "pa_abc123",
      projectName: "project-a",
      routingDomain: "apps.example.com",
      settings: {
        appListeningPort: 8080,
        env: [
          { name: "DATABASE_URL", value: "postgres://db:5432/app" },
          { name: "FEATURE_FLAG", value: "true" },
        ],
        image: "ghcr.io/acme/api:1.2",
      },
    })
  );

  assert.equal(out.apiVersion, "brain.io/direct");
  assert.equal(out.kind, "AP");
  assert.equal(out.metadata.name, "project-a-api");
  assert.equal(out.metadata.namespace, "ns-admin");
  assert.equal(out.metadata.labels.region, "apps.example.com");
  assert.equal(out.spec.name, "project-a-api");
  assert.equal(out.spec.projectId, "project-a");
  assert.equal(out.spec.projectName, undefined);
  assert.equal(out.spec.legacyRuntime, undefined);
  assert.equal(out.spec.input.image, "ghcr.io/acme/api:1.2");
  assert.deepEqual(out.spec.input.env, [
    { name: "DATABASE_URL", value: "postgres://db:5432/app" },
    { name: "FEATURE_FLAG", value: "true" },
  ]);
  assert.equal(out.spec.input.network.privatePort, 8080);
  assert.equal(out.spec.input.network.platformAddresses[0].id, "pa_abc123");
  assert.match(
    out.spec.input.network.platformAddresses[0].domainPrefix,
    PLATFORM_ADDRESS_DOMAIN_PREFIX_RE
  );
  assert.equal(out.spec.input.network.platformAddresses[0].port, 8080);
  assert.equal(out.spec.resource, undefined);
});

test("renderDockerDeploymentYaml omits empty environment variables", () => {
  const out = YAML.parse(
    renderDockerDeploymentYaml({
      name: "project-a-web",
      namespace: "ns-admin",
      platformAddressId: "pa_abc123",
      projectName: "project-a",
      routingDomain: "apps.example.com",
      settings: {
        appListeningPort: 80,
        env: [],
        image: "nginx:latest",
      },
    })
  );

  assert.equal(out.spec.input.env, undefined);
});

test("renderDockerDeploymentYaml generates stable platform address ids", () => {
  const first = YAML.parse(
    renderDockerDeploymentYaml({
      name: "project-a-web",
      namespace: "ns-admin",
      projectName: "project-a",
      routingDomain: "apps.example.com",
      settings: {
        appListeningPort: 80,
        env: [],
        image: "nginx:latest",
      },
    })
  );
  const second = YAML.parse(
    renderDockerDeploymentYaml({
      name: "project-a-web",
      namespace: "ns-admin",
      projectName: "project-a",
      routingDomain: "apps.example.com",
      settings: {
        appListeningPort: 80,
        env: [],
        image: "nginx:latest",
      },
    })
  );

  const id = first.spec.input.network.platformAddresses[0].id;
  const domainPrefix =
    first.spec.input.network.platformAddresses[0].domainPrefix;
  assert.match(id, PLATFORM_ADDRESS_ID_RE);
  assert.match(domainPrefix, PLATFORM_ADDRESS_DOMAIN_PREFIX_RE);
  assert.equal(second.spec.input.network.platformAddresses[0].id, id);
  assert.equal(
    second.spec.input.network.platformAddresses[0].domainPrefix,
    domainPrefix
  );
});

test("renderDockerDeploymentYaml resolves AP template placeholders before applying Docker settings", () => {
  const out = YAML.parse(
    renderDockerDeploymentYaml({
      name: "project-a-api",
      namespace: "ns-admin",
      platformAddressId: "pa_abc123",
      projectName: "project-a",
      routingDomain: "apps.example.com",
      settings: {
        appListeningPort: 3000,
        env: [],
        image: "ghcr.io/acme/api:1.2",
      },
      template: `
apiVersion: brain.io/direct
kind: AP
metadata:
  name: {{ name }}
  namespace: {{ namespace }}
  labels:
    app.kubernetes.io/name: {{ name }}
    region: old.example.com
spec:
  legacyRuntime:
    composition: old
  input:
    image: old-image
    network:
      privatePort: 80
  resource:
    requests:
      cpu: 100m
`,
    })
  );

  assert.equal(out.metadata.name, "project-a-api");
  assert.equal(out.metadata.namespace, "ns-admin");
  assert.equal(out.metadata.labels["app.kubernetes.io/name"], "project-a-api");
  assert.equal(out.metadata.labels.region, "apps.example.com");
  assert.equal(out.spec.input.image, "ghcr.io/acme/api:1.2");
  assert.equal(out.spec.input.network.privatePort, 3000);
  assert.equal(out.spec.input.network.platformAddresses[0].id, "pa_abc123");
  assert.match(
    out.spec.input.network.platformAddresses[0].domainPrefix,
    PLATFORM_ADDRESS_DOMAIN_PREFIX_RE
  );
  assert.equal(out.spec.input.network.platformAddresses[0].port, 3000);
  assert.deepEqual(out.spec.resource, { requests: { cpu: "100m" } });
  assert.equal(out.spec.legacyRuntime, undefined);
});

test("renderDockerDeploymentYaml removes template routing domain when none is provided", () => {
  const out = YAML.parse(
    renderDockerDeploymentYaml({
      name: "project-a-api",
      namespace: "ns-admin",
      platformAddressId: "pa_abc123",
      projectName: "project-a",
      routingDomain: "",
      settings: {
        appListeningPort: 3000,
        env: [],
        image: "ghcr.io/acme/api:1.2",
      },
      template: `
apiVersion: brain.io/direct
kind: AP
metadata:
  name: {{ name }}
  namespace: {{ namespace }}
  labels:
    app.kubernetes.io/name: {{ name }}
    region: old.example.com
spec:
  input:
    image: old-image
`,
    })
  );

  assert.equal(out.metadata.labels["app.kubernetes.io/name"], "project-a-api");
  assert.equal(out.metadata.labels.region, undefined);
  assert.equal(out.spec.input.network.platformAddresses[0].id, "pa_abc123");
  assert.match(
    out.spec.input.network.platformAddresses[0].domainPrefix,
    PLATFORM_ADDRESS_DOMAIN_PREFIX_RE
  );
  assert.equal(out.spec.input.network.platformAddresses[0].port, 3000);
});
