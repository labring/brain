import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CanvasDatabaseNodeData } from "@/features/project-canvas/nodes/types";
import { DatabaseSettingsPaneContent } from "./database-settings-pane";

const noop = () => {
  /* test noop */
};

const CONNECTION_ADDRESS_RE = /Connection Address/;
const PRIVATE_CONNECTION_RE = /Private Connection/;
const PUBLIC_CONNECTION_RE = /Public Connection/;
const MASKED_PRIVATE_CONNECTION_RE =
  /postgres:\/\/u\*\*\*\*\*\*\*:.*?@postgres.default.svc/;
const MASKED_PUBLIC_CONNECTION_RE =
  /postgres:\/\/u\*\*\*\*\*\*\*:.*?@db.example.com/;
const COPY_PRIVATE_CONNECTION_RE = /aria-label="Copy Private Connection"/;
const COPY_PUBLIC_CONNECTION_RE = /aria-label="Copy Public Connection"/;
const PUBLIC_CONNECTION_SWITCH_RE = /aria-label="Public connection"/;
const DISABLED_RE = /disabled=""/;
const UPDATE_BUTTON_RE = />Update</;
const DISCARD_BUTTON_RE = />Discard</;
const PROVISIONING_CONNECTION_RE = /Provisioning connection string/;
const REPLICA_COUNT_RE = /Number of Replicas/;
const REPLICA_VALUE_RE = />2</;
const NUMERIC_REPLICA_UNIT_VALUE_RE = />\d+ Replicas?</;
const PRIVATE_DSN_RE = /mysql:\/\/r\*\*\*\*\*\*\*:.*?@db.default.svc:3306/;
const PUBLIC_DSN_RE =
  /mysql:\/\/r\*\*\*\*\*\*\*:.*?@192.168.10.189.nip.io:45211/;
const INVISIBLE_UNSAVED_CHANGES_RE =
  /<p class="[^"]*\binvisible\b[^"]*">Unsaved configuration changes\.<\/p>/;

const PRIVATE_CONNECTION = {
  id: "private",
  kind: "private",
  label: "Private connection",
  value: "postgres://user:secret@postgres.default.svc:5432/app",
} satisfies CanvasDatabaseNodeData["connections"][number];

const PUBLIC_CONNECTION = {
  id: "public",
  kind: "public",
  label: "Public connection",
  publicAccess: { enabled: true },
  value: "postgres://user:secret@db.example.com:30432/app",
} satisfies CanvasDatabaseNodeData["connections"][number];

const BASE_DATA = {
  connections: [PRIVATE_CONNECTION, PUBLIC_CONNECTION],
  desired: {
    cpuLimit: "1",
    exposeNodePort: true,
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
} satisfies CanvasDatabaseNodeData;

function renderPane(
  element: ReactElement = (
    <DatabaseSettingsPaneContent
      data={BASE_DATA}
      onClose={noop}
      onSubmitPatch={noop}
    />
  )
): string {
  return renderToStaticMarkup(element);
}

test("database settings pane renders copyable connection address rows", () => {
  const html = renderPane();

  assert.match(html, CONNECTION_ADDRESS_RE);
  assert.match(html, PRIVATE_CONNECTION_RE);
  assert.match(html, PUBLIC_CONNECTION_RE);
  assert.match(html, MASKED_PRIVATE_CONNECTION_RE);
  assert.match(html, MASKED_PUBLIC_CONNECTION_RE);
  assert.match(html, COPY_PRIVATE_CONNECTION_RE);
  assert.match(html, COPY_PUBLIC_CONNECTION_RE);
});

test("database settings pane renders shared draft actions", () => {
  const html = renderPane();

  assert.match(html, UPDATE_BUTTON_RE);
  assert.match(html, DISCARD_BUTTON_RE);
});

test("database settings pane does not show unsaved changes for region repair only", () => {
  const html = renderPane(
    <DatabaseSettingsPaneContent
      data={{
        ...BASE_DATA,
        metadata: { labels: { "brain.io/project-id": "project" } },
      }}
      onClose={noop}
      onSubmitPatch={noop}
      routingDomain="192.168.12.53.nip.io"
    />
  );

  assert.match(html, INVISIBLE_UNSAVED_CHANGES_RE);
});

test("database settings pane renders replica counts without unit suffix", () => {
  const html = renderPane();

  assert.match(html, REPLICA_COUNT_RE);
  assert.match(html, REPLICA_VALUE_RE);
  assert.doesNotMatch(html, NUMERIC_REPLICA_UNIT_VALUE_RE);
});

test("database settings pane hides unprovisioned public address while public access is off", () => {
  const html = renderPane(
    <DatabaseSettingsPaneContent
      data={{
        ...BASE_DATA,
        connections: [
          PRIVATE_CONNECTION,
          {
            id: "public",
            kind: "public",
            label: "Public connection",
            publicAccess: { enabled: false },
          },
        ],
        desired: { ...BASE_DATA.desired, exposeNodePort: false },
      }}
      onClose={noop}
      onSubmitPatch={noop}
    />
  );

  assert.match(html, CONNECTION_ADDRESS_RE);
  assert.match(html, PRIVATE_CONNECTION_RE);
  assert.doesNotMatch(html, PROVISIONING_CONNECTION_RE);
  assert.doesNotMatch(html, COPY_PUBLIC_CONNECTION_RE);
});

test("database settings pane shows pending public connection text while public access is on", () => {
  const html = renderPane(
    <DatabaseSettingsPaneContent
      data={{
        ...BASE_DATA,
        connections: [
          PRIVATE_CONNECTION,
          {
            id: "public",
            kind: "public",
            label: "Public connection",
            publicAccess: { enabled: true },
          },
        ],
        desired: { ...BASE_DATA.desired, exposeNodePort: true },
      }}
      onClose={noop}
      onSubmitPatch={noop}
    />
  );

  assert.match(html, PUBLIC_CONNECTION_RE);
  assert.match(html, PROVISIONING_CONNECTION_RE);
  assert.doesNotMatch(html, COPY_PUBLIC_CONNECTION_RE);
});

test("database settings pane renders private and public DSNs", () => {
  const html = renderPane(
    <DatabaseSettingsPaneContent
      data={{
        ...BASE_DATA,
        connections: [
          {
            id: "private",
            kind: "private",
            label: "Private connection",
            value: "mysql://root:secret@db.default.svc:3306/mydb",
          },
          {
            id: "public",
            kind: "public",
            label: "Public connection",
            publicAccess: { enabled: true },
            value: "mysql://root:secret@192.168.10.189.nip.io:45211/mydb",
          },
        ],
      }}
      onClose={noop}
      onSubmitPatch={noop}
    />
  );

  assert.match(html, PRIVATE_DSN_RE);
  assert.match(html, PUBLIC_DSN_RE);
  assert.match(html, COPY_PRIVATE_CONNECTION_RE);
  assert.match(html, COPY_PUBLIC_CONNECTION_RE);
});

test("read-only database settings pane renders addresses without mutation controls", () => {
  const html = renderPane(
    <DatabaseSettingsPaneContent
      data={{
        ...BASE_DATA,
        settingsAccess: { readOnly: true },
      }}
      onClose={noop}
      onSubmitPatch={noop}
    />
  );

  assert.match(html, CONNECTION_ADDRESS_RE);
  assert.match(html, COPY_PRIVATE_CONNECTION_RE);
  assert.match(html, COPY_PUBLIC_CONNECTION_RE);
  assert.match(html, PUBLIC_CONNECTION_SWITCH_RE);
  assert.match(html, DISABLED_RE);
  assert.doesNotMatch(html, UPDATE_BUTTON_RE);
  assert.doesNotMatch(html, DISCARD_BUTTON_RE);
});
