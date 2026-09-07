import { spyOn } from "bun:test";
import assert from "node:assert/strict";
import { test } from "node:test";

import { fireEvent, render } from "@testing-library/react/pure";
import { ResourceSettingsSection } from "@workspace/ui/components/resource-settings/resource-settings";
import { renderToStaticMarkup } from "react-dom/server";

import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
} from "@/features/project-canvas/react-test-harness";
import { createPendingSettingsStore } from "../pending-settings-updates";
import { useApNetworkDraftController } from "./ap-network-draft";
import {
  apNetworkAfterDeletePublicAddress,
  apNetworkOpenByDefaultPorts,
  apNetworkOpenTarget,
  apNetworkSaveDraftFromNetwork,
  apNetworksEqual,
  networkWithAppListeningPortDisplayName,
  networkWithDefaultOpenPort,
  networkWithoutAppListeningPort,
  visibleDomainRows,
} from "./ap-network-model";
import type {
  ApEnvVar,
  ApReplicaStrategy,
  ApSettingsSectionsProps,
} from "./ap-settings-sections";
import {
  apNetworkAfterBindCustomDomain,
  apNetworkAfterEditPublicAddress,
  apNetworkAfterUnbindCustomDomain,
  apSettingsDraftIsDirty,
  confirmedAddDbDsnReferencesFromEnvDraft,
  envRawSourceDraftWithAddReferenceIntent,
  pendingDbReferencesFromEnvRawSourceDraft,
  resourceQuotaReplicaPatchFromDraft,
  useApPublicAddressesSettingsSections,
  useApSettingsSections,
} from "./ap-settings-sections";
import { AppListeningPortNameForm } from "./network-section";
import {
  configFileContentPreview,
  configMapDuplicatePaths,
} from "./workload-sections";

function TestApSettingsSections({
  className,
  ...props
}: ApSettingsSectionsProps & { className?: string }) {
  const model = useApSettingsSections(props);
  return (
    <div className={className} data-slot="ap-settings-sections-test-wrapper">
      {model.sections.map((section) =>
        section.chromeless ? (
          <div data-settings-section={section.id} key={section.id}>
            {section.content}
          </div>
        ) : (
          <ResourceSettingsSection
            actions={section.actions}
            icon={section.icon}
            key={section.id}
            title={section.title}
          >
            {section.content}
          </ResourceSettingsSection>
        )
      )}
      {model.footer}
    </div>
  );
}

const noop = () => {
  /* test noop */
};

function editorToken(name: string): string {
  return ["$", "{{", name, "}}"].join("");
}

function referenceExpression(db: string, variable: string): string {
  return ["$", "{{", db, ".", variable, "}}"].join("");
}

const ENV_ROWS_SLOT_RE = /data-slot="ap-env-rows"/;
const RAW_ENV_ROWS_OVERFLOW_VISIBLE_RE =
  /class="flex w-full flex-col gap-2 overflow-visible" data-slot="ap-env-rows"/;
const ENVIRONMENT_VARIABLES_TITLE_RE = /Environment Variables/;
const ENV_NAME_INPUT_RE = /aria-label="Environment variable name"/;
const ENV_VALUE_INPUT_RE = /aria-label="Environment variable value"/;
const EXTERNAL_REFERENCE_RE = /External reference/;
const RAW_ENV_EDITOR_RE = /Edit environment variables/;
const ENV_RAW_SOURCE_RE = /aria-label="Environment raw source"/;
const COPY_RAW_SOURCE_RE = /aria-label="Copy environment raw source"/;
const INSERT_RAW_REFERENCE_RE =
  /aria-label="Insert environment reference token"/;
const POSTGRES_DSN_RE = /postgres:\/\/db:5432\/app/;
const RAW_MODE_RE = />Raw</;
const LIST_MODE_RE = />List</;
const ENV_EDITOR_MODE_RE = /aria-label="Environment editor mode"/;
const DATABASE_URL_RE = /DATABASE_URL/;
const MASKED_ENV_VALUE_RE = />\*\*\*\*\*\*\*</;
const ADD_ENV_RE = /aria-label="Add environment variable"/;
const REFERENCE_SELECTOR_RE = /aria-label="Reference"/;
const REFERENCE_DB_LABEL_RE = /Reference DB/;
const INLINE_REFERENCE_TRIGGER_RE = /data-slot="ap-env-reference-trigger"/;
const TOKEN_TRIGGER_RE = /data-slot="ap-env-token-trigger"/;
const DB_FIELD_SELECT_RE = /aria-label="Project DB field"/;
const ENV_ROW_ACTIONS_RE =
  /aria-label="Environment variable actions for [^"]+"/;
const ENV_ROW_ACTIONS_RE_GLOBAL =
  /aria-label="Environment variable actions for [^"]+"/g;
const CANVAS_NODE_ACTION_MENU_TRIGGER_RE = /canvas-node-action-menu-trigger/;
const ENV_ROW_ACTIONS_SECONDARY_TRIGGER_RE =
  /aria-label="Environment variable actions for DATABASE_URL"[^>]*data-size="lg"[^>]*data-variant="secondary"/;
const EDIT_ENV_RE = /aria-label="Edit environment variable/;
const SAVE_ENV_RE = /Save environment/;
const EDITING_ENV_ROW_RE = /data-env-row="editing"/;
const PER_ROW_CANCEL_ENV_RE =
  /aria-label="Discard [^"]*environment variable edit"/;
const PER_ROW_SAVE_ENV_RE = /aria-label="Confirm [^"]*environment variable"/;
const UPDATE_AP_SETTINGS_RE = /aria-label="Update AP Settings"/;
const UPDATE_ENVIRONMENT_VARIABLES_RE =
  /aria-label="Update Environment Variables"/;
const VALUE_FROM_PLACEHOLDER_RE = /\(valueFrom\)/;
const CANCEL_ENV_RE = /Cancel environment changes/;
const DISCARD_AP_SETTINGS_RE = /aria-label="Discard AP Settings changes"/;
const CPU_MEMORY_SECTION_RE = /CPU \/ Memory/;
const IMAGE_INPUT_RE = /aria-label="AP image"/;
const LAUNCH_COMMAND_RE = /Launch Command/;
const CONFIG_FILES_RE = /Configuration Files/;
const STORAGE_RE = /Storage/;
const AP_COMMAND_RE = /aria-label="AP command"/;
const CONFIG_FILE_EDIT_RE = /aria-label="Edit configuration file"/;
const CONFIG_FILE_DELETE_RE = /aria-label="Delete configuration file"/;
const CONFIG_FILE_EDIT_SECONDARY_RE =
  /<button(?=[^>]*aria-label="Edit configuration file")(?=[^>]*data-size="lg")(?=[^>]*data-variant="secondary")/;
const CONFIG_FILE_DELETE_DANGER_RE =
  /<button(?=[^>]*aria-label="Delete configuration file")(?=[^>]*data-size="lg")(?=[^>]*data-variant="danger")/;
const CONFIG_FILE_DELETE_TEXT_RE = />Delete</;
const NO_CONFIG_FILES_RE = /No config files yet\./;
const CONFIG_FILES_EMPTY_STATE_RE =
  /class="flex min-h-9 w-full items-center justify-center rounded-lg border border-border border-dashed px-3 text-muted-foreground text-xs leading-4"/;
const CONFIG_FILE_PREVIEW_RE = /debug: false/;
const STORAGE_SIZE_RE = /aria-label="Storage size"/;
const CONFIG_FILE_MOUNT_PATH_RE = /\/etc\/app\/config\.yaml/;
const STORAGE_SIZE_VALUE_RE = /aria-label="Storage size"[^>]*value="20"/;
const PENDING_AP_IMAGE_RE = /ghcr.io\/acme\/api:pending/;
const MYSQL_PRIVATE_DSN_RE = /mysql:\/\/private/;
const MYSQL_DATABASE_URL_REFERENCE_RE = /\$\{\{mysql\.DATABASE_URL\}\}/;
const PRIVATE_ADDRESS_RE = /Private Address/;
const PRIVATE_ADDRESSES_CARD_RE = /Private Addresses/;
const APP_LISTENING_PORTS_CARD_RE = /App Listening Ports/;
const RENAME_PORT_5201_RE = /aria-label="App Listening Port 5201 actions"/;
const OPEN_ADMIN_ACTION_RE =
  /<a(?=[^>]*aria-label="Open admin")(?=[^>]*data-network-action="open")(?=[^>]*href="https:\/\/game-admin\.example\.com\/")(?=[^>]*target="_blank")/;
const OPEN_CONSOLE_ACTION_RE =
  /<a(?=[^>]*aria-label="Open Console")(?=[^>]*data-network-action="open")(?=[^>]*href="https:\/\/console\.example\.com\/")/;
const OPEN_S3_ACTION_RE =
  /<a(?=[^>]*aria-label="Open S3 API")(?=[^>]*data-network-action="open")(?=[^>]*href="https:\/\/s3\.example\.com\/")/;
const OPEN_CUSTOM_DOMAIN_ACTION_RE =
  /<a(?=[^>]*data-network-action="open")(?=[^>]*href="https:\/\/www\.example\.com\/")/;
const OPEN_DISABLED_ACTION_RE =
  /<button(?=[^>]*aria-description="Not accessible yet")(?=[^>]*aria-disabled="true")(?=[^>]*aria-label="Open")(?=[^>]*data-network-action="open")/;
const PORT_5200_NO_DOMAINS_RE = />5200 · 0 domains</;
const PORT_5201_ADMIN_DETAIL_RE = />admin · 5201 · 1 domain</;
const DOMAIN_5201_ADMIN_DETAIL_RE = />admin · 5201</;
const PORT_5201_RENAMED_DETAIL_RE = />Admin console · 5201 · 1 domain</;
const DOMAIN_5201_RENAMED_DETAIL_RE = />Admin console · 5201</;
const PORT_NAME_FORM_HEADER_RE = />Port 5201</;
const PORT_NAME_TAKEN_RE = /already used by App Listening Port 5201/;
const KIND_LABEL_OR_PLACEHOLDER_RE = /Unnamed|Add a name|Platform Address</;
const NETWORK_SECTION_TITLE_RE = />Network</;
const PUBLIC_ADDRESSES_SECTION_TITLE_RE = />Public Addresses</;
const ADD_PORT_RE = /Add Port/;
const PRIVATE_ADDRESS_DEFAULT_VALUE_RE =
  /http:\/\/api-service.default.svc:8080/;
const PRIVATE_ADDRESS_VALUE_RE =
  /http:\/\/api-service-port-8080.default.svc:8080/;
const COPY_PRIVATE_ADDRESS_RE = /aria-label="Copy Private Address"/;
const DOMAIN_LIST_RE = /Domain List/;
const NO_PUBLIC_ADDRESSES_RE = /No public addresses yet/;
const PUBLIC_ADDRESS_VALUE_RE = /https:\/\/api.example.com\//;
const FIRST_PUBLIC_ADDRESS_VALUE_RE = /https:\/\/api-a.example.com\//;
const SECOND_PUBLIC_ADDRESS_VALUE_RE = /https:\/\/api-b.example.com\//;
const THIRD_PUBLIC_ADDRESS_VALUE_RE = /https:\/\/api-c.example.com\//;
const FOURTH_PUBLIC_ADDRESS_VALUE_RE = /https:\/\/api-d.example.com\//;
const DRAFT_PUBLIC_ADDRESS_VALUE_RE = /https:\/\/ffyrwq.apps.example.com\//;
const PUBLIC_ADDRESS_STATUS_RE = /Public Address status: accessible/;
const CUSTOM_DOMAIN_VALUE_RE = /www\.example\.com/;
const CUSTOM_DOMAIN_STATUS_RE = /Custom Domain status: accessible/;
const CUSTOM_DOMAIN_BLOCKED_STATUS_RE = /Custom Domain status: blocked/;
const CUSTOM_DOMAIN_DNS_DETAIL_RE = /DNS verified/;
const CUSTOM_DOMAIN_CERT_DETAIL_RE = /Certificate failed/;
const CUSTOM_DOMAIN_ROUTING_DETAIL_RE = /Routing pending/;
const CUSTOM_DOMAIN_DETAIL_REASON_RE = /IssuerNotReady/;
const CUSTOM_DOMAIN_DETAIL_MESSAGE_RE = /Certificate request failed/;
const UNBIND_CUSTOM_DOMAIN_RE =
  /aria-label="Custom Domain actions for www\.example\.com"/;
const COPY_PUBLIC_ADDRESS_RE = /aria-label="Copy Public Address"/;
const PUBLIC_ADDRESS_LINK_RE = /<a [^>]*data-slot="canvas-node-row-value"/;
const PUBLIC_ADDRESS_LINK_HREF_RE = /href="https:\/\/api\.example\.com\/"/;
const COPY_ENV_VALUE_RE = /aria-label="Copy environment variable DATABASE_URL"/;
const REVEAL_ENV_VALUE_RE =
  /aria-label="Reveal environment variable DATABASE_URL"/;
const REVEAL_ENV_VALUE_UNPRESSED_RE =
  /aria-label="Reveal environment variable DATABASE_URL"[^>]*aria-pressed="false"/;
const HIDE_ENV_VALUE_RE = /aria-label="Hide environment variable DATABASE_URL"/;
const COPY_MYSQL_ENV_VALUE_RE =
  /aria-label="Copy environment variable MYSQL_DATABASE_URL"/;
const REVEAL_MYSQL_ENV_VALUE_RE =
  /aria-label="Reveal environment variable MYSQL_DATABASE_URL"/;
const CNAME_RE = /CNAME/;
const EDIT_PUBLIC_ADDRESS_RE = /aria-label="Public Address actions for [^"]+"/;
const DELETE_PUBLIC_ADDRESS_RE = EDIT_PUBLIC_ADDRESS_RE;
const ADD_PUBLIC_ADDRESS_RE = /aria-label="Add Public Address"/;
const ADD_DOMAIN_LABEL_RE = /Add Domain/;
const VIEW_ALL_PUBLIC_ADDRESSES_RE = /aria-label="View All Public Addresses"/;
const PUBLIC_ADDRESSES_COLLAPSED_RE = /aria-expanded="false"/;
const SHOW_LESS_PUBLIC_ADDRESSES_RE = /aria-label="Show Less Public Addresses"/;
const INLINE_END_ICON_RE = /data-icon="inline-end"/;
const CURSOR_POINTER_RE = /cursor-pointer/;
const PRIVATE_PORT_VALUE_RE = />8080 · 0 domains</;
const REPLICA_STRATEGY_RE = /Replica Strategy/;
const FIXED_REPLICAS_RE = /Fixed Replicas/;
const ELASTIC_SCALING_RE = /Elastic Scaling/;
const REPLICA_COUNT_RE = /Number of Replicas/;
const REPLICA_VALUE_RE = />4</;
const MIN_REPLICAS_RE = /Minimum Replicas/;
const MIN_REPLICA_VALUE_RE = />2</;
const MAX_REPLICAS_RE = /Maximum Replicas/;
const MAX_REPLICA_VALUE_RE = />8</;
const NUMERIC_REPLICA_UNIT_VALUE_RE = />\d+ Replicas?</;
const CPU_TARGET_RE = /CPU utilization target/;
const CPU_TARGET_VALUE_RE = />75%/;
const CPU_TARGET_PERCENT_RE = />75%</;
const SCALING_TARGET_RE = /Scaling target/;
const MEMORY_TARGET_RE = /Memory average target/;
const MEMORY_TARGET_VALUE_RE = />512 Mi</;
const MEMORY_TARGET_QUANTITY_RE = />512 Mi</;
const BUTTON_RE = /<button/;

function renderPane(
  readOnly = false,
  env: ApEnvVar[] = [{ name: "DATABASE_URL", value: "postgres://db:5432/app" }]
): string {
  return renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      dbDsnReferenceSources={[
        {
          name: "empty",
          namespace: "default",
        },
        {
          name: "postgres",
          namespace: "default",
          privateDsn: "postgres://private",
          primitiveSecretRefs: {
            password: {
              key: "passwd",
              name: "postgres-conn-credential",
            },
          },
        },
      ]}
      env={env}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
      readOnly={readOnly}
    />
  );
}

test("AP settings pane renders editable structured environment rows for new rows", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      addDbDsnReferenceIntent={{
        dbName: "postgres",
        dbNamespace: "default",
        id: "drag-1",
      }}
      cpuQuota={{ onValueChange: noop, value: 1 }}
      dbDsnReferenceSources={[
        {
          name: "postgres",
          namespace: "default",
        },
      ]}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
    />
  );

  assert.match(html, ENV_ROWS_SLOT_RE);
  assert.match(html, ENV_NAME_INPUT_RE);
  assert.match(html, ENV_VALUE_INPUT_RE);
  assert.match(html, TOKEN_TRIGGER_RE);
  assert.doesNotMatch(html, REFERENCE_SELECTOR_RE);
  assert.doesNotMatch(html, RAW_ENV_EDITOR_RE);
  assert.match(html, LIST_MODE_RE);
  assert.match(html, RAW_MODE_RE);
  assert.doesNotMatch(html, ENV_RAW_SOURCE_RE);
});

test("AP settings pane masks clean saved structured environment rows", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[{ name: "DATABASE_URL", value: "postgres://db:5432/app" }]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onEnvResolvedValue={async () => "postgres://db:5432/app"}
      onImageChange={noop}
    />
  );

  assert.match(html, MASKED_ENV_VALUE_RE);
  assert.doesNotMatch(html, ENV_VALUE_INPUT_RE);
  assert.doesNotMatch(html, POSTGRES_DSN_RE);
  assert.match(html, REVEAL_ENV_VALUE_RE);
  assert.match(html, REVEAL_ENV_VALUE_UNPRESSED_RE);
  assert.doesNotMatch(html, HIDE_ENV_VALUE_RE);
  assert.match(html, COPY_ENV_VALUE_RE);
});

test("AP settings pane shows raw draft values for dirty structured rows", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      addDbDsnReferenceIntent={{
        dbName: "mysql",
        dbNamespace: "default",
        id: "drag-1",
      }}
      cpuQuota={{ onValueChange: noop, value: 1 }}
      dbDsnReferenceSources={[
        {
          name: "mysql",
          namespace: "default",
        },
      ]}
      env={[{ name: "DATABASE_URL", value: "postgres://db:5432/app" }]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onEnvResolvedValue={async () => "postgres://db:5432/app"}
      onImageChange={noop}
    />
  );

  assert.doesNotMatch(html, POSTGRES_DSN_RE);
  assert.match(html, MASKED_ENV_VALUE_RE);
  assert.match(html, MYSQL_DATABASE_URL_REFERENCE_RE);
  assert.doesNotMatch(html, REVEAL_MYSQL_ENV_VALUE_RE);
  assert.doesNotMatch(html, COPY_MYSQL_ENV_VALUE_RE);
});

test("AP settings pane renders environment editor controls above the rows", () => {
  const html = renderPane();
  const titleIndex = html.search(ENVIRONMENT_VARIABLES_TITLE_RE);
  const modeIndex = html.search(ENV_EDITOR_MODE_RE);
  const addIndex = html.search(ADD_ENV_RE);
  const rowsIndex = html.search(ENV_ROWS_SLOT_RE);

  assert.notEqual(titleIndex, -1);
  assert.notEqual(modeIndex, -1);
  assert.notEqual(addIndex, -1);
  assert.notEqual(rowsIndex, -1);
  assert.ok(titleIndex < modeIndex);
  assert.ok(modeIndex < addIndex);
  assert.ok(titleIndex < addIndex);
  assert.ok(addIndex < rowsIndex);
});

test("AP settings pane renders Image below CPU / Memory", () => {
  const html = renderPane();
  const cpuMemoryIndex = html.search(CPU_MEMORY_SECTION_RE);
  const imageIndex = html.search(IMAGE_INPUT_RE);

  assert.notEqual(cpuMemoryIndex, -1);
  assert.notEqual(imageIndex, -1);
  assert.ok(cpuMemoryIndex < imageIndex);
});

test("AP settings pane renders Figma-aligned empty Configuration Files state", () => {
  const html = renderPane();

  assert.match(html, CONFIG_FILES_RE);
  assert.match(html, NO_CONFIG_FILES_RE);
  assert.match(html, CONFIG_FILES_EMPTY_STATE_RE);
});

test("AP settings pane shows no AP networking surface without Network data", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
    />
  );

  assert.doesNotMatch(html, PRIVATE_ADDRESS_RE);
  assert.doesNotMatch(html, DOMAIN_LIST_RE);
});

test("AP settings pane renders address settings instead of Ports for private-only APs", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      network={{
        privateAddress: "http://api-service-port-8080.default.svc:8080",
        privatePort: 8080,
        publicAddresses: [],
      }}
      onEnvChange={noop}
      onImageChange={noop}
      onNetworkChange={noop}
    />
  );

  assert.match(html, PRIVATE_ADDRESS_RE);
  assert.match(html, PRIVATE_ADDRESS_VALUE_RE);
  assert.match(html, ADD_PORT_RE);
  assert.match(html, PRIVATE_PORT_VALUE_RE);
  assert.match(html, COPY_PRIVATE_ADDRESS_RE);
  assert.match(html, DOMAIN_LIST_RE);
  assert.match(html, NO_PUBLIC_ADDRESSES_RE);
});

test("AP settings pane renders editable public address rows", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      network={{
        privateAddress: "http://api-service.default.svc:8080",
        privatePort: 8080,
        publicAddresses: [
          {
            host: "api.example.com",
            port: 8080,
            status: "accessible",
            type: "platform",
            url: "https://api.example.com/",
          },
        ],
      }}
      onEnvChange={noop}
      onImageChange={noop}
      onNetworkChange={noop}
    />
  );

  assert.match(html, DOMAIN_LIST_RE);
  assert.match(html, PUBLIC_ADDRESS_VALUE_RE);
  assert.match(html, PUBLIC_ADDRESS_STATUS_RE);
  assert.match(html, COPY_PUBLIC_ADDRESS_RE);
  assert.match(html, PUBLIC_ADDRESS_LINK_RE);
  assert.match(html, PUBLIC_ADDRESS_LINK_HREF_RE);
  assert.doesNotMatch(html, CNAME_RE);
  assert.match(html, EDIT_PUBLIC_ADDRESS_RE);
  assert.match(html, DELETE_PUBLIC_ADDRESS_RE);
  assert.match(html, ADD_PUBLIC_ADDRESS_RE);
  assert.match(html, ADD_DOMAIN_LABEL_RE);
  assert.doesNotMatch(html, NO_PUBLIC_ADDRESSES_RE);
});

test("AP settings pane derives the value link from host-only Public Addresses", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      network={{
        privateAddress: "http://api-service.default.svc:8080",
        privatePort: 8080,
        publicAddresses: [
          {
            host: "api.example.com",
            port: 8080,
            status: "accessible",
            type: "platform",
          },
        ],
      }}
      onEnvChange={noop}
      onImageChange={noop}
      onNetworkChange={noop}
    />
  );

  assert.match(html, PUBLIC_ADDRESS_LINK_RE);
  assert.match(html, PUBLIC_ADDRESS_LINK_HREF_RE);
});

test("AP settings pane keeps pending Public Addresses as plain text", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      network={{
        privateAddress: "http://api-service.default.svc:8080",
        privatePort: 8080,
        publicAddresses: [
          {
            port: 8080,
            status: "pending",
            type: "platform",
          },
        ],
      }}
      onEnvChange={noop}
      onImageChange={noop}
      onNetworkChange={noop}
    />
  );

  assert.doesNotMatch(html, PUBLIC_ADDRESS_LINK_RE);
});

test("AP settings pane collapses overflowing public address rows by default", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      network={{
        privateAddress: "http://api-service.default.svc:8080",
        privatePort: 8080,
        publicAddresses: [
          {
            host: "api-a.example.com",
            port: 8080,
            status: "accessible",
            type: "platform",
            url: "https://api-a.example.com/",
          },
          {
            host: "api-b.example.com",
            port: 8080,
            status: "accessible",
            type: "platform",
            url: "https://api-b.example.com/",
          },
          {
            host: "api-c.example.com",
            port: 8080,
            status: "accessible",
            type: "platform",
            url: "https://api-c.example.com/",
          },
          {
            host: "api-d.example.com",
            port: 8080,
            status: "accessible",
            type: "platform",
            url: "https://api-d.example.com/",
          },
        ],
      }}
      onEnvChange={noop}
      onImageChange={noop}
      onNetworkChange={noop}
    />
  );

  assert.match(html, FIRST_PUBLIC_ADDRESS_VALUE_RE);
  assert.match(html, SECOND_PUBLIC_ADDRESS_VALUE_RE);
  assert.match(html, THIRD_PUBLIC_ADDRESS_VALUE_RE);
  assert.doesNotMatch(html, FOURTH_PUBLIC_ADDRESS_VALUE_RE);
  assert.match(html, VIEW_ALL_PUBLIC_ADDRESSES_RE);
  assert.match(html, PUBLIC_ADDRESSES_COLLAPSED_RE);
  assert.match(html, CURSOR_POINTER_RE);
  assert.doesNotMatch(html, SHOW_LESS_PUBLIC_ADDRESSES_RE);
  assert.doesNotMatch(html, INLINE_END_ICON_RE);
});

test("AP settings pane renders draft-visible Platform Address hosts", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      network={{
        privateAddress: "http://api-service.default.svc:8080",
        privatePort: 8080,
        publicAddresses: [
          {
            host: "ffyrwq.apps.example.com",
            id: "pa_old123",
            port: 8080,
            status: "progressing",
            type: "platform",
            url: "https://ffyrwq.apps.example.com/",
          },
        ],
      }}
      networkPlatformAddressDraftContext={{
        appName: "api",
        namespace: "project-a",
        routingDomain: "apps.example.com",
      }}
      onEnvChange={noop}
      onImageChange={noop}
      onNetworkChange={noop}
    />
  );

  assert.match(html, DRAFT_PUBLIC_ADDRESS_VALUE_RE);
  assert.match(html, COPY_PUBLIC_ADDRESS_RE);
  assert.doesNotMatch(html, CNAME_RE);
  assert.match(html, EDIT_PUBLIC_ADDRESS_RE);
  assert.doesNotMatch(html, NO_PUBLIC_ADDRESSES_RE);
});

test("AP settings pane shows Custom Domain rows instead of bound Platform Addresses", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      network={{
        customDomains: [
          {
            domain: "www.example.com",
            id: "cd_def456",
            platformAddressId: "pa_abc123",
            status: "accessible",
          },
        ],
        privateAddress: "http://api-service.default.svc:8080",
        privatePort: 8080,
        publicAddresses: [
          {
            host: "api.example.com",
            id: "pa_abc123",
            port: 8080,
            status: "accessible",
            type: "platform",
            url: "https://api.example.com/",
          },
        ],
      }}
      onEnvChange={noop}
      onImageChange={noop}
      onNetworkChange={noop}
    />
  );

  assert.match(html, CUSTOM_DOMAIN_VALUE_RE);
  assert.match(html, CUSTOM_DOMAIN_STATUS_RE);
  assert.match(html, OPEN_CUSTOM_DOMAIN_ACTION_RE);
  assert.doesNotMatch(html, PUBLIC_ADDRESS_VALUE_RE);
  assert.doesNotMatch(html, EDIT_PUBLIC_ADDRESS_RE);
});

test("AP settings pane renders Custom Domain Binding lifecycle detail states", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      network={{
        customDomains: [
          {
            certificate: {
              message: "Certificate request failed.",
              reason: "IssuerNotReady",
              status: "failed",
            },
            dns: { status: "verified" },
            domain: "www.example.com",
            id: "cd_def456",
            platformAddressId: "pa_abc123",
            routing: {
              message: "Custom Domain Ingress has not been observed yet.",
              status: "pending",
            },
            status: "blocked",
            targetPort: 8080,
          },
        ],
        privateAddress: "http://api-service.default.svc:8080",
        privatePort: 8080,
        publicAddresses: [
          {
            host: "api.example.com",
            id: "pa_abc123",
            port: 8080,
            status: "accessible",
            type: "platform",
            url: "https://api.example.com/",
          },
        ],
      }}
      onEnvChange={noop}
      onImageChange={noop}
      onNetworkChange={noop}
    />
  );

  assert.match(html, CUSTOM_DOMAIN_BLOCKED_STATUS_RE);
  assert.match(html, CUSTOM_DOMAIN_DNS_DETAIL_RE);
  assert.match(html, CUSTOM_DOMAIN_CERT_DETAIL_RE);
  assert.match(html, CUSTOM_DOMAIN_ROUTING_DETAIL_RE);
  assert.match(html, CUSTOM_DOMAIN_DETAIL_REASON_RE);
  assert.match(html, CUSTOM_DOMAIN_DETAIL_MESSAGE_RE);
  assert.match(html, UNBIND_CUSTOM_DOMAIN_RE);
});

test("AP settings pane unbinds Custom Domains without deleting Platform Addresses", () => {
  const next = apNetworkAfterUnbindCustomDomain(
    {
      customDomains: [
        {
          domain: "www.example.com",
          id: "cd_def456",
          platformAddressId: "pa_abc123",
          status: "accessible",
        },
      ],
      privateAddress: "http://api-service.default.svc:8080",
      privatePort: 8080,
      publicAddresses: [
        {
          host: "api.example.com",
          id: "pa_abc123",
          port: 8080,
          status: "accessible",
          type: "platform",
          url: "https://api.example.com/",
        },
      ],
    },
    { id: "cd_def456" }
  );

  assert.deepEqual(next.customDomains, []);
  assert.deepEqual(next.publicAddresses, [
    {
      host: "api.example.com",
      id: "pa_abc123",
      port: 8080,
      status: "accessible",
      type: "platform",
      url: "https://api.example.com/",
    },
  ]);
  assert.match(
    renderToStaticMarkup(
      <TestApSettingsSections
        cpuQuota={{ onValueChange: noop, value: 1 }}
        env={[]}
        image="ghcr.io/acme/api:latest"
        memoryQuota={{ onValueChange: noop, value: 512 }}
        network={next}
        onEnvChange={noop}
        onImageChange={noop}
        onNetworkChange={noop}
      />
    ),
    PUBLIC_ADDRESS_VALUE_RE
  );
});

test("AP settings pane binds Custom Domains and retargets the Platform Address port", () => {
  const next = apNetworkAfterBindCustomDomain(
    {
      privateAddress: "http://api-service.default.svc:8080",
      privatePort: 8080,
      publicAddresses: [
        {
          host: "api.example.com",
          id: "pa_abc123",
          port: 8080,
          status: "accessible",
          type: "platform",
          url: "https://api.example.com/",
        },
      ],
    },
    {
      customDomain: {
        cnameTarget: "api.example.com",
        domain: "www.example.com",
        id: "cd_def456",
        platformAddressId: "pa_abc123",
        status: "verified",
        targetPort: 8080,
      },
      publicAddress: {
        address: {
          host: "api.example.com",
          id: "pa_abc123",
          port: 8080,
          status: "accessible",
          type: "platform",
          url: "https://api.example.com/",
        },
        publicAddressIndex: 0,
      },
      port: 9000,
    }
  );

  assert.deepEqual(next.publicAddresses, [
    {
      host: "api.example.com",
      id: "pa_abc123",
      port: 9000,
      status: "accessible",
      type: "platform",
      url: "https://api.example.com/",
    },
  ]);
  assert.deepEqual(next.customDomains, [
    {
      cnameTarget: "api.example.com",
      domain: "www.example.com",
      id: "cd_def456",
      platformAddressId: "pa_abc123",
      status: "verified",
      targetPort: 9000,
    },
  ]);
});

test("AP settings pane edits Public Address ports without binding Custom Domains", () => {
  const next = apNetworkAfterEditPublicAddress(
    {
      privateAddress: "http://api-service.default.svc:8080",
      privatePort: 8080,
      publicAddresses: [
        {
          host: "api.example.com",
          id: "pa_abc123",
          port: 8080,
          status: "accessible",
          type: "platform",
          url: "https://api.example.com/",
        },
      ],
    },
    {
      publicAddress: {
        address: {
          host: "api.example.com",
          id: "pa_abc123",
          port: 8080,
          status: "accessible",
          type: "platform",
          url: "https://api.example.com/",
        },
        publicAddressIndex: 0,
      },
      port: 9000,
    }
  );

  assert.deepEqual(next.publicAddresses, [
    {
      host: "api.example.com",
      id: "pa_abc123",
      port: 9000,
      status: "accessible",
      type: "platform",
      url: "https://api.example.com/",
    },
  ]);
  assert.equal(next.customDomains, undefined);
  assert.deepEqual(next.appListeningPorts, [
    {
      port: 8080,
      privateAddress: "http://api-service.default.svc:8080",
    },
    { port: 9000 },
  ]);
});

test("AP network visible Public Address mutations use raw indexes after hidden Custom Domains", () => {
  const network = {
    customDomains: [
      {
        domain: "www.example.com",
        id: "cd_def456",
        platformAddressId: "pa_hidden",
      },
    ],
    privatePort: 80,
    publicAddresses: [
      { id: "pa_hidden", port: 80 },
      { host: "pending.example.com", port: 80 },
      { host: "later.example.com", port: 80 },
    ],
  };
  const visibleRows = visibleDomainRows(network).publicAddressRows;

  assert.equal(visibleRows.length, 2);
  assert.equal(visibleRows[0]?.publicAddressIndex, 1);

  const edited = apNetworkAfterEditPublicAddress(network, {
    publicAddress: visibleRows[0],
    port: 9000,
  });
  assert.deepEqual(edited.publicAddresses, [
    { id: "pa_hidden", port: 80 },
    { host: "pending.example.com", port: 9000 },
    { host: "later.example.com", port: 80 },
  ]);

  const deleted = apNetworkAfterDeletePublicAddress(network, visibleRows[0]);
  assert.deepEqual(deleted.publicAddresses, [
    { id: "pa_hidden", port: 80 },
    { host: "later.example.com", port: 80 },
  ]);
});

test("AP settings pane renders fixed replica strategy controls", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
      replicaStrategy={{
        fixed: { replicas: 4 },
        type: "fixed",
      }}
      replicasQuota={{ onValueChange: noop, value: 4 }}
    />
  );

  assert.match(html, REPLICA_STRATEGY_RE);
  assert.match(html, FIXED_REPLICAS_RE);
  assert.match(html, ELASTIC_SCALING_RE);
  assert.match(html, REPLICA_COUNT_RE);
  assert.match(html, REPLICA_VALUE_RE);
  assert.doesNotMatch(html, NUMERIC_REPLICA_UNIT_VALUE_RE);
});

test("AP settings pane renders CPU elastic replica strategy controls", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
      replicaStrategy={{
        elastic: {
          maxReplicas: 8,
          minReplicas: 2,
          target: {
            metric: "cpu",
            type: "utilization",
            utilizationPercent: 75,
          },
        },
        fixed: { replicas: 4 },
        type: "elastic",
      }}
      replicasQuota={{ onValueChange: noop, value: 4 }}
    />
  );

  assert.match(html, REPLICA_STRATEGY_RE);
  assert.match(html, FIXED_REPLICAS_RE);
  assert.match(html, ELASTIC_SCALING_RE);
  assert.match(html, MIN_REPLICAS_RE);
  assert.match(html, MIN_REPLICA_VALUE_RE);
  assert.match(html, MAX_REPLICAS_RE);
  assert.match(html, MAX_REPLICA_VALUE_RE);
  assert.match(html, CPU_TARGET_RE);
  assert.match(html, CPU_TARGET_VALUE_RE);
  assert.doesNotMatch(html, REPLICA_COUNT_RE);
  assert.doesNotMatch(html, NUMERIC_REPLICA_UNIT_VALUE_RE);
});

test("AP settings pane renders Memory elastic replica strategy controls", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
      replicaStrategy={{
        elastic: {
          maxReplicas: 8,
          minReplicas: 2,
          target: {
            averageValue: "512Mi",
            metric: "memory",
            type: "averageValue",
          },
        },
        fixed: { replicas: 4 },
        type: "elastic",
      }}
      replicasQuota={{ onValueChange: noop, value: 4 }}
    />
  );

  assert.match(html, REPLICA_STRATEGY_RE);
  assert.match(html, SCALING_TARGET_RE);
  assert.match(html, CPU_TARGET_RE);
  assert.match(html, MEMORY_TARGET_RE);
  assert.match(html, MEMORY_TARGET_VALUE_RE);
  assert.doesNotMatch(html, REPLICA_COUNT_RE);
});

test("AP settings pane fixed save payload preserves inactive elastic branch", () => {
  const draft: ApReplicaStrategy = {
    elastic: {
      maxReplicas: 9,
      minReplicas: 3,
      target: {
        averageValue: "768Mi",
        metric: "memory",
        type: "averageValue",
      },
    },
    fixed: { replicas: 4 },
    type: "fixed",
  };

  assert.deepEqual(resourceQuotaReplicaPatchFromDraft(true, draft), {
    replicaStrategy: draft,
  });
});

test("read-only AP settings view renders fixed replica strategy without mutation controls", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
      readOnly
      replicaStrategy={{
        fixed: { replicas: 4 },
        type: "fixed",
      }}
      replicasQuota={{ onValueChange: noop, value: 4 }}
    />
  );

  assert.match(html, REPLICA_STRATEGY_RE);
  assert.match(html, FIXED_REPLICAS_RE);
  assert.match(html, REPLICA_COUNT_RE);
  assert.match(html, REPLICA_VALUE_RE);
  assert.doesNotMatch(html, NUMERIC_REPLICA_UNIT_VALUE_RE);
  assert.doesNotMatch(html, ELASTIC_SCALING_RE);
  assert.doesNotMatch(html, BUTTON_RE);
});

test("read-only AP settings view renders CPU elastic replica strategy without mutation controls", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
      readOnly
      replicaStrategy={{
        elastic: {
          maxReplicas: 8,
          minReplicas: 2,
          target: {
            metric: "cpu",
            type: "utilization",
            utilizationPercent: 75,
          },
        },
        fixed: { replicas: 4 },
        type: "elastic",
      }}
      replicasQuota={{ onValueChange: noop, value: 4 }}
    />
  );

  assert.match(html, REPLICA_STRATEGY_RE);
  assert.match(html, ELASTIC_SCALING_RE);
  assert.match(html, MIN_REPLICAS_RE);
  assert.match(html, MIN_REPLICA_VALUE_RE);
  assert.match(html, MAX_REPLICAS_RE);
  assert.match(html, MAX_REPLICA_VALUE_RE);
  assert.match(html, SCALING_TARGET_RE);
  assert.match(html, CPU_TARGET_RE);
  assert.match(html, CPU_TARGET_PERCENT_RE);
  assert.doesNotMatch(html, NUMERIC_REPLICA_UNIT_VALUE_RE);
  assert.doesNotMatch(html, FIXED_REPLICAS_RE);
  assert.doesNotMatch(html, BUTTON_RE);
});

test("read-only AP settings view renders Memory elastic replica strategy without mutation controls", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
      readOnly
      replicaStrategy={{
        elastic: {
          maxReplicas: 8,
          minReplicas: 2,
          target: {
            averageValue: "512Mi",
            metric: "memory",
            type: "averageValue",
          },
        },
        fixed: { replicas: 4 },
        type: "elastic",
      }}
      replicasQuota={{ onValueChange: noop, value: 4 }}
    />
  );

  assert.match(html, REPLICA_STRATEGY_RE);
  assert.match(html, ELASTIC_SCALING_RE);
  assert.match(html, MIN_REPLICAS_RE);
  assert.match(html, MAX_REPLICAS_RE);
  assert.match(html, SCALING_TARGET_RE);
  assert.match(html, MEMORY_TARGET_RE);
  assert.match(html, MEMORY_TARGET_QUANTITY_RE);
  assert.doesNotMatch(html, FIXED_REPLICAS_RE);
  assert.doesNotMatch(html, BUTTON_RE);
});

test("read-only network view renders addresses without mutation controls", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      network={{
        privateAddress: "http://api-service.default.svc:8080",
        privatePort: 8080,
        publicAddresses: [
          {
            host: "api.example.com",
            port: 8080,
            status: "accessible",
            type: "platform",
            url: "https://api.example.com/",
          },
        ],
      }}
      onEnvChange={noop}
      onImageChange={noop}
      onNetworkChange={noop}
      readOnly
    />
  );

  assert.match(html, PRIVATE_ADDRESS_RE);
  assert.match(html, PRIVATE_ADDRESS_DEFAULT_VALUE_RE);
  assert.match(html, DOMAIN_LIST_RE);
  assert.match(html, PUBLIC_ADDRESS_VALUE_RE);
  assert.match(html, COPY_PRIVATE_ADDRESS_RE);
  assert.match(html, COPY_PUBLIC_ADDRESS_RE);
  assert.match(html, PUBLIC_ADDRESS_LINK_RE);
  assert.doesNotMatch(html, ADD_PUBLIC_ADDRESS_RE);
  assert.doesNotMatch(html, DELETE_PUBLIC_ADDRESS_RE);
});

test("AP network preserves WebSocket and web addresses on separate ports", async () => {
  const dom = await installTestDom();
  const previous = setActEnvironment(true);
  const consoleError = spyOn(console, "error").mockImplementation(
    () => undefined
  );
  const content = (
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      network={{
        appListeningPorts: [
          {
            port: 5200,
            privateAddress: "ws://game.demo.svc.cluster.local:5200",
          },
          {
            port: 5201,
            privateAddress: "http://game.demo.svc.cluster.local:5201",
          },
        ],
        privatePort: 5200,
        publicAddresses: [
          {
            host: "game.example.com",
            port: 5200,
            status: "accessible",
            url: "wss://game.example.com/",
          },
          {
            host: "game.example.com",
            port: 5201,
            status: "accessible",
            url: "https://game.example.com/",
          },
        ],
      }}
      onEnvChange={noop}
      onImageChange={noop}
      onNetworkChange={noop}
      readOnly
    />
  );
  const view = render(content);
  try {
    assert.ok(view.getByText("wss://game.example.com/"));
    assert.ok(view.getByText("https://game.example.com/"));
    assert.ok(view.getByText("ws://game.demo.svc.cluster.local:5200"));
    assert.equal(
      view.container.querySelector('a[href="wss://game.example.com/"]'),
      null
    );
    assert.ok(
      view.container.querySelector('a[href="https://game.example.com/"]')
    );
    const webRow = view.getByText("https://game.example.com/");
    const socketRow = view.getByText("wss://game.example.com/");
    view.rerender(
      <TestApSettingsSections
        {...content.props}
        network={{
          ...content.props.network,
          publicAddresses: [...content.props.network.publicAddresses].reverse(),
        }}
      />
    );
    assert.equal(view.getByText("https://game.example.com/"), webRow);
    assert.equal(view.getByText("wss://game.example.com/"), socketRow);
    assert.equal(consoleError.mock.calls.length, 0);
  } finally {
    consoleError.mockRestore();
    view.unmount();
    restoreActEnvironment(previous);
    await dom.restore();
  }
});

/** Happy DOM needs focus + input + keyUp for React's change fallback to fire. */
function typeIntoInput(input: HTMLInputElement, value: string) {
  fireEvent.focus(input);
  fireEvent.input(input, { target: { value } });
  fireEvent.keyUp(input, { key: value.at(-1) ?? "" });
}

const MINIO_NETWORK = {
  appListeningPorts: [
    {
      displayName: "S3 API",
      port: 9000,
      privateAddress: "http://minio.default.svc:9000",
    },
    {
      displayName: "Console",
      port: 9001,
      privateAddress: "http://minio.default.svc:9001",
    },
  ],
  defaultOpenPort: 9001,
  privateAddress: "http://minio.default.svc:9000",
  privatePort: 9000,
  publicAddresses: [
    {
      host: "s3.example.com",
      id: "pa_s3",
      port: 9000,
      status: "accessible",
      type: "platform",
      url: "https://s3.example.com/",
    },
    {
      host: "console.example.com",
      id: "pa_console",
      port: 9001,
      status: "accessible",
      type: "platform",
      url: "https://console.example.com/",
    },
  ],
};

const TWO_PORT_NETWORK = {
  appListeningPorts: [
    { port: 5200, privateAddress: "http://game.default.svc:5200" },
    {
      displayName: "admin",
      port: 5201,
      privateAddress: "http://game.default.svc:5201",
    },
  ],
  privateAddress: "http://game.default.svc:5200",
  privatePort: 5200,
  publicAddresses: [
    {
      host: "game-admin.example.com",
      id: "pa_admin",
      port: 5201,
      status: "accessible",
      type: "platform",
      url: "https://game-admin.example.com/",
    },
  ],
};

test("AP settings pane lists App Listening Ports with their display names and domain counts", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      network={TWO_PORT_NETWORK}
      onEnvChange={noop}
      onImageChange={noop}
      onNetworkChange={noop}
    />
  );

  assert.match(html, APP_LISTENING_PORTS_CARD_RE);
  assert.doesNotMatch(html, PRIVATE_ADDRESSES_CARD_RE);
  assert.match(html, PORT_5200_NO_DOMAINS_RE);
  assert.match(html, PORT_5201_ADMIN_DETAIL_RE);
  assert.match(html, RENAME_PORT_5201_RE);
  assert.match(html, DOMAIN_5201_ADMIN_DETAIL_RE);
  assert.doesNotMatch(html, KIND_LABEL_OR_PLACEHOLDER_RE);
});

test("App Listening Port name form trims on Done and submits on Enter", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  try {
    const submitted: string[] = [];
    let rendered: ReturnType<typeof render> | undefined;
    await actAndDrain(() => {
      rendered = render(
        <AppListeningPortNameForm
          displayName="admin"
          onCancel={noop}
          onSubmit={(displayName) => {
            submitted.push(displayName);
          }}
          port={5201}
          takenNames={new Map([["admin", 5201]])}
        />
      );
    });
    const view = rendered;
    if (view === undefined) {
      assert.fail("expected the form to render");
    }
    const input = view.getByLabelText("Name") as HTMLInputElement;
    assert.equal(input.value, "admin");
    assert.equal(input.maxLength, 64);
    assert.match(view.container.innerHTML, PORT_NAME_FORM_HEADER_RE);

    await actAndDrain(() => {
      typeIntoInput(input, "  Admin console  ");
    });
    await actAndDrain(() => {
      view.getByText("Done").click();
    });
    assert.deepEqual(submitted, ["Admin console"]);

    await actAndDrain(() => {
      typeIntoInput(input, "Console");
    });
    await actAndDrain(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    assert.deepEqual(submitted, ["Admin console", "Console"]);
  } finally {
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
});

test("App Listening Port name form refuses a name another port already uses and cancels on Escape", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  try {
    const submitted: string[] = [];
    let cancelled = 0;
    let rendered: ReturnType<typeof render> | undefined;
    await actAndDrain(() => {
      rendered = render(
        <AppListeningPortNameForm
          displayName={undefined}
          onCancel={() => {
            cancelled += 1;
          }}
          onSubmit={(displayName) => {
            submitted.push(displayName);
          }}
          port={5200}
          takenNames={new Map([["admin", 5201]])}
        />
      );
    });
    const view = rendered;
    if (view === undefined) {
      assert.fail("expected the form to render");
    }
    const input = view.getByLabelText("Name") as HTMLInputElement;
    assert.equal(input.value, "");
    await actAndDrain(() => {
      typeIntoInput(input, "admin");
    });
    await actAndDrain(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    assert.match(view.container.innerHTML, PORT_NAME_TAKEN_RE);
    assert.deepEqual(submitted, []);

    await actAndDrain(() => {
      fireEvent.keyDown(view.getByLabelText("Name"), { key: "Escape" });
    });
    assert.equal(cancelled, 1);
  } finally {
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
});

test("AP network draft controller renames a port into the draft and marks it dirty", () => {
  let committed:
    | Parameters<typeof useApNetworkDraftController>[0]["network"]
    | undefined;
  function Harness() {
    const controller = useApNetworkDraftController({
      network: TWO_PORT_NETWORK,
      onNetworkChange: (next) => {
        committed = next;
      },
    });
    controller.renameAppListeningPort(5201, "  Admin console  ");
    return null;
  }
  renderToStaticMarkup(<Harness />);

  if (committed === undefined) {
    assert.fail("expected the controller to commit a network");
  }
  assert.equal(apNetworksEqual(TWO_PORT_NETWORK, committed), false);
  assert.equal(
    apNetworkSaveDraftFromNetwork(committed).appListeningPorts[1]?.displayName,
    "Admin console"
  );
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      network={committed}
      onEnvChange={noop}
      onImageChange={noop}
      onNetworkChange={noop}
    />
  );
  assert.match(html, PORT_5201_RENAMED_DETAIL_RE);
  assert.match(html, DOMAIN_5201_RENAMED_DETAIL_RE);
});

function TestPublicAccessNodeSettings(
  props: Parameters<typeof useApPublicAddressesSettingsSections>[0]
) {
  const model = useApPublicAddressesSettingsSections(props);
  return (
    <div data-slot="public-access-node-settings-test-wrapper">
      {model.sections.map((section) => (
        <ResourceSettingsSection
          actions={section.actions}
          icon={section.icon}
          key={section.id}
          title={section.title}
        >
          {section.content}
        </ResourceSettingsSection>
      ))}
      {model.footer}
    </div>
  );
}

test("Public Access Node settings view renders both Network cards under one Network section", () => {
  const html = renderToStaticMarkup(
    <TestPublicAccessNodeSettings
      network={TWO_PORT_NETWORK}
      onNetworkDraftCommit={noop}
    />
  );

  assert.match(html, NETWORK_SECTION_TITLE_RE);
  assert.doesNotMatch(html, PUBLIC_ADDRESSES_SECTION_TITLE_RE);
  assert.match(html, APP_LISTENING_PORTS_CARD_RE);
  assert.match(html, DOMAIN_LIST_RE);
  assert.match(html, RENAME_PORT_5201_RE);
  assert.match(html, PORT_5201_ADMIN_DETAIL_RE);
  assert.match(html, OPEN_ADMIN_ACTION_RE);
  assert.ok(
    html.indexOf("App Listening Ports") < html.indexOf("Domain List"),
    "App Listening Ports card comes first"
  );
});

test("AP network draft carries Port Display Names into the save draft", () => {
  const renamed = networkWithAppListeningPortDisplayName(
    TWO_PORT_NETWORK,
    5200,
    "  game  "
  );
  assert.deepEqual(
    renamed.appListeningPorts?.map((row) => [row.port, row.displayName]),
    [
      [5200, "game"],
      [5201, "admin"],
    ]
  );
  assert.deepEqual(apNetworkSaveDraftFromNetwork(renamed).appListeningPorts, [
    { displayName: "game", port: 5200 },
    { displayName: "admin", port: 5201 },
  ]);

  const cleared = networkWithAppListeningPortDisplayName(renamed, 5201, "");
  assert.deepEqual(apNetworkSaveDraftFromNetwork(cleared).appListeningPorts, [
    { displayName: "game", port: 5200 },
    { port: 5201 },
  ]);
  assert.notEqual(
    JSON.stringify(apNetworkSaveDraftFromNetwork(cleared)),
    JSON.stringify(apNetworkSaveDraftFromNetwork(renamed))
  );
});

test("Network section header opens the Default Open Port and greys out while nothing is accessible", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/minio:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      network={MINIO_NETWORK}
      onEnvChange={noop}
      onImageChange={noop}
      onNetworkChange={noop}
    />
  );
  assert.match(html, OPEN_CONSOLE_ACTION_RE);

  const automatic = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      network={TWO_PORT_NETWORK}
      onEnvChange={noop}
      onImageChange={noop}
      onNetworkChange={noop}
    />
  );
  assert.match(automatic, OPEN_ADMIN_ACTION_RE);

  const pending = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      network={{
        privatePort: 8080,
        publicAddresses: [
          { id: "pa_new", port: 8080, status: "progressing", type: "platform" },
        ],
      }}
      onEnvChange={noop}
      onImageChange={noop}
      onNetworkChange={noop}
    />
  );
  assert.match(pending, OPEN_DISABLED_ACTION_RE);
});

test("AP network draft controller stores and clears the Default Open Port; the header follows the draft", () => {
  const commits: Parameters<
    typeof useApNetworkDraftController
  >[0]["network"][] = [];
  function Harness({ port }: { port: number | null }) {
    const controller = useApNetworkDraftController({
      network: MINIO_NETWORK,
      onNetworkChange: (next) => {
        commits.push(next);
      },
    });
    controller.setDefaultOpenPort(port);
    return null;
  }
  renderToStaticMarkup(<Harness port={9000} />);
  renderToStaticMarkup(<Harness port={null} />);

  const [stored, cleared] = commits;
  if (stored === undefined || cleared === undefined) {
    assert.fail("expected two committed networks");
  }
  assert.equal(stored.defaultOpenPort, 9000);
  assert.equal(apNetworksEqual(MINIO_NETWORK, stored), false);
  assert.equal("defaultOpenPort" in cleared, false);
  assert.equal(apNetworksEqual(MINIO_NETWORK, cleared), false);

  // Stored 9001 opens the Console; stored 9000 and the automatic rule
  // (first declared port) both open the S3 API.
  assert.equal(apNetworkOpenTarget(MINIO_NETWORK)?.label, "Open Console");
  assert.equal(apNetworkOpenTarget(stored)?.label, "Open S3 API");
  assert.equal(apNetworkOpenTarget(cleared)?.label, "Open S3 API");
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/minio:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      network={stored}
      onEnvChange={noop}
      onImageChange={noop}
      onNetworkChange={noop}
    />
  );
  assert.match(html, OPEN_S3_ACTION_RE);
});

test("Open by default is offered only while at least two ports have HTTP addresses", () => {
  assert.deepEqual(apNetworkOpenByDefaultPorts(MINIO_NETWORK), [9000, 9001]);
  assert.deepEqual(apNetworkOpenByDefaultPorts(TWO_PORT_NETWORK), []);
  assert.deepEqual(
    apNetworkOpenByDefaultPorts({
      ...MINIO_NETWORK,
      publicAddresses: [
        ...MINIO_NETWORK.publicAddresses.slice(0, 1),
        {
          host: "events.example.com",
          id: "pa_events",
          port: 9001,
          status: "accessible",
          type: "platform",
          url: "wss://events.example.com/",
        },
      ],
    }),
    []
  );
});

test("AP network draft carries the Default Open Port into the save draft and drops it with its port", () => {
  assert.equal(
    apNetworkSaveDraftFromNetwork(MINIO_NETWORK).defaultOpenPort,
    9001
  );
  assert.equal(
    apNetworkSaveDraftFromNetwork(
      networkWithDefaultOpenPort(MINIO_NETWORK, 9000)
    ).defaultOpenPort,
    9000
  );
  assert.equal(
    "defaultOpenPort" in
      apNetworkSaveDraftFromNetwork(
        networkWithDefaultOpenPort(MINIO_NETWORK, null)
      ),
    false
  );
  assert.equal(
    "defaultOpenPort" in
      apNetworkSaveDraftFromNetwork(
        networkWithDefaultOpenPort(MINIO_NETWORK, 9002)
      ),
    false
  );
  assert.equal(
    "defaultOpenPort" in
      apNetworkSaveDraftFromNetwork(
        networkWithoutAppListeningPort(MINIO_NETWORK, 9001)
      ),
    false
  );
});

test("read-only AP settings view cannot mutate environment rows", () => {
  const html = renderPane(true);

  assert.match(html, ENV_ROWS_SLOT_RE);
  assert.match(html, DATABASE_URL_RE);
  assert.doesNotMatch(html, ADD_ENV_RE);
  assert.doesNotMatch(html, ENV_ROW_ACTIONS_RE);
  assert.doesNotMatch(html, SAVE_ENV_RE);
});

test("AP settings pane offers DB references from editable environment rows", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      addDbDsnReferenceIntent={{
        dbName: "postgres",
        dbNamespace: "default",
        id: "drag-1",
      }}
      cpuQuota={{ onValueChange: noop, value: 1 }}
      dbDsnReferenceSources={[
        {
          name: "empty",
          namespace: "default",
        },
        {
          name: "postgres",
          namespace: "default",
          privateDsn: "postgres://private",
          primitiveSecretRefs: {
            password: {
              key: "passwd",
              name: "postgres-conn-credential",
            },
          },
        },
      ]}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
    />
  );

  assert.doesNotMatch(html, INLINE_REFERENCE_TRIGGER_RE);
  assert.match(html, TOKEN_TRIGGER_RE);
  assert.doesNotMatch(html, REFERENCE_SELECTOR_RE);
  assert.doesNotMatch(html, REFERENCE_DB_LABEL_RE);

  const readOnlyHtml = renderPane(true);

  assert.doesNotMatch(readOnlyHtml, INLINE_REFERENCE_TRIGGER_RE);
  assert.doesNotMatch(readOnlyHtml, REFERENCE_SELECTOR_RE);
});

test("AP settings pane hides DB Reference selector before saved row edit mode", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      dbDsnReferenceSources={[{ name: "postgres", namespace: "default" }]}
      env={[{ name: "DATABASE_URL", value: "postgres://db:5432/app" }]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onEnvResolvedValue={async () => "postgres://db:5432/app"}
      onImageChange={noop}
    />
  );

  assert.match(html, MASKED_ENV_VALUE_RE);
  assert.match(html, REVEAL_ENV_VALUE_RE);
  assert.match(html, COPY_ENV_VALUE_RE);
  assert.match(html, ENV_ROW_ACTIONS_RE);
  assert.match(html, CANVAS_NODE_ACTION_MENU_TRIGGER_RE);
  assert.match(html, ENV_ROW_ACTIONS_SECONDARY_TRIGGER_RE);
  assert.doesNotMatch(html, ENV_NAME_INPUT_RE);
  assert.doesNotMatch(html, EDIT_ENV_RE);
  assert.doesNotMatch(html, INLINE_REFERENCE_TRIGGER_RE);
  assert.doesNotMatch(html, REFERENCE_SELECTOR_RE);
});

test("AP settings pane projects valueFrom-only environment rows out of raw direct source", () => {
  const html = renderPane(false, [
    {
      dbDsn: {
        dbName: "postgres",
        dbNamespace: "default",
        field: "password",
      },
      name: "DATABASE_PASSWORD",
      value: "(valueFrom)",
      valueFrom: {
        secretKeyRef: {
          key: "passwd",
          name: "postgres-conn-credential",
        },
      },
      valueSource: "dbDsn",
    },
  ]);

  assert.doesNotMatch(html, INLINE_REFERENCE_TRIGGER_RE);
  assert.doesNotMatch(html, TOKEN_TRIGGER_RE);
  assert.doesNotMatch(html, REFERENCE_SELECTOR_RE);
  assert.doesNotMatch(html, EXTERNAL_REFERENCE_RE);
  assert.doesNotMatch(html, REFERENCE_DB_LABEL_RE);
  assert.doesNotMatch(html, DB_FIELD_SELECT_RE);
});

test("AP settings pane renders raw direct rows instead of automatic helper rows", () => {
  const html = renderPane(false, [
    {
      name: "DATABASE_URL",
      referenceDbKey: "default/postgres",
      value: editorToken("PGPASSWORD"),
    },
    {
      dbDsn: {
        dbName: "postgres",
        dbNamespace: "default",
        field: "password",
      },
      helper: {
        automatic: true,
        sourceDbKey: "default/postgres",
        sourceField: "password",
      },
      name: "PGPASSWORD",
      value: "(valueFrom)",
      valueFrom: {
        secretKeyRef: {
          key: "passwd",
          name: "postgres-conn-credential",
        },
      },
      valueSource: "dbDsn",
    },
  ]);

  assert.doesNotMatch(html, INLINE_REFERENCE_TRIGGER_RE);
  assert.doesNotMatch(html, TOKEN_TRIGGER_RE);
  assert.equal(html.match(ENV_ROW_ACTIONS_RE_GLOBAL)?.length, 1);
  assert.doesNotMatch(html, EXTERNAL_REFERENCE_RE);
  assert.doesNotMatch(html, VALUE_FROM_PLACEHOLDER_RE);
});

test("AP settings pane opens dragged DB Add Reference intent preselected", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      addDbDsnReferenceIntent={{
        dbName: "mysql",
        dbNamespace: "default",
        id: "drag-1",
      }}
      cpuQuota={{ onValueChange: noop, value: 1 }}
      dbDsnReferenceSources={[
        {
          name: "postgres",
          namespace: "default",
          privateDsn: "postgres://private",
        },
        {
          name: "mysql",
          namespace: "default",
          privateDsn: "mysql://private",
          primitiveSecretRefs: {
            host: { key: "endpoint", name: "mysql-conn-credential" },
            password: { key: "passwd", name: "mysql-conn-credential" },
            port: { key: "port", name: "mysql-conn-credential" },
            username: { key: "user", name: "mysql-conn-credential" },
          },
        },
      ]}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
    />
  );

  assert.match(html, DATABASE_URL_RE);
  assert.match(html, MYSQL_DATABASE_URL_REFERENCE_RE);
  assert.doesNotMatch(html, MYSQL_PRIVATE_DSN_RE);
  assert.doesNotMatch(html, REFERENCE_SELECTOR_RE);
  assert.doesNotMatch(html, REFERENCE_DB_LABEL_RE);
  assert.match(html, TOKEN_TRIGGER_RE);
  assert.doesNotMatch(html, DB_FIELD_SELECT_RE);
  assert.match(html, SAVE_ENV_RE);
});

test("AP settings pane appends dragged DB Add Reference intent to raw source", () => {
  const draft = envRawSourceDraftWithAddReferenceIntent({
    intent: {
      dbName: "mysql",
      dbNamespace: "default",
      id: "drag-1",
    },
    rawSource: "# app\nFEATURE_FLAG=true",
    readOnly: false,
    sources: [
      {
        name: "mysql",
        namespace: "default",
        privateDsn: "mysql://private",
      },
    ],
  });

  assert.equal(
    draft.rawSource,
    [
      "# app",
      "FEATURE_FLAG=true",
      `DATABASE_URL=${referenceExpression("mysql", "DATABASE_URL")}`,
    ].join("\n")
  );
  assert.deepEqual(draft.rows, [
    { name: "FEATURE_FLAG", value: "true" },
    {
      canvasAddDbDsnReferenceIntentId: "drag-1",
      name: "DATABASE_URL",
      referenceDbKey: "default/mysql",
      value: referenceExpression("mysql", "DATABASE_URL"),
    },
  ]);
});

test("AP settings pane uses DB identity and numeric suffixes for dragged DB reference name conflicts", () => {
  const draft = envRawSourceDraftWithAddReferenceIntent({
    intent: {
      dbName: "mysql",
      dbNamespace: "default",
      id: "drag-1",
    },
    rawSource: [
      "DATABASE_URL=postgres://manual",
      "MYSQL_DATABASE_URL=mysql://manual",
    ].join("\n"),
    readOnly: false,
    sources: [
      {
        name: "mysql",
        namespace: "default",
      },
    ],
  });

  assert.equal(
    draft.rawSource,
    [
      "DATABASE_URL=postgres://manual",
      "MYSQL_DATABASE_URL=mysql://manual",
      `MYSQL_DATABASE_URL_2=${referenceExpression("mysql", "DATABASE_URL")}`,
    ].join("\n")
  );
});

test("AP settings pane derives pending DB references from explicit raw source references", () => {
  assert.deepEqual(
    pendingDbReferencesFromEnvRawSourceDraft({
      committedRawSource: "FEATURE_FLAG=true",
      draftRawSource: [
        "FEATURE_FLAG=true",
        `DATABASE_URL=${referenceExpression("mysql", "DATABASE_URL")}`,
        `MYSQL_HOST=${referenceExpression("mysql", "PG_HOST")}`,
      ].join("\n"),
      sources: [
        {
          name: "mysql",
          namespace: "default",
          primitiveSecretRefs: {
            host: { key: "host", name: "mysql-conn-credential" },
          },
        },
        { name: "postgres", namespace: "default" },
      ],
    }),
    [{ dbName: "mysql", dbNamespace: "default" }]
  );
});

test("AP settings pane does not derive pending DB references from already committed references", () => {
  assert.deepEqual(
    pendingDbReferencesFromEnvRawSourceDraft({
      committedRawSource: `DATABASE_URL=${referenceExpression(
        "mysql",
        "DATABASE_URL"
      )}`,
      draftRawSource: [
        `DATABASE_URL=${referenceExpression("mysql", "DATABASE_URL")}`,
        "FEATURE_FLAG=true",
      ].join("\n"),
      sources: [{ name: "mysql", namespace: "default" }],
    }),
    []
  );
});

test("AP settings pane does not derive pending DB references from ordinary DSN strings", () => {
  assert.deepEqual(
    pendingDbReferencesFromEnvRawSourceDraft({
      committedRawSource: "",
      draftRawSource: "DATABASE_URL=mysql://private",
      sources: [
        {
          name: "mysql",
          namespace: "default",
          privateDsn: "mysql://private",
        },
      ],
    }),
    []
  );
});

test("AP settings pane derives pending DB references for newly referenced DBs only", () => {
  assert.deepEqual(
    pendingDbReferencesFromEnvRawSourceDraft({
      committedRawSource: `DATABASE_URL=${referenceExpression(
        "mysql",
        "DATABASE_URL"
      )}`,
      draftRawSource: [
        `DATABASE_URL=${referenceExpression("mysql", "DATABASE_URL")}`,
        `CACHE_URL=${referenceExpression("redis", "DATABASE_URL")}`,
      ].join("\n"),
      sources: [
        { name: "mysql", namespace: "default" },
        { name: "redis", namespace: "default" },
      ],
    }),
    [{ dbName: "redis", dbNamespace: "default" }]
  );
});

test("AP settings pane leaves pending DB references unchanged for invalid raw source drafts", () => {
  assert.equal(
    pendingDbReferencesFromEnvRawSourceDraft({
      committedRawSource: "",
      draftRawSource: `DATABASE_URL=${referenceExpression(
        "missing",
        "DATABASE_URL"
      )}`,
      sources: [{ name: "mysql", namespace: "default" }],
    }),
    undefined
  );
});

test("AP settings pane reports confirmed dragged DB reference rows from the saved draft", () => {
  const sourceRow = {
    canvasAddDbDsnReferenceIntentId: "drag-1",
    name: "DATABASE_URL",
    referenceDbKey: "default/mysql",
    value: `mysql://${editorToken("MYSQL_PRIVATE_DSN")}`,
  } satisfies ApEnvVar & { canvasAddDbDsnReferenceIntentId: string };
  const helperRow = {
    helper: {
      automatic: true,
      sourceDbKey: "default/mysql",
      sourceField: "private",
    },
    name: "MYSQL_PRIVATE_DSN",
    value: "mysql://private",
    valueSource: "dbDsn",
  } satisfies ApEnvVar;

  assert.deepEqual(
    confirmedAddDbDsnReferencesFromEnvDraft([sourceRow, helperRow]),
    [{ dbName: "mysql", dbNamespace: "default", id: "drag-1" }]
  );
});

test("AP settings draft detects dirty AP settings and restored state", () => {
  const original = {
    cpuCores: 1,
    env: [{ name: "DATABASE_URL", value: "postgres://old" }],
    image: "ghcr.io/acme/api:old",
    memoryMib: 1024,
    network: {
      privatePort: 80,
      publicAddresses: [{ id: "pa_old123", port: 80 }],
    },
    replicaStrategy: {
      fixed: { replicas: 2 },
      type: "fixed",
    },
  } satisfies Parameters<typeof apSettingsDraftIsDirty>[0];

  assert.equal(apSettingsDraftIsDirty(original, original), false);
  assert.equal(
    apSettingsDraftIsDirty(original, {
      ...original,
      args: ["--port", "8080"],
      command: ["/app/server"],
      configMaps: [{ path: "/etc/app/config.yaml", value: "debug: false" }],
      env: [...original.env, { name: "FEATURE_FLAG", value: "true" }],
      image: "ghcr.io/acme/api:new",
      network: {
        privatePort: 8080,
        publicAddresses: [
          { id: "pa_old123", port: 80 },
          { id: "pa_new456", port: 9000 },
        ],
      },
      replicaStrategy: {
        elastic: {
          maxReplicas: 8,
          minReplicas: 2,
          target: {
            metric: "cpu",
            type: "utilization",
            utilizationPercent: 75,
          },
        },
        fixed: { replicas: 2 },
        type: "elastic",
      },
      storage: [{ path: "/data", size: "20Gi" }],
      workloadKind: "statefulset",
    }),
    true
  );
  assert.equal(apSettingsDraftIsDirty(original, { ...original }), false);
});

test("AP settings draft ignores env rows that raw source cannot express", () => {
  const original = {
    cpuCores: 1,
    env: [
      { name: "FEATURE_FLAG", value: "true" },
      {
        name: "SECRET_TOKEN",
        value: "",
        valueFrom: { secretKeyRef: { key: "token", name: "app-secret" } },
        valueSource: "valueFrom" as const,
      },
    ],
    envRawSource: "FEATURE_FLAG=true",
    image: "ghcr.io/acme/api:old",
    memoryMib: 1024,
  } satisfies Parameters<typeof apSettingsDraftIsDirty>[0];
  const rawProjectedDraft = {
    ...original,
    env: [{ name: "FEATURE_FLAG", value: "true" }],
  };

  assert.equal(apSettingsDraftIsDirty(original, rawProjectedDraft), false);
  assert.equal(
    apSettingsDraftIsDirty(original, {
      ...rawProjectedDraft,
      env: [{ name: "FEATURE_FLAG", value: "false" }],
      envRawSource: "FEATURE_FLAG=false",
    }),
    true
  );
});

test("AP settings pane renders Launchpad-backed command config and storage fields", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      args={["--config", "/etc/app/config.yaml"]}
      command={["/app/server"]}
      configMaps={[{ path: "/etc/app/config.yaml", value: "debug: false" }]}
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
      onSettingsDraftCommit={noop}
      storage={[{ path: "/data", size: "20Gi" }]}
      workloadKind="statefulset"
    />
  );

  assert.match(html, LAUNCH_COMMAND_RE);
  assert.match(html, CONFIG_FILES_RE);
  assert.match(html, STORAGE_RE);
  assert.match(html, AP_COMMAND_RE);
  assert.match(html, CONFIG_FILE_EDIT_RE);
  assert.match(html, CONFIG_FILE_DELETE_RE);
  assert.match(html, CONFIG_FILE_EDIT_SECONDARY_RE);
  assert.match(html, CONFIG_FILE_DELETE_DANGER_RE);
  assert.doesNotMatch(html, CONFIG_FILE_DELETE_TEXT_RE);
  assert.match(html, STORAGE_SIZE_RE);
  assert.match(html, CONFIG_FILE_MOUNT_PATH_RE);
  assert.match(html, CONFIG_FILE_PREVIEW_RE);
  assert.match(html, STORAGE_SIZE_VALUE_RE);
});

test("configMapDuplicatePaths flags only repeated non-empty mount paths", () => {
  assert.deepEqual(
    [
      ...configMapDuplicatePaths([
        { path: "/etc/app/a.yaml", value: "1" },
        { path: "/etc/app/a.yaml", value: "2" },
        { path: "/etc/app/b.yaml", value: "3" },
        { path: "  ", value: "4" },
        { path: "", value: "5" },
      ]),
    ],
    ["/etc/app/a.yaml"]
  );
  assert.equal(configMapDuplicatePaths([]).size, 0);
  assert.equal(configMapDuplicatePaths([{ path: "", value: "x" }]).size, 0);
});

test("configFileContentPreview returns the first non-empty trimmed line", () => {
  assert.equal(configFileContentPreview(""), "");
  assert.equal(configFileContentPreview("\n\n  \n"), "");
  assert.equal(
    configFileContentPreview("\n  debug: true\nkey: v"),
    "debug: true"
  );
  assert.equal(configFileContentPreview("key: value"), "key: value");
});

test("AP settings pane overlays accepted pending settings targets", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  try {
    const owner = {
      clusterFingerprint: "stable:test-cluster",
      kind: "ap" as const,
      name: "api",
      namespace: "default",
    };
    createPendingSettingsStore({
      now: () => 1000,
      storage: window.localStorage,
    }).replaceDirtyDomains({
      owner,
      updates: [
        {
          domain: "launch",
          submittedAgainst: {
            args: [],
            command: [],
            configMaps: [],
            image: "ghcr.io/acme/api:latest",
            storage: [],
            workloadKind: "deployment",
          },
          target: {
            args: [],
            command: [],
            configMaps: [],
            image: "ghcr.io/acme/api:pending",
            storage: [],
            workloadKind: "deployment",
          },
        },
      ],
    });
    const element = (
      <TestApSettingsSections
        cpuQuota={{ onValueChange: noop, value: 1 }}
        env={[]}
        image="ghcr.io/acme/api:latest"
        memoryQuota={{ onValueChange: noop, value: 512 }}
        onEnvChange={noop}
        onImageChange={noop}
        onSettingsDraftCommit={noop}
        submissionOwner={owner}
      />
    );

    // Server markup omits browser-local pending state, so hydration matches
    // SSR; the overlay arrives through the store snapshot on the client.
    assert.doesNotMatch(renderToStaticMarkup(element), PENDING_AP_IMAGE_RE);

    let rendered: ReturnType<typeof render> | undefined;
    await actAndDrain(() => {
      rendered = render(element);
    });
    assert.match(rendered?.container.innerHTML ?? "", PENDING_AP_IMAGE_RE);
    await actAndDrain(() => {
      rendered?.unmount();
    });
  } finally {
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
});

test("AP settings pane exposes panel-level draft actions without environment save controls", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      addDbDsnReferenceIntent={{
        dbName: "mysql",
        dbNamespace: "default",
        id: "drag-1",
      }}
      cpuQuota={{ onValueChange: noop, value: 1 }}
      dbDsnReferenceSources={[
        {
          name: "mysql",
          namespace: "default",
          privateDsn: "mysql://private",
        },
      ]}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
      onSettingsDraftCommit={noop}
    />
  );

  assert.match(html, UPDATE_AP_SETTINGS_RE);
  assert.match(html, DISCARD_AP_SETTINGS_RE);
  assert.doesNotMatch(html, SAVE_ENV_RE);
  assert.doesNotMatch(html, CANCEL_ENV_RE);
});

test("AP settings pane can focus only Environment Variables", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[{ name: "DATABASE_URL", value: "postgres://db" }]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      network={{
        privatePort: 8080,
        publicAddresses: [],
      }}
      onEnvChange={noop}
      onImageChange={noop}
      onSettingsDraftCommit={noop}
      sectionFocus="environment"
    />
  );

  assert.match(html, ENV_ROWS_SLOT_RE);
  assert.match(html, UPDATE_ENVIRONMENT_VARIABLES_RE);
  assert.doesNotMatch(html, CPU_MEMORY_SECTION_RE);
  assert.doesNotMatch(html, IMAGE_INPUT_RE);
  assert.doesNotMatch(html, PRIVATE_ADDRESS_RE);
});

test("AP settings raw editor omits fixed raw footer actions", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      addDbDsnReferenceIntent={{
        dbName: "mysql",
        dbNamespace: "default",
        id: "drag-1",
      }}
      cpuQuota={{ onValueChange: noop, value: 1 }}
      dbDsnReferenceSources={[{ name: "mysql", namespace: "default" }]}
      env={[{ name: "DATABASE_URL", value: "postgres://db" }]}
      envRawSource="BROKEN"
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
    />
  );

  assert.match(html, ENV_RAW_SOURCE_RE);
  assert.match(html, RAW_ENV_ROWS_OVERFLOW_VISIBLE_RE);
  assert.doesNotMatch(html, COPY_RAW_SOURCE_RE);
  assert.doesNotMatch(html, INSERT_RAW_REFERENCE_RE);
  assert.doesNotMatch(html, COPY_ENV_VALUE_RE);
});

test("AP settings raw editor keeps the mode toggle but hides Add", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[{ name: "DATABASE_URL", value: "postgres://db" }]}
      envRawSource="BROKEN"
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
    />
  );

  assert.match(html, ENV_RAW_SOURCE_RE);
  assert.match(html, ENV_EDITOR_MODE_RE);
  assert.doesNotMatch(html, ADD_ENV_RE);
});

test("AP settings pane shows per-row Save/Cancel for an editing environment row", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      addDbDsnReferenceIntent={{
        dbName: "postgres",
        dbNamespace: "default",
        id: "drag-1",
      }}
      cpuQuota={{ onValueChange: noop, value: 1 }}
      dbDsnReferenceSources={[{ name: "postgres", namespace: "default" }]}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
    />
  );

  assert.match(html, EDITING_ENV_ROW_RE);
  assert.match(html, ENV_NAME_INPUT_RE);
  assert.match(html, PER_ROW_CANCEL_ENV_RE);
  assert.match(html, PER_ROW_SAVE_ENV_RE);
});

test("AP settings pane renders committed environment rows collapsed without per-row actions", () => {
  const html = renderToStaticMarkup(
    <TestApSettingsSections
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[{ name: "DATABASE_URL", value: "postgres://db" }]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
    />
  );

  assert.match(html, ENV_ROW_ACTIONS_RE);
  assert.doesNotMatch(html, EDITING_ENV_ROW_RE);
  assert.doesNotMatch(html, PER_ROW_CANCEL_ENV_RE);
  assert.doesNotMatch(html, PER_ROW_SAVE_ENV_RE);
});
