import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import type {
  ContainerEnvVar,
  ContainerReplicaStrategy,
} from "./container-settings-pane";
import {
  ContainerSettingsPane,
  confirmedAddDbDsnReferencesFromEnvDraft,
  containerNetworkAfterBindCustomDomain,
  containerNetworkAfterEditPublicAddress,
  containerNetworkAfterUnbindCustomDomain,
  containerSettingsDraftIsDirty,
  resourceQuotaReplicaPatchFromDraft,
} from "./container-settings-pane";

const noop = () => {
  /* test noop */
};

function editorToken(name: string): string {
  return ["$", "{{", name, "}}"].join("");
}

const ENV_ROWS_SLOT_RE = /data-slot="container-env-rows"/;
const ENV_NAME_INPUT_RE = /aria-label="Environment variable name"/;
const ENV_VALUE_INPUT_RE = /aria-label="Environment variable value"/;
const RAW_ENV_EDITOR_RE = /Edit environment variables/;
const DATABASE_URL_RE = /DATABASE_URL/;
const ADD_ENV_RE = /aria-label="Add environment variable"/;
const REFERENCE_DB_RE = /aria-label="Reference DB"/;
const REFERENCE_DB_LABEL_RE = /Reference DB/;
const INLINE_REFERENCE_TRIGGER_RE =
  /data-slot="container-env-reference-trigger"/;
const TOKEN_TRIGGER_RE = /data-slot="container-env-token-trigger"/;
const DB_FIELD_SELECT_RE = /aria-label="Project DB field"/;
const REMOVE_ENV_RE = /aria-label="Remove environment variable"/;
const SAVE_ENV_RE = /Save environment/;
const UPDATE_AP_SETTINGS_RE = /aria-label="Update AP Settings"/;
const CANCEL_ENV_RE = /Cancel environment changes/;
const DISCARD_AP_SETTINGS_RE = /aria-label="Discard AP Settings changes"/;
const CPU_MEMORY_SECTION_RE = /CPU \/ Memory/;
const IMAGE_INPUT_RE = /aria-label="Container image"/;
const NEW_VARIABLE_RE = /value="NEW_VARIABLE"/;
const PRIVATE_ADDRESS_RE = /Private Address/;
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
const UNBIND_CUSTOM_DOMAIN_RE = /aria-label="Unbind Custom Domain"/;
const COPY_PUBLIC_ADDRESS_RE = /aria-label="Copy Public Address"/;
const CNAME_RE = /CNAME/;
const EDIT_PUBLIC_ADDRESS_RE = /aria-label="Edit Public Address"/;
const DELETE_PUBLIC_ADDRESS_RE = /aria-label="Delete Public Address"/;
const ADD_PUBLIC_ADDRESS_RE = /aria-label="Add Public Address"/;
const ADD_DOMAIN_LABEL_RE = /Add Domain/;
const VIEW_ALL_PUBLIC_ADDRESSES_RE = /aria-label="View All Public Addresses"/;
const PUBLIC_ADDRESSES_COLLAPSED_RE = /aria-expanded="false"/;
const SHOW_LESS_PUBLIC_ADDRESSES_RE = /aria-label="Show Less Public Addresses"/;
const INLINE_END_ICON_RE = /data-icon="inline-end"/;
const CURSOR_POINTER_RE = /cursor-pointer/;
const PRIVATE_PORT_VALUE_RE = />8080</;
const REPLICA_STRATEGY_RE = /Replica Strategy/;
const FIXED_REPLICAS_RE = /Fixed Replicas/;
const ELASTIC_SCALING_RE = /Elastic Scaling/;
const REPLICA_COUNT_RE = /Number of Replicas/;
const REPLICA_VALUE_RE = />4</;
const MIN_REPLICAS_RE = /Minimum replicas/;
const MIN_REPLICA_VALUE_RE = />2</;
const MAX_REPLICAS_RE = /Maximum replicas/;
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
  env: ContainerEnvVar[] = [
    { name: "DATABASE_URL", value: "postgres://db:5432/app" },
  ]
): string {
  return renderToStaticMarkup(
    <ContainerSettingsPane
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

test("container settings pane renders editable structured environment rows", () => {
  const html = renderPane();

  assert.match(html, ENV_ROWS_SLOT_RE);
  assert.match(html, ENV_NAME_INPUT_RE);
  assert.match(html, ENV_VALUE_INPUT_RE);
  assert.doesNotMatch(html, RAW_ENV_EDITOR_RE);
});

test("container settings pane renders Image below CPU / Memory", () => {
  const html = renderPane();
  const cpuMemoryIndex = html.search(CPU_MEMORY_SECTION_RE);
  const imageIndex = html.search(IMAGE_INPUT_RE);

  assert.notEqual(cpuMemoryIndex, -1);
  assert.notEqual(imageIndex, -1);
  assert.ok(cpuMemoryIndex < imageIndex);
});

test("container settings pane can hide Image section", () => {
  const html = renderToStaticMarkup(
    <ContainerSettingsPane
      cpuQuota={{ onValueChange: noop, value: 1 }}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
      showImageSection={false}
    />
  );

  assert.match(html, CPU_MEMORY_SECTION_RE);
  assert.doesNotMatch(html, IMAGE_INPUT_RE);
});

test("container settings pane shows no AP networking surface without Network data", () => {
  const html = renderToStaticMarkup(
    <ContainerSettingsPane
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

test("container settings pane renders address settings instead of Ports for private-only APs", () => {
  const html = renderToStaticMarkup(
    <ContainerSettingsPane
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

test("container settings pane renders editable public address rows", () => {
  const html = renderToStaticMarkup(
    <ContainerSettingsPane
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
  assert.doesNotMatch(html, CNAME_RE);
  assert.match(html, EDIT_PUBLIC_ADDRESS_RE);
  assert.match(html, DELETE_PUBLIC_ADDRESS_RE);
  assert.match(html, ADD_PUBLIC_ADDRESS_RE);
  assert.match(html, ADD_DOMAIN_LABEL_RE);
  assert.doesNotMatch(html, NO_PUBLIC_ADDRESSES_RE);
});

test("container settings pane collapses overflowing public address rows by default", () => {
  const html = renderToStaticMarkup(
    <ContainerSettingsPane
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

test("container settings pane renders draft-visible Platform Address hosts", () => {
  const html = renderToStaticMarkup(
    <ContainerSettingsPane
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

test("container settings pane shows Custom Domain rows instead of bound Platform Addresses", () => {
  const html = renderToStaticMarkup(
    <ContainerSettingsPane
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
  assert.doesNotMatch(html, PUBLIC_ADDRESS_VALUE_RE);
  assert.doesNotMatch(html, EDIT_PUBLIC_ADDRESS_RE);
});

test("container settings pane renders Custom Domain Binding lifecycle detail states", () => {
  const html = renderToStaticMarkup(
    <ContainerSettingsPane
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

test("container settings pane unbinds Custom Domains without deleting Platform Addresses", () => {
  const next = containerNetworkAfterUnbindCustomDomain(
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
      <ContainerSettingsPane
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

test("container settings pane binds Custom Domains and retargets the Platform Address port", () => {
  const next = containerNetworkAfterBindCustomDomain(
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
      platformAddress: {
        host: "api.example.com",
        id: "pa_abc123",
        port: 8080,
        status: "accessible",
        type: "platform",
        url: "https://api.example.com/",
      },
      platformAddressIndex: 0,
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

test("container settings pane edits Public Address ports without binding Custom Domains", () => {
  const next = containerNetworkAfterEditPublicAddress(
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
      platformAddress: {
        host: "api.example.com",
        id: "pa_abc123",
        port: 8080,
        status: "accessible",
        type: "platform",
        url: "https://api.example.com/",
      },
      platformAddressIndex: 0,
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
  assert.deepEqual(next.appListeningPorts, [{ port: 8080 }, { port: 9000 }]);
});

test("container settings pane renders fixed replica strategy controls", () => {
  const html = renderToStaticMarkup(
    <ContainerSettingsPane
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

test("container settings pane renders CPU elastic replica strategy controls", () => {
  const html = renderToStaticMarkup(
    <ContainerSettingsPane
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

test("container settings pane renders Memory elastic replica strategy controls", () => {
  const html = renderToStaticMarkup(
    <ContainerSettingsPane
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

test("container settings pane fixed save payload preserves inactive elastic branch", () => {
  const draft: ContainerReplicaStrategy = {
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

test("read-only container settings view renders fixed replica strategy without mutation controls", () => {
  const html = renderToStaticMarkup(
    <ContainerSettingsPane
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

test("read-only container settings view renders CPU elastic replica strategy without mutation controls", () => {
  const html = renderToStaticMarkup(
    <ContainerSettingsPane
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

test("read-only container settings view renders Memory elastic replica strategy without mutation controls", () => {
  const html = renderToStaticMarkup(
    <ContainerSettingsPane
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
    <ContainerSettingsPane
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
  assert.doesNotMatch(html, ADD_PUBLIC_ADDRESS_RE);
  assert.doesNotMatch(html, DELETE_PUBLIC_ADDRESS_RE);
});

test("read-only container settings view cannot mutate environment rows", () => {
  const html = renderPane(true);

  assert.match(html, ENV_ROWS_SLOT_RE);
  assert.match(html, DATABASE_URL_RE);
  assert.doesNotMatch(html, ADD_ENV_RE);
  assert.doesNotMatch(html, REMOVE_ENV_RE);
  assert.doesNotMatch(html, SAVE_ENV_RE);
});

test("container settings pane offers DB references from editable environment rows", () => {
  const html = renderPane();

  assert.match(html, INLINE_REFERENCE_TRIGGER_RE);
  assert.match(html, TOKEN_TRIGGER_RE);
  assert.match(html, REFERENCE_DB_RE);
  assert.match(html, REFERENCE_DB_LABEL_RE);

  const readOnlyHtml = renderPane(true);

  assert.doesNotMatch(readOnlyHtml, INLINE_REFERENCE_TRIGGER_RE);
  assert.doesNotMatch(readOnlyHtml, REFERENCE_DB_RE);
});

test("container settings pane renders DB helper rows without old DB field selects", () => {
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

  assert.match(html, INLINE_REFERENCE_TRIGGER_RE);
  assert.match(html, TOKEN_TRIGGER_RE);
  assert.match(html, REFERENCE_DB_RE);
  assert.doesNotMatch(html, DB_FIELD_SELECT_RE);
});

test("container settings pane opens dragged DB Add Reference intent preselected", () => {
  const html = renderToStaticMarkup(
    <ContainerSettingsPane
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
        },
      ]}
      env={[]}
      image="ghcr.io/acme/api:latest"
      memoryQuota={{ onValueChange: noop, value: 512 }}
      onEnvChange={noop}
      onImageChange={noop}
    />
  );

  assert.match(html, NEW_VARIABLE_RE);
  assert.match(html, REFERENCE_DB_RE);
  assert.match(html, TOKEN_TRIGGER_RE);
  assert.doesNotMatch(html, DB_FIELD_SELECT_RE);
  assert.match(html, SAVE_ENV_RE);
});

test("container settings pane reports confirmed dragged DB reference rows from the saved draft", () => {
  const sourceRow = {
    canvasAddDbDsnReferenceIntentId: "drag-1",
    name: "DATABASE_URL",
    referenceDbKey: "default/mysql",
    value: `mysql://${editorToken("MYSQL_PRIVATE_DSN")}`,
  } satisfies ContainerEnvVar & { canvasAddDbDsnReferenceIntentId: string };
  const helperRow = {
    helper: {
      automatic: true,
      sourceDbKey: "default/mysql",
      sourceField: "private",
    },
    name: "MYSQL_PRIVATE_DSN",
    value: "mysql://private",
    valueSource: "dbDsn",
  } satisfies ContainerEnvVar;

  assert.deepEqual(
    confirmedAddDbDsnReferencesFromEnvDraft([sourceRow, helperRow]),
    [{ dbName: "mysql", dbNamespace: "default", id: "drag-1" }]
  );
});

test("container settings draft detects dirty AP settings and restored state", () => {
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
  } satisfies Parameters<typeof containerSettingsDraftIsDirty>[0];

  assert.equal(containerSettingsDraftIsDirty(original, original), false);
  assert.equal(
    containerSettingsDraftIsDirty(original, {
      ...original,
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
    }),
    true
  );
  assert.equal(containerSettingsDraftIsDirty(original, { ...original }), false);
});

test("container settings pane exposes panel-level draft actions without environment save controls", () => {
  const html = renderToStaticMarkup(
    <ContainerSettingsPane
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
