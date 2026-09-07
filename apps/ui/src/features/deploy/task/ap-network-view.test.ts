import { describe, expect, it } from "bun:test";

import {
  accessEndpointLabelForPort,
  apNetworkViewAddressForHost,
  apNetworkViewFromProductView,
  apNetworkViewOpenUrl,
  appListeningPortLabel,
} from "./ap-network-view";

const view = {
  status: {
    network: {
      appListeningPorts: [
        { displayName: "game", port: 5200 },
        { port: 8080 },
        { port: "not-a-port" },
      ],
      defaultOpenPort: 8080,
      publicAddresses: [
        {
          host: "game.example.sealos.run",
          id: "pa_game",
          port: 5200,
          status: "accessible",
          type: "platform",
          url: "https://game.example.sealos.run/",
        },
        {
          host: "admin.example.sealos.run",
          id: "pa_admin",
          port: 8080,
          status: "accessible",
          type: "platform",
          url: "https://admin.example.sealos.run/",
        },
        {
          host: "play.example.com",
          id: "cd_play",
          port: 8080,
          status: "accessible",
          type: "custom",
          url: "https://play.example.com/",
        },
        {
          host: "Observed.Example.Sealos.Run",
          id: "observed-1",
          port: 5200,
          status: "accessible",
          type: "observed",
          url: "wss://observed.example.sealos.run/socket",
        },
        { id: "broken", status: "accessible", type: "platform" },
      ],
    },
  },
};

describe("AP network view", () => {
  it("reads listening ports, addresses and the stored Default Open Port", () => {
    const parsed = apNetworkViewFromProductView(view);
    expect(parsed.ports).toEqual([
      { displayName: "game", port: 5200 },
      { port: 8080 },
    ]);
    expect(parsed.defaultOpenPort).toBe(8080);
    expect(parsed.addresses.map((address) => address.id)).toEqual([
      "pa_game",
      "pa_admin",
      "cd_play",
      "observed-1",
    ]);
    expect(parsed.addresses[3]).toEqual({
      accessible: true,
      host: "observed.example.sealos.run",
      id: "observed-1",
      kind: "observed",
      port: 5200,
      url: "wss://observed.example.sealos.run/socket",
    });
  });

  it("tolerates a view with no network at all", () => {
    expect(apNetworkViewFromProductView(null)).toEqual({
      addresses: [],
      ports: [],
    });
    expect(apNetworkViewFromProductView({ status: {} })).toEqual({
      addresses: [],
      ports: [],
    });
  });

  it("writes a port the way the Public Access Node heads it", () => {
    expect(appListeningPortLabel({ displayName: "game", port: 5200 })).toBe(
      "game · 5200"
    );
    expect(appListeningPortLabel({ displayName: "  ", port: 5200 })).toBe(
      "5200"
    );
    expect(appListeningPortLabel({ port: 8080 })).toBe("8080");
  });

  it("labels an endpoint after the port it reaches, number alone when unnamed", () => {
    const parsed = apNetworkViewFromProductView(view);
    expect(accessEndpointLabelForPort(parsed, 5200)).toBe("game · 5200");
    expect(accessEndpointLabelForPort(parsed, 8080)).toBe("8080");
    // A port the view does not list is still a port, never an invented name.
    expect(accessEndpointLabelForPort(parsed, 9000)).toBe("9000");
    expect(accessEndpointLabelForPort(parsed, undefined)).toBeUndefined();
  });

  it("finds the address an Ingress host was observed as, case-insensitively", () => {
    const parsed = apNetworkViewFromProductView(view);
    expect(
      apNetworkViewAddressForHost(parsed, "OBSERVED.example.sealos.run")?.port
    ).toBe(5200);
    expect(apNetworkViewAddressForHost(parsed, "nobody.example")).toBe(
      undefined
    );
    expect(apNetworkViewAddressForHost(parsed, "  ")).toBe(undefined);
  });

  it("opens the stored Default Open Port through its Custom Domain", () => {
    expect(apNetworkViewOpenUrl(apNetworkViewFromProductView(view))).toBe(
      "https://play.example.com/"
    );
  });

  it("falls back to the automatic rule when nothing is stored", () => {
    const automatic = structuredClone(view);
    automatic.status.network.defaultOpenPort = undefined as unknown as number;
    expect(apNetworkViewOpenUrl(apNetworkViewFromProductView(automatic))).toBe(
      "https://game.example.sealos.run/"
    );
  });

  it("has no Open URL when no HTTP address is accessible", () => {
    expect(
      apNetworkViewOpenUrl(
        apNetworkViewFromProductView({
          status: {
            network: {
              appListeningPorts: [{ port: 80 }],
              publicAddresses: [
                {
                  host: "pending.example.sealos.run",
                  id: "pa_pending",
                  port: 80,
                  status: "progressing",
                  type: "platform",
                },
              ],
            },
          },
        })
      )
    ).toBeUndefined();
  });
});
