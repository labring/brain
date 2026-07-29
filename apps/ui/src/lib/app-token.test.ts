import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { SignJWT } from "jose";

import {
  appTokenFromRequest,
  appTokenVerificationConfigFromEnv,
  assertProductionAppTokenConfig,
  verifyAppTokenBinding,
} from "./app-token";
import { APP_TOKEN_HEADER } from "./app-token-header";

const SECRET = "dev-jwt-internal";
const REGION_UID = "0f2a6f47-6dcb-4a76-b177-6c0aa22eaf6e";
const USER_UID = "6bd90648-b8b9-4a70-9be0-95c8391a0dcb";
const CR_NAME = "alice-cr";
const MINTED_AT = 1_753_600_000;

const CONFIG = { secret: SECRET };
const MISSING_SECRET_RE = /JWT_INTERNAL/;

function mintAppToken(
  overrides: {
    claims?: Record<string, unknown>;
    expiresAt?: number;
    mintedAt?: number;
    secret?: string;
  } = {}
): Promise<string> {
  const jwt = new SignJWT({
    regionUid: REGION_UID,
    userCrName: CR_NAME,
    userUid: USER_UID,
    ...overrides.claims,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(overrides.mintedAt ?? MINTED_AT);
  if (overrides.expiresAt !== undefined) {
    jwt.setExpirationTime(overrides.expiresAt);
  }
  return jwt.sign(new TextEncoder().encode(overrides.secret ?? SECRET));
}

test("accepts a token whose binding matches the authenticated actor", async () => {
  const token = await mintAppToken();

  assert.deepEqual(
    await verifyAppTokenBinding({
      config: CONFIG,
      expectedCrName: CR_NAME,
      token,
    }),
    {
      binding: { crName: CR_NAME, mintedAt: MINTED_AT, userUid: USER_UID },
      expired: false,
      ok: true,
    }
  );
});

test("accepts an expired but otherwise valid token and reports it as expired", async () => {
  const token = await mintAppToken({ expiresAt: MINTED_AT + 1 });

  assert.deepEqual(
    await verifyAppTokenBinding({
      config: CONFIG,
      expectedCrName: CR_NAME,
      token,
    }),
    {
      binding: { crName: CR_NAME, mintedAt: MINTED_AT, userUid: USER_UID },
      expired: true,
      ok: true,
    }
  );
});

test("an unexpired expiry and workspace claims are carried without effect", async () => {
  const token = await mintAppToken({
    claims: { workspaceId: "ws-1", workspaceUid: "spoofed-workspace" },
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });

  assert.deepEqual(
    await verifyAppTokenBinding({
      config: CONFIG,
      expectedCrName: CR_NAME,
      token,
    }),
    {
      binding: { crName: CR_NAME, mintedAt: MINTED_AT, userUid: USER_UID },
      expired: false,
      ok: true,
    }
  );
});

// Passing the hard checks is not admission: a null mintedAt cannot be
// fingerprinted, so the authorization layer refuses it with 401 (ADR-0059
// degradation matrix). Desktop always mints `iat`; only a non-desktop minter
// produces this shape.
test("a token without a minting time still proves the binding", async () => {
  const jwt = await new SignJWT({
    regionUid: REGION_UID,
    userCrName: CR_NAME,
    userUid: USER_UID,
  })
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(SECRET));

  assert.deepEqual(
    await verifyAppTokenBinding({
      config: CONFIG,
      expectedCrName: CR_NAME,
      token: jwt,
    }),
    {
      binding: { crName: CR_NAME, mintedAt: null, userUid: USER_UID },
      expired: false,
      ok: true,
    }
  );
});

test("a missing token fails closed as missing", async () => {
  assert.deepEqual(
    await verifyAppTokenBinding({
      config: CONFIG,
      expectedCrName: CR_NAME,
      token: "  ",
    }),
    { ok: false, reason: "missing" }
  );
});

test("a token signed with a different secret is unverifiable", async () => {
  const token = await mintAppToken({ secret: "attacker-secret" });

  assert.deepEqual(
    await verifyAppTokenBinding({
      config: CONFIG,
      expectedCrName: CR_NAME,
      token,
    }),
    { ok: false, reason: "unverifiable" }
  );
});

test("an unsigned token is unverifiable even with matching claims", async () => {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
    "base64url"
  );
  const payload = Buffer.from(
    JSON.stringify({
      regionUid: REGION_UID,
      userCrName: CR_NAME,
      userUid: USER_UID,
    })
  ).toString("base64url");

  assert.deepEqual(
    await verifyAppTokenBinding({
      config: CONFIG,
      expectedCrName: CR_NAME,
      token: `${header}.${payload}.`,
    }),
    { ok: false, reason: "unverifiable" }
  );
});

test("a garbage token is unverifiable", async () => {
  assert.deepEqual(
    await verifyAppTokenBinding({
      config: CONFIG,
      expectedCrName: CR_NAME,
      token: "not-a-jwt",
    }),
    { ok: false, reason: "unverifiable" }
  );
});

test("a token missing binding claims is unverifiable", async () => {
  const jwt = await new SignJWT({ userCrName: CR_NAME })
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(SECRET));

  assert.deepEqual(
    await verifyAppTokenBinding({
      config: CONFIG,
      expectedCrName: CR_NAME,
      token: jwt,
    }),
    { ok: false, reason: "unverifiable" }
  );
});

test("absent server configuration fails closed as unverifiable", async () => {
  const token = await mintAppToken();

  assert.deepEqual(
    await verifyAppTokenBinding({
      config: null,
      expectedCrName: CR_NAME,
      token,
    }),
    { ok: false, reason: "unverifiable" }
  );
});

test("a token minted for another crName is an actor mismatch", async () => {
  const token = await mintAppToken({ claims: { userCrName: "mallory-cr" } });

  assert.deepEqual(
    await verifyAppTokenBinding({
      config: CONFIG,
      expectedCrName: CR_NAME,
      token,
    }),
    { ok: false, reason: "actor_mismatch" }
  );
});

// The regionUid claim desktop mints is never read: cross-region replay is
// blocked by the kubeconfig liveness credential, which only the token's
// region can authenticate.
test("a token minted for another region is accepted", async () => {
  const token = await mintAppToken({
    claims: { regionUid: "b9a1c9c1-a1de-4c26-9c58-0f9b9c3c2f5d" },
  });

  assert.deepEqual(
    await verifyAppTokenBinding({
      config: CONFIG,
      expectedCrName: CR_NAME,
      token,
    }),
    {
      binding: { crName: CR_NAME, mintedAt: MINTED_AT, userUid: USER_UID },
      expired: false,
      ok: true,
    }
  );
});

function withEnv<T>(values: Partial<NodeJS.ProcessEnv>, run: () => T): T {
  const previous = new Map(
    Object.keys(values).map((key) => [key, process.env[key]])
  );
  for (const [key, value] of Object.entries(values)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("reads the verification config from JWT_INTERNAL", () => {
  withEnv({ JWT_INTERNAL: SECRET }, () => {
    assert.deepEqual(appTokenVerificationConfigFromEnv(), {
      secret: SECRET,
    });
  });
});

test("the verification config is null when the secret is absent", () => {
  withEnv({ JWT_INTERNAL: undefined }, () => {
    assert.equal(appTokenVerificationConfigFromEnv(), null);
  });
  withEnv({ JWT_INTERNAL: "  " }, () => {
    assert.equal(appTokenVerificationConfigFromEnv(), null);
  });
});

test("production startup fails fast when JWT_INTERNAL is unset", () => {
  assert.throws(
    () =>
      assertProductionAppTokenConfig({
        JWT_INTERNAL: "",
        NODE_ENV: "production",
      }),
    MISSING_SECRET_RE
  );
  assert.doesNotThrow(() =>
    assertProductionAppTokenConfig({
      JWT_INTERNAL: SECRET,
      NODE_ENV: "production",
    })
  );
  assert.doesNotThrow(() =>
    assertProductionAppTokenConfig({ NODE_ENV: "development" })
  );
});

test("reads the bare app token from the request header", () => {
  const request = new Request("https://brain.test/api/chat/threads", {
    headers: { [APP_TOKEN_HEADER]: "  the-token  " },
  });
  assert.equal(appTokenFromRequest(request), "the-token");
  assert.equal(
    appTokenFromRequest(new Request("https://brain.test/api/chat/threads")),
    ""
  );
});

test("a script-minted dev token passes the production verifier for the dev kubeconfig", () => {
  const saJwt = [
    Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
      "base64url"
    ),
    Buffer.from(
      JSON.stringify({ sub: `system:serviceaccount:user-system:${CR_NAME}` })
    ).toString("base64url"),
    "signature",
  ].join(".");
  const devKubeconfig = encodeURIComponent(`
apiVersion: v1
clusters:
  - name: cluster
    cluster:
      server: https://example.test
contexts:
  - name: current
    context:
      cluster: cluster
      namespace: ns-dev
      user: dev-user
current-context: current
users:
  - name: dev-user
    user:
      token: ${saJwt}
`);

  const minted = spawnSync(
    process.execPath,
    ["scripts/mint-dev-app-token.mjs"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        JWT_INTERNAL: SECRET,
        NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG: devKubeconfig,
      },
    }
  );
  assert.equal(minted.status, 0, minted.stderr);
  const token = minted.stdout.trim();
  assert.notEqual(token, "");

  return verifyAppTokenBinding({
    config: { secret: SECRET },
    expectedCrName: CR_NAME,
    token,
  }).then((verification) => {
    assert.equal(verification.ok, true);
    if (verification.ok) {
      assert.equal(verification.binding.crName, CR_NAME);
      assert.equal(verification.expired, false);
      assert.notEqual(verification.binding.mintedAt, null);
      assert.notEqual(verification.binding.userUid, "");
    }
  });
});
