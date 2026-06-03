import assert from "node:assert/strict";
import { test } from "node:test";
import YAML from "yaml";

import { renderDbDeploymentYaml } from "./db-deployment-yaml";

test("renderDbDeploymentYaml writes deployment settings into a direct DB manifest", () => {
  const out = YAML.parse(
    renderDbDeploymentYaml({
      compositionName: "dbs-mysql-kubeblocks-go-templating",
      engine: "mysql",
      name: "project-a-db",
      namespace: "ns-admin",
      projectName: "project-a",
      quota: "s",
      replicas: 2,
    })
  );

  assert.equal(out.apiVersion, "brain.io/direct");
  assert.equal(out.kind, "DB");
  assert.equal(out.metadata.name, "project-a-db");
  assert.equal(out.metadata.namespace, "ns-admin");
  assert.equal(out.spec.engine, "mysql");
  assert.equal(out.spec.quota, "s");
  assert.equal(out.spec.replicas, 2);
  assert.equal(out.spec.projectId, "project-a");
  assert.equal(out.spec.projectName, undefined);
  assert.equal(out.spec.exposeNodePort, false);
  assert.equal(out.spec.legacyRuntime, undefined);
});

test("renderDbDeploymentYaml strips public-only region labels from templates", () => {
  const out = YAML.parse(
    renderDbDeploymentYaml({
      compositionName: "dbs-postgresql-kubeblocks-go-templating",
      engine: "postgresql",
      name: "project-a-pg",
      namespace: "ns-admin",
      projectName: "project-a",
      quota: "xs",
      replicas: 12,
      template: `
apiVersion: brain.io/direct
kind: DB
metadata:
  name: template-name
  namespace: template-ns
  labels:
    region: 192.168.12.53.nip.io
    keep: yes
spec:
  legacyRuntime:
    composition: old
  engine: redis
  quota: l
`,
    })
  );

  assert.equal(out.metadata.name, "project-a-pg");
  assert.equal(out.metadata.namespace, "ns-admin");
  assert.equal(out.metadata.labels.region, undefined);
  assert.equal(out.metadata.labels.keep, "yes");
  assert.equal(out.spec.engine, "postgresql");
  assert.equal(out.spec.quota, "xs");
  assert.equal(out.spec.replicas, 10);
  assert.equal(out.spec.legacyRuntime, undefined);
});

test("renderDbDeploymentYaml resolves DB template placeholders before parsing", () => {
  const out = YAML.parse(
    renderDbDeploymentYaml({
      compositionName: "dbs-mysql-kubeblocks-go-templating",
      engine: "mysql",
      name: "project-a-mysql",
      namespace: "ns-admin",
      projectName: "project-a",
      quota: "m",
      replicas: 1,
      template: `
apiVersion: brain.io/direct
kind: DB
metadata:
  name: {{ name }}
  namespace: {{ namespace }}
  labels:
    app.kubernetes.io/name: {{ name }}
spec:
  legacyRuntime:
    composition: old
  engine: mysql
  quota: xs
`,
    })
  );

  assert.equal(out.metadata.name, "project-a-mysql");
  assert.equal(out.metadata.namespace, "ns-admin");
  assert.equal(
    out.metadata.labels["app.kubernetes.io/name"],
    "project-a-mysql"
  );
  assert.equal(out.spec.quota, "m");
});
