import assert from "node:assert/strict";
import { test } from "node:test";

import { platformAddressHost } from "./platform-address";

test("platformAddressHost keeps the reserved brain prefix", () => {
  assert.equal(
    platformAddressHost({
      appName: "sealai-ui-staging",
      domainPrefix: "brain",
      namespace: "brain-system",
      platformAddressId: "pa_uistaging1",
      routingDomain: "192.168.12.53.nip.io",
    }),
    "brain.192.168.12.53.nip.io"
  );
});
