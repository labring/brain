import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type ApOpenTargetAddress,
  apOpenTargetEligiblePorts,
  resolveApOpenTarget,
} from "./ap-open-target";

const MINIO_PORTS = [
  { displayName: "S3 API", port: 9000 },
  { displayName: "Console", port: 9001 },
];

function platform(
  port: number,
  host: string,
  accessible = true
): ApOpenTargetAddress {
  return { accessible, kind: "platform", port, url: `https://${host}/` };
}

function custom(
  port: number,
  host: string,
  accessible = true
): ApOpenTargetAddress {
  return { accessible, kind: "custom", port, url: `https://${host}/` };
}

test("Open target: a stored Default Open Port wins over the first port", () => {
  const target = resolveApOpenTarget({
    addresses: [
      platform(9000, "s3.demo.sealos.run"),
      platform(9001, "console.demo.sealos.run"),
    ],
    defaultOpenPort: 9001,
    ports: MINIO_PORTS,
  });

  assert.deepEqual(target, {
    label: "Open Console",
    port: 9001,
    url: "https://console.demo.sealos.run/",
  });
});

test("Open target: a stale stored port falls back to the automatic rule", () => {
  const target = resolveApOpenTarget({
    addresses: [platform(9000, "s3.demo.sealos.run")],
    defaultOpenPort: 9001,
    ports: MINIO_PORTS,
  });

  assert.deepEqual(target, {
    label: "Open S3 API",
    port: 9000,
    url: "https://s3.demo.sealos.run/",
  });
});

test("Open target: automatic rule picks the first declared port with an HTTP address, skipping WS-only ports", () => {
  const target = resolveApOpenTarget({
    addresses: [
      {
        accessible: true,
        kind: "platform",
        port: 5200,
        url: "wss://game.demo.sealos.run/",
      },
      platform(5201, "admin.demo.sealos.run"),
    ],
    ports: [
      { displayName: "game", port: 5200 },
      { displayName: "Admin console", port: 5201 },
    ],
  });

  assert.deepEqual(target, {
    label: "Open Admin console",
    port: 5201,
    url: "https://admin.demo.sealos.run/",
  });
});

test("Open target: declaration order beats port number", () => {
  const target = resolveApOpenTarget({
    addresses: [
      platform(3002, "admin.demo.sealos.run"),
      platform(3001, "app.demo.sealos.run"),
    ],
    ports: [{ port: 3002 }, { port: 3001 }],
  });

  assert.equal(target?.port, 3002);
  assert.equal(target?.label, "Open");
});

test("Open target: an accessible Custom Domain beats an accessible Platform Address", () => {
  const target = resolveApOpenTarget({
    addresses: [
      platform(5200, "game.demo.sealos.run"),
      custom(5200, "play.example.com"),
    ],
    ports: [{ displayName: "game", port: 5200 }],
  });

  assert.equal(target?.url, "https://play.example.com/");
});

test("Open target: a Custom Domain still verifying yields to the Platform Address", () => {
  const target = resolveApOpenTarget({
    addresses: [
      platform(9001, "console.demo.sealos.run"),
      custom(9001, "console.example.com", false),
    ],
    ports: MINIO_PORTS,
  });

  assert.equal(target?.url, "https://console.demo.sealos.run/");
});

test("Open target: nothing accessible yields no URL and a reason", () => {
  const target = resolveApOpenTarget({
    addresses: [{ accessible: false, kind: "platform", port: 3000 }],
    ports: [{ port: 3000 }],
  });

  assert.deepEqual(target, {
    disabledReason: "Not accessible yet",
    label: "Open",
    port: 3000,
  });
});

test("Open target: no Public Address yields no target", () => {
  assert.equal(
    resolveApOpenTarget({ addresses: [], ports: [{ port: 3000 }] }),
    undefined
  );
});

test("Open target: eligible ports list every declared port with an HTTP address, in order", () => {
  assert.deepEqual(
    apOpenTargetEligiblePorts({
      addresses: [
        platform(9001, "console.demo.sealos.run", false),
        platform(9000, "s3.demo.sealos.run"),
        {
          accessible: true,
          kind: "platform",
          port: 9002,
          url: "wss://events.demo.sealos.run/",
        },
      ],
      ports: [...MINIO_PORTS, { port: 9002 }],
    }),
    [9000, 9001]
  );
});

test("Open target: without declared ports the addresses' ports stand in, ascending", () => {
  assert.deepEqual(
    apOpenTargetEligiblePorts({
      addresses: [
        platform(8081, "b.example.com"),
        platform(8080, "a.example.com"),
      ],
      ports: [],
    }),
    [8080, 8081]
  );
});
