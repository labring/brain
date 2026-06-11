import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type ContainerSettingsSectionsModel,
  useApSettingsSections,
} from "@/features/project-settings/ap/ap-settings-sections";
import {
  type DatabaseSettingsSectionsModel,
  useDatabaseSettingsSections,
} from "@/features/project-settings/db/db-settings-sections";
import type { DbSettingsData } from "@/features/project-settings/db/db-settings-types";
import { dbDataFromList } from "./settings-provider-db";

const noop = () => {
  /* test noop */
};

const SECTION_IDS_RE = /data-section-ids="([^"]*)"/;

const BASE_DB_DATA = {
  connections: [],
  desired: {
    cpuLimit: "1",
    exposeNodePort: false,
    memoryLimit: "2Gi",
    replicas: 2,
    storageSize: "20Gi",
  },
  states: {
    displayEngine: "PostgreSQL",
    name: "postgres",
    status: { label: "Running", tone: "running" },
  },
  workload: { name: "postgres", namespace: "default" },
} satisfies DbSettingsData;

function SectionIds({
  model,
}: {
  model: ContainerSettingsSectionsModel | DatabaseSettingsSectionsModel;
}) {
  return createElement(
    "output",
    {
      "data-section-ids": model.sections.map((section) => section.id).join(","),
    },
    model.footer == null ? "no-footer" : "has-footer"
  );
}

function ApSettingsSectionsHarness({
  sectionFocus,
}: {
  sectionFocus?: "all" | "environment";
}) {
  const model = useApSettingsSections({
    args: [],
    command: [],
    configMaps: [],
    cpuQuota: { onValueChange: noop, value: 1 },
    env: [],
    image: "ghcr.io/acme/api:1",
    memoryQuota: { onValueChange: noop, value: 512 },
    onEnvChange: noop,
    onImageChange: noop,
    readOnly: true,
    replicaStrategy: { fixed: { replicas: 2 }, type: "fixed" },
    replicasQuota: { onValueChange: noop, value: 2 },
    sectionFocus,
    showImageSection: false,
    storage: [],
    workloadKind: "deployment",
  });
  return createElement(SectionIds, { model });
}

function DbSettingsSectionsHarness() {
  const model = useDatabaseSettingsSections({
    data: BASE_DB_DATA,
    editable: false,
  });
  return createElement(SectionIds, { model });
}

function sectionIdsFromHtml(html: string): string[] {
  const match = html.match(SECTION_IDS_RE);
  return match?.[1] === "" || match?.[1] == null ? [] : match[1].split(",");
}

test("AP settings section model exposes provider-rendered sections", () => {
  const html = renderToStaticMarkup(createElement(ApSettingsSectionsHarness));

  assert.deepEqual(sectionIdsFromHtml(html), [
    "replica-strategy",
    "cpu-memory",
    "launch-command",
    "config-files",
    "environment",
  ]);
});

test("AP environment settings focus returns only the environment section", () => {
  const html = renderToStaticMarkup(
    createElement(ApSettingsSectionsHarness, { sectionFocus: "environment" })
  );

  assert.deepEqual(sectionIdsFromHtml(html), ["environment"]);
});

test("DB settings section model exposes provider-owned resource sections", () => {
  const html = renderToStaticMarkup(createElement(DbSettingsSectionsHarness));

  assert.deepEqual(sectionIdsFromHtml(html), [
    "resources",
    "storage",
    "connection-address",
  ]);
});

test("DB settings provider can resolve node data from target identity", () => {
  const data = dbDataFromList(
    {
      items: [
        {
          metadata: { name: "other", namespace: "default" },
          spec: { engine: "postgresql" },
        },
        {
          metadata: { name: "postgres", namespace: "default" },
          spec: { engine: "postgresql" },
          status: { phase: "Running" },
        },
      ],
    },
    { kind: "DB", name: "postgres", namespace: "default" }
  );

  assert.equal(data?.workload.name, "postgres");
  assert.equal(data?.workload.namespace, "default");
  assert.equal(data?.states.displayEngine, "PostgreSQL");
});
