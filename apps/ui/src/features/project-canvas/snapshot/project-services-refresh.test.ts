import assert from "node:assert/strict";
import { test } from "node:test";

import { hasPublicApEndpoint } from "./project-services-refresh";

test("public AP endpoint detection includes Network public addresses", () => {
  assert.equal(
    hasPublicApEndpoint({
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: {
            input: {
              network: {
                privatePort: 8080,
                platformAddresses: [{ id: "pa_abc123", port: 8080 }],
              },
            },
          },
          status: {
            network: {
              publicAddresses: [
                {
                  host: "api.example.com",
                  id: "pa_abc123",
                  port: 8080,
                  url: "https://api.example.com/",
                },
              ],
            },
          },
        },
      ],
    }),
    true
  );
});

test("public AP endpoint detection includes desired Platform Address requests", () => {
  assert.equal(
    hasPublicApEndpoint({
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: {
            input: {
              network: {
                privatePort: 8080,
                platformAddresses: [{ id: "pa_abc123", port: 8080 }],
              },
            },
          },
          status: {
            network: {
              privatePort: 8080,
            },
          },
        },
      ],
    }),
    true
  );
});

test("public AP detection ignores retired endpoint fields", () => {
  assert.equal(
    hasPublicApEndpoint({
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: {
            input: {
              endpoints: [{ host: "api.example.com", port: 8080 }],
            },
          },
          status: {
            endpoints: [
              {
                number: 8080,
                publicAddress: "https://api.example.com/",
              },
            ],
          },
        },
      ],
    }),
    false
  );
});
