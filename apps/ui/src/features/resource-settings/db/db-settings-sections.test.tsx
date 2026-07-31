import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@testing-library/react/pure";
import { DATABASE_CONNECTION_MASK } from "@workspace/ui/components/database-node/database-node";
import { SidePane } from "@workspace/ui/components/side-pane";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
} from "@/features/project-canvas/react-test-harness";
import type { DbSettingsData } from "@/features/resource-settings/db/db-settings-types";
import { createPendingSettingsStore } from "@/features/resource-settings/pending-settings-updates";
import { DatabaseSettingsPaneContent } from "./db-settings-sections";

const noop = () => {
  /* test noop */
};

const CONNECTION_ADDRESS_RE = /Connection Address/;
const PRIVATE_CONNECTION_RE = /Private Connection/;
const PUBLIC_CONNECTION_RE = /Public Connection/;
// Derived from the mask itself: a hard-coded width silently went stale when
// the constant changed, which is what this assertion exists to catch.
const FIXED_CONNECTION_MASK_RE = new RegExp(
  `>\\*{${DATABASE_CONNECTION_MASK.length}}<`,
  "g"
);
const PRIVATE_CONNECTION_TEMPLATE_RE =
  /postgres:\/\/&lt;username&gt;:&lt;password&gt;@postgres.default.svc:5432\/app/;
const PUBLIC_CONNECTION_TEMPLATE_RE =
  /postgres:\/\/&lt;username&gt;:&lt;password&gt;@db.example.com:30432\/app/;
const COPY_PRIVATE_CONNECTION_RE = /aria-label="Copy Private Connection"/;
const COPY_PUBLIC_CONNECTION_RE = /aria-label="Copy Public Connection"/;
const REVEAL_PRIVATE_CONNECTION_RE = /aria-label="Reveal Private Connection"/;
const REVEAL_PUBLIC_CONNECTION_RE = /aria-label="Reveal Public Connection"/;
const PUBLIC_CONNECTION_SWITCH_RE = /aria-label="Public connection"/;
const DISABLED_RE = /disabled=""/;
const UPDATE_BUTTON_RE = />Update</;
const DISCARD_BUTTON_RE = />Discard</;
const PROVISIONING_CONNECTION_RE = /Provisioning connection string/;
const REPLICA_COUNT_RE = /Number of Replicas/;
const REPLICA_VALUE_RE = />2</;
const PENDING_REPLICA_VALUE_RE = />3</;
const NUMERIC_REPLICA_UNIT_VALUE_RE = />\d+ Replicas?</;
const PRIVATE_MYSQL_TEMPLATE_RE =
  /mysql:\/\/&lt;username&gt;:&lt;password&gt;@db.default.svc:3306\/mydb/;
const PUBLIC_MYSQL_TEMPLATE_RE =
  /mysql:\/\/&lt;username&gt;:&lt;password&gt;@192.168.10.189.nip.io:45211\/mydb/;
const INVISIBLE_UNSAVED_CHANGES_RE =
  /<p class="[^"]*\binvisible\b[^"]*" role="status">.*Unsaved changes.*<\/p>/;

const PRIVATE_CONNECTION = {
  id: "private",
  kind: "private",
  label: "Private connection",
  value: "postgres://<username>:<password>@postgres.default.svc:5432/app",
} satisfies DbSettingsData["connections"][number];

const PUBLIC_CONNECTION = {
  id: "public",
  kind: "public",
  label: "Public connection",
  publicAccess: { enabled: true },
  value: "postgres://<username>:<password>@db.example.com:30432/app",
} satisfies DbSettingsData["connections"][number];

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
} satisfies DbSettingsData;

function renderPane(
  element: ReactElement = (
    <DatabaseSettingsPaneContent data={BASE_DATA} onSubmitPatch={noop} />
  )
): string {
  return renderToStaticMarkup(element);
}

test("database settings pane masks connection rows behind the fixed mask", () => {
  const html = renderPane();

  assert.match(html, CONNECTION_ADDRESS_RE);
  assert.match(html, PRIVATE_CONNECTION_RE);
  assert.match(html, PUBLIC_CONNECTION_RE);
  assert.equal([...html.matchAll(FIXED_CONNECTION_MASK_RE)].length, 2);
  assert.doesNotMatch(html, PRIVATE_CONNECTION_TEMPLATE_RE);
  assert.doesNotMatch(html, PUBLIC_CONNECTION_TEMPLATE_RE);
  assert.match(html, COPY_PRIVATE_CONNECTION_RE);
  assert.match(html, COPY_PUBLIC_CONNECTION_RE);
});

test("database settings pane offers reveal actions only when a kubeconfig backs the pane", () => {
  const withoutKubeconfig = renderPane();
  assert.doesNotMatch(withoutKubeconfig, REVEAL_PRIVATE_CONNECTION_RE);
  assert.doesNotMatch(withoutKubeconfig, REVEAL_PUBLIC_CONNECTION_RE);

  const withKubeconfig = renderPane(
    <DatabaseSettingsPaneContent
      data={BASE_DATA}
      kubeconfig="kubeconfig-content"
      onSubmitPatch={noop}
    />
  );
  assert.match(withKubeconfig, REVEAL_PRIVATE_CONNECTION_RE);
  assert.match(withKubeconfig, REVEAL_PUBLIC_CONNECTION_RE);
  // The revealed DSN is fetched on demand and swapped in for one row at a
  // time; rendered page state never carries more than the fixed mask.
  assert.doesNotMatch(withKubeconfig, PRIVATE_CONNECTION_TEMPLATE_RE);
});

test("database settings pane renders shared draft actions", () => {
  const html = renderPane();

  assert.match(html, UPDATE_BUTTON_RE);
  assert.match(html, DISCARD_BUTTON_RE);
});

test("database settings pane delivers the draft footer through the side pane footer slot", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  let rendered: ReturnType<typeof render> | undefined;
  try {
    await actAndDrain(() => {
      rendered = render(
        <SidePane label="Settings pane" onClose={noop} title="Settings">
          <DatabaseSettingsPaneContent data={BASE_DATA} onSubmitPatch={noop} />
        </SidePane>
      );
    });
    const container = rendered?.container;
    assert.ok(container);
    const footer = container.querySelector('[data-slot="side-pane-footer"]');
    assert.ok(footer, "editable settings pin the draft footer in pane chrome");
    assert.ok(
      footer.querySelector('button[aria-label="Update database settings"]'),
      "the pinned footer carries the Update action"
    );
    assert.ok(
      footer.querySelector(
        'button[aria-label="Discard database configuration changes"]'
      ),
      "the pinned footer carries the Discard action"
    );
    assert.equal(
      footer.closest(".overflow-y-auto"),
      null,
      "the footer stays outside the scroll container"
    );
  } finally {
    if (rendered) {
      await actAndDrain(() => {
        rendered?.unmount();
      });
    }
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
});

test("read-only database settings pane pins no footer in pane chrome", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  let rendered: ReturnType<typeof render> | undefined;
  try {
    await actAndDrain(() => {
      rendered = render(
        <SidePane label="Settings pane" onClose={noop} title="Settings">
          <DatabaseSettingsPaneContent
            data={{ ...BASE_DATA, settingsAccess: { readOnly: true } }}
            onSubmitPatch={noop}
          />
        </SidePane>
      );
    });
    const container = rendered?.container;
    assert.ok(container);
    assert.equal(
      container.querySelector('[data-slot="side-pane-footer"]'),
      null,
      "read-only surfaces render no footer region"
    );
  } finally {
    if (rendered) {
      await actAndDrain(() => {
        rendered?.unmount();
      });
    }
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
});

test("database settings pane does not show unsaved changes for region repair only", () => {
  const html = renderPane(
    <DatabaseSettingsPaneContent
      data={{
        ...BASE_DATA,
        metadata: { labels: { "brain.io/project-id": "project" } },
      }}
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

test("database settings pane overlays accepted pending settings targets", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  try {
    const owner = {
      clusterFingerprint: "stable:test-cluster",
      kind: "database" as const,
      name: "postgres",
      namespace: "default",
    };
    createPendingSettingsStore({
      now: () => 1000,
      storage: window.localStorage,
    }).replaceDirtyDomains({
      owner,
      updates: [
        {
          domain: "resources",
          submittedAgainst: {
            cpuLimitCores: 1,
            memoryLimitGi: 2,
            replicas: 2,
            storageSizeGi: 20,
          },
          target: {
            cpuLimitCores: 1,
            memoryLimitGi: 2,
            replicas: 3,
            storageSizeGi: 20,
          },
        },
      ],
    });
    const element = (
      <DatabaseSettingsPaneContent
        data={BASE_DATA}
        onSubmitPatch={noop}
        submissionOwner={owner}
      />
    );

    // Server markup omits browser-local pending state, so hydration matches
    // SSR; the overlay arrives through the store snapshot on the client.
    assert.doesNotMatch(renderPane(element), PENDING_REPLICA_VALUE_RE);

    let rendered: ReturnType<typeof render> | undefined;
    await actAndDrain(() => {
      rendered = render(element);
    });
    assert.match(rendered?.container.innerHTML ?? "", PENDING_REPLICA_VALUE_RE);
    await actAndDrain(() => {
      rendered?.unmount();
    });
  } finally {
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
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
      onSubmitPatch={noop}
    />
  );

  assert.match(html, PUBLIC_CONNECTION_RE);
  assert.match(html, PROVISIONING_CONNECTION_RE);
  assert.doesNotMatch(html, COPY_PUBLIC_CONNECTION_RE);
});

test("database settings pane masks provisioned rows for every engine template", () => {
  const html = renderPane(
    <DatabaseSettingsPaneContent
      data={{
        ...BASE_DATA,
        connections: [
          {
            id: "private",
            kind: "private",
            label: "Private connection",
            value: "mysql://<username>:<password>@db.default.svc:3306/mydb",
          },
          {
            id: "public",
            kind: "public",
            label: "Public connection",
            publicAccess: { enabled: true },
            value:
              "mysql://<username>:<password>@192.168.10.189.nip.io:45211/mydb",
          },
        ],
      }}
      onSubmitPatch={noop}
    />
  );

  assert.doesNotMatch(html, PRIVATE_MYSQL_TEMPLATE_RE);
  assert.doesNotMatch(html, PUBLIC_MYSQL_TEMPLATE_RE);
  assert.equal([...html.matchAll(FIXED_CONNECTION_MASK_RE)].length, 2);
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
