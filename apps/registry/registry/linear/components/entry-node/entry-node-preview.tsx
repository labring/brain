"use client";

import type {
  EntryNodeAddress,
  EntryNodeAddressKey,
  EntryNodeGroup,
  EntryNodeStates,
} from "@workspace/ui/components/entry-node/entry-node";
import { EntryNode } from "@workspace/ui/components/entry-node/entry-node";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import type { ReactNode } from "react";

import { EntryNodeCanvasHero } from "./entry-node-preview.canvas";

const PLATFORM_SUFFIX = ".demo.sealos.run";

const entryNodeStates: EntryNodeStates = {
  name: "orders",
};

function platformAddress(
  id: string,
  prefix: string,
  status: EntryNodeAddress["status"] = {
    label: "Accessible",
    tone: "accessible",
  }
): EntryNodeAddress {
  const host = `${prefix}${PLATFORM_SUFFIX}`;
  return {
    host,
    hostSuffix: PLATFORM_SUFFIX,
    id,
    status,
    value: `https://${host}/`,
  };
}

const accessibleAddress = platformAddress("public", "orders");

const customDomainAddress: EntryNodeAddress = {
  host: "orders.example.com",
  id: "custom",
  status: { label: "Verifying", tone: "verifying" },
  value: "https://orders.example.com/",
};

const progressingAddress = platformAddress("progressing", "orders-preview", {
  label: "Progressing",
  tone: "progressing",
});

const failedAddress = platformAddress("failed", "orders-failed", {
  label: "Inaccessible",
  tone: "inaccessible",
});

const pendingAddress: EntryNodeAddress = {
  host: "Pending",
  id: "pending",
  status: { label: "Progressing", tone: "progressing" },
};

const websocketAddress: EntryNodeAddress = {
  host: `game${PLATFORM_SUFFIX}`,
  hostSuffix: PLATFORM_SUFFIX,
  id: "game-ws",
  status: { label: "Accessible", tone: "accessible" },
  value: `wss://game${PLATFORM_SUFFIX}/`,
};

const longAddress = platformAddress(
  "long-target",
  "orders-public-domain-with-a-very-long-target-value"
);

/** Single unnamed port: no group header, exactly as before. */
const singlePortGroups: EntryNodeGroup[] = [
  { addresses: [accessibleAddress], port: 3000 },
];

/** Two named ports (eaglercraft: game 5200 / admin 5201). */
const twoPortGroups: EntryNodeGroup[] = [
  { addresses: [websocketAddress], name: "game", port: 5200 },
  {
    addresses: [platformAddress("admin", "game-admin")],
    name: "Admin console",
    port: 5201,
  },
];

/** Two addresses on one port: a Platform Address and its Custom Domain. */
const sharedPortGroups: EntryNodeGroup[] = [
  {
    addresses: [accessibleAddress, customDomainAddress],
    name: "web",
    port: 3000,
  },
];

/** Two ports where only one carries a name: the other is headed by `:port`. */
const unnamedPortGroups: EntryNodeGroup[] = [
  {
    addresses: [platformAddress("api", "orders-api")],
    name: "API",
    port: 9000,
  },
  { addresses: [platformAddress("console", "orders-console")], port: 9001 },
];

const aggregateSamples: {
  groups: EntryNodeGroup[];
  title: string;
}[] = [
  { groups: [], title: "Not configured" },
  {
    groups: [
      {
        addresses: [accessibleAddress, platformAddress("api", "api.orders")],
        port: 3000,
      },
    ],
    title: "Accessible",
  },
  {
    groups: [
      {
        addresses: [progressingAddress, { ...progressingAddress, id: "p2" }],
        port: 3000,
      },
    ],
    title: "Progressing",
  },
  {
    groups: [{ addresses: [accessibleAddress, failedAddress], port: 3000 }],
    title: "Degraded",
  },
  {
    groups: [{ addresses: [failedAddress], port: 3000 }],
    title: "Inaccessible",
  },
  {
    groups: [{ addresses: [{ host: "Pending", id: "missing" }], port: 3000 }],
    title: "Missing status",
  },
];

function PreviewSurface({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-36 items-center justify-center overflow-hidden p-6">
      <div aria-hidden className="canvas-surface" />
      <div className="relative">{children}</div>
    </div>
  );
}

function EntryNodeSample({
  copiedAddressKey,
  defaultExpanded = false,
  dragging,
  groups = singlePortGroups,
  selected,
}: {
  copiedAddressKey?: EntryNodeAddressKey | null;
  defaultExpanded?: boolean;
  dragging?: boolean;
  groups?: EntryNodeGroup[];
  selected?: boolean;
}) {
  return (
    <EntryNode.Root
      copiedAddressKey={copiedAddressKey}
      defaultExpanded={defaultExpanded}
      groups={groups}
      interaction={{ dragging, selected }}
      states={entryNodeStates}
    >
      <EntryNode.Content />
    </EntryNode.Root>
  );
}

export default function EntryNodePreview() {
  return (
    <PreviewWrapper className="lg:grid-cols-2">
      <Preview
        className="h-96"
        containerClassName="lg:col-span-2"
        showMaximize
        title="In canvas"
      >
        <EntryNodeCanvasHero />
      </Preview>
      <Preview title="Collapsed default">
        <PreviewSurface>
          <EntryNodeSample />
        </PreviewSurface>
      </Preview>
      <Preview title="Collapsed selected">
        <PreviewSurface>
          <EntryNodeSample selected />
        </PreviewSurface>
      </Preview>
      <Preview title="Single port (no header)">
        <PreviewSurface>
          <EntryNodeSample defaultExpanded />
        </PreviewSurface>
      </Preview>
      <Preview title="Expanded selected">
        <PreviewSurface>
          <EntryNodeSample defaultExpanded selected />
        </PreviewSurface>
      </Preview>
      <Preview title="Two named ports">
        <PreviewSurface>
          <EntryNodeSample defaultExpanded groups={twoPortGroups} />
        </PreviewSurface>
      </Preview>
      <Preview title="Two addresses on one port">
        <PreviewSurface>
          <EntryNodeSample defaultExpanded groups={sharedPortGroups} />
        </PreviewSurface>
      </Preview>
      <Preview title="Unnamed port beside a named one">
        <PreviewSurface>
          <EntryNodeSample defaultExpanded groups={unnamedPortGroups} />
        </PreviewSurface>
      </Preview>
      <Preview title="Pending address">
        <PreviewSurface>
          <EntryNodeSample
            defaultExpanded
            groups={[{ addresses: [pendingAddress], port: 3000 }]}
          />
        </PreviewSurface>
      </Preview>
      <Preview title="Scrollable groups">
        <PreviewSurface>
          <EntryNodeSample
            defaultExpanded
            groups={[
              ...twoPortGroups,
              { addresses: [progressingAddress, failedAddress], port: 5202 },
            ]}
          />
        </PreviewSurface>
      </Preview>
      <Preview title="Empty groups">
        <PreviewSurface>
          <EntryNodeSample defaultExpanded groups={[]} />
        </PreviewSurface>
      </Preview>
      <Preview title="Copied feedback">
        <PreviewSurface>
          <EntryNodeSample
            copiedAddressKey="public"
            defaultExpanded
            groups={sharedPortGroups}
          />
        </PreviewSurface>
      </Preview>
      <Preview title="Drag visual">
        <PreviewSurface>
          <EntryNodeSample defaultExpanded dragging />
        </PreviewSurface>
      </Preview>
      <Preview title="Long values">
        <PreviewSurface>
          <EntryNodeSample
            defaultExpanded
            groups={[
              {
                addresses: [longAddress],
                name: "A very long Port Display Name for a console",
                port: 8080,
              },
            ]}
          />
        </PreviewSurface>
      </Preview>
      <Preview containerClassName="lg:col-span-2" title="Aggregate status">
        <PreviewSurface>
          <div className="flex flex-wrap items-start gap-3">
            {aggregateSamples.map((sample) => (
              <div className="flex flex-col gap-2" key={sample.title}>
                <EntryNodeSample groups={sample.groups} />
                <span className="text-muted-foreground text-xs">
                  {sample.title}
                </span>
              </div>
            ))}
          </div>
        </PreviewSurface>
      </Preview>
    </PreviewWrapper>
  );
}
