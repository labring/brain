import { afterEach, describe, expect, it } from "bun:test";

import {
  isAllowedDeploymentAccessUrl,
  probeManagedPublicUrl,
} from "./managed-public-probe";

const ORIGINAL_WEBSOCKET = globalThis.WebSocket;

afterEach(() => {
  globalThis.WebSocket = ORIGINAL_WEBSOCKET;
});

describe("deployment access endpoint validation", () => {
  it("accepts tenant HTTP and WebSocket URLs without credentials or fragments", () => {
    expect(
      isAllowedDeploymentAccessUrl(
        new URL("wss://play.tenant-a.sealos.io/server"),
        "tenant-a.sealos.io"
      )
    ).toBe(true);
    expect(
      isAllowedDeploymentAccessUrl(
        new URL("https://user:secret@play.tenant-a.sealos.io"),
        "tenant-a.sealos.io"
      )
    ).toBe(false);
    expect(
      isAllowedDeploymentAccessUrl(
        new URL("https://play.tenant-a.sealos.io/#secret"),
        "tenant-a.sealos.io"
      )
    ).toBe(false);
  });

  it("accepts a WebSocket endpoint only after the upgrade opens", async () => {
    class OpenWebSocket extends EventTarget {
      static readonly CLOSED = 3;
      static readonly CLOSING = 2;
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      readonly readyState = OpenWebSocket.CONNECTING;

      constructor(_url: string | URL) {
        super();
        queueMicrotask(() => this.dispatchEvent(new Event("open")));
      }

      close() {
        // The verifier closes a successfully opened test socket.
      }
    }
    globalThis.WebSocket = OpenWebSocket as unknown as typeof WebSocket;

    await expect(
      probeManagedPublicUrl({
        allowedDomain: "tenant-a.sealos.io",
        deadlineAtMs: Date.now() + 10_000,
        publicUrl: "wss://play.tenant-a.sealos.io/server",
      })
    ).resolves.toBeUndefined();
  });
});
