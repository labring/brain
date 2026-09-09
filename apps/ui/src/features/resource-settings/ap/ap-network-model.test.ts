import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type ApNetwork,
  apNetworkOpenTarget,
  apNetworkOpenTargetAddresses,
  apNetworkOpenTargetEligiblePorts,
} from "./ap-network-model";

// Eaglercraft-shaped: the game socket is declared before the admin page.
const EAGLERCRAFT: ApNetwork = {
  appListeningPorts: [
    { displayName: "game", port: 5200 },
    { displayName: "admin", port: 5201 },
  ],
  privatePort: 5200,
  publicAddresses: [
    {
      host: "game.example.sealos.run",
      id: "pa_game01",
      port: 5200,
      status: "accessible",
      type: "platform",
      url: "wss://game.example.sealos.run/",
    },
    {
      host: "admin.example.sealos.run",
      id: "pa_admin1",
      port: 5201,
      status: "accessible",
      type: "platform",
      url: "https://admin.example.sealos.run/admin",
    },
  ],
};

test("a Custom Domain bound to a WS Platform Address stays WS and never becomes the Open target", () => {
  const network: ApNetwork = {
    ...EAGLERCRAFT,
    customDomains: [
      {
        domain: "play.example.com",
        id: "cd_play01",
        platformAddressId: "pa_game01",
        status: "accessible",
      },
    ],
  };
  assert.deepEqual(
    apNetworkOpenTargetAddresses(network).find(
      (address) => address.kind === "custom"
    ),
    {
      accessible: true,
      kind: "custom",
      port: 5200,
      url: "wss://play.example.com/",
    }
  );
  assert.deepEqual(apNetworkOpenTargetEligiblePorts(network), [5201]);
  assert.equal(
    apNetworkOpenTarget(network)?.url,
    "https://admin.example.sealos.run/admin"
  );
});

test("a Custom Domain keeps the entry path of the Platform Address it promotes", () => {
  const network: ApNetwork = {
    ...EAGLERCRAFT,
    customDomains: [
      {
        domain: "console.example.com",
        id: "cd_cons01",
        platformAddressId: "pa_admin1",
        status: "accessible",
      },
    ],
  };
  assert.equal(
    apNetworkOpenTarget(network)?.url,
    "https://console.example.com/admin"
  );
});

test("a Custom Domain without a known Platform Address opens as observed, else https at its root", () => {
  const observed: ApNetwork = {
    ...EAGLERCRAFT,
    customDomains: [
      {
        domain: "site.example.com",
        id: "cd_site01",
        platformAddressId: "pa_gone00",
        status: "accessible",
        targetPort: 5201,
        url: "https://site.example.com/panel",
      },
    ],
  };
  assert.equal(
    apNetworkOpenTarget(observed)?.url,
    "https://site.example.com/panel"
  );

  const bare: ApNetwork = {
    ...EAGLERCRAFT,
    customDomains: [
      {
        domain: "site.example.com",
        id: "cd_site01",
        platformAddressId: "pa_gone00",
        status: "accessible",
        targetPort: 5201,
      },
    ],
  };
  assert.equal(apNetworkOpenTarget(bare)?.url, "https://site.example.com/");
});
