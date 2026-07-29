import assert from "node:assert/strict";
import { test } from "node:test";

import { SignJWT } from "jose";

import type { ObserveIdentityFingerprint } from "@/lib/identity-fingerprint-core";
import {
  type KubeconfigNamespaceVerification,
  workspaceActorFromAuthorizedKubeconfig,
} from "@/lib/request-kubeconfig-auth";
import {
  createGithubAppInstallSessionHandler,
  createGithubConnectionDeleteHandler,
  createGithubConnectionStatusHandler,
  createGithubOAuthCallbackHandler,
  createGithubOAuthSessionHandler,
  createGithubRepositoryListHandler,
  type GithubAppInstallSessionCreate,
  type GithubConnectionDelete,
  type GithubConnectionStatusLookup,
  type GithubLegacyConnectionAdoption,
  type GithubOAuthCallbackCancel,
  type GithubOAuthCallbackComplete,
  type GithubOAuthSessionCreate,
  type GithubRepositoryList,
} from "./connection-http-handlers";
import type { GithubConnectionOwnerIdentity } from "./owner-identity";

const PERSISTENCE_FAILURE_RE = /Failed to persist GitHub OAuth connection/;

const APP_TOKEN_SECRET = "cluster-shared-jwt-internal";
const APP_TOKEN_CONFIG = {
  regionUid: "0f2a6f47-6dcb-4a76-b177-6c0aa22eaf6e",
  secret: APP_TOKEN_SECRET,
};

function mintAppToken(crName: string, secret = APP_TOKEN_SECRET) {
  return new SignJWT({
    regionUid: APP_TOKEN_CONFIG.regionUid,
    userCrName: crName,
    userUid: `${crName}-uid`,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(1_753_600_000)
    .sign(new TextEncoder().encode(secret));
}

/** Mints the app token desktop would deliver for the kubeconfig's actor. */
async function appTokenHeaderFor(
  encodedKubeconfig: string
): Promise<Record<string, string>> {
  const crName = workspaceActorFromAuthorizedKubeconfig(
    decodeURIComponent(encodedKubeconfig)
  );
  return crName == null
    ? {}
    : { "X-Sealos-App-Token": await mintAppToken(crName) };
}

function jwt(subject: string, tokenId = "token"): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ jti: tokenId, sub: subject })
  ).toString("base64url");
  return `${header}.${payload}.test-signature`;
}

function kubeconfig(input: { namespace: string; token: string }): string {
  return encodeURIComponent(`
apiVersion: v1
clusters:
  - name: cluster
    cluster:
      server: https://example.test
contexts:
  - name: current
    context:
      cluster: cluster
      namespace: ${input.namespace}
      user: active-user
current-context: current
users:
  - name: active-user
    user:
      token: ${input.token}
`);
}

function kubeconfigWithTwoUsers(input: {
  activeToken: string;
  inactiveToken: string;
  namespace: string;
}): string {
  return encodeURIComponent(`
apiVersion: v1
clusters:
  - name: cluster
    cluster:
      server: https://example.test
contexts:
  - name: inactive
    context:
      cluster: cluster
      namespace: ${input.namespace}
      user: inactive-user
  - name: current
    context:
      cluster: cluster
      namespace: ${input.namespace}
      user: active-user
current-context: current
users:
  - name: inactive-user
    user:
      token: ${input.inactiveToken}
  - name: active-user
    user:
      token: ${input.activeToken}
`);
}

interface StoredConnection {
  accessTokenCiphertext?: string;
  accountLogin: string;
  id?: string;
  repositories?: { fullName: string }[];
}

interface StoredOAuthState {
  expiresAt: Date;
  owner: GithubConnectionOwnerIdentity;
  returnPath: string | null;
  state: string;
}

type CallbackWrite = Parameters<GithubOAuthCallbackComplete>[0] & {
  owner: GithubConnectionOwnerIdentity;
  returnPath: string | null;
};

function createWorkspaceActorHttpHarness(input: {
  callbackFailures?: number;
  connections: ReadonlyMap<string, StoredConnection>;
  observeFingerprint?: ObserveIdentityFingerprint;
  verification?: KubeconfigNamespaceVerification;
}) {
  const observeFingerprint: ObserveIdentityFingerprint =
    input.observeFingerprint ?? (() => Promise.resolve({ outcome: "match" }));
  const connections = new Map(input.connections);
  const adoptions: Parameters<GithubLegacyConnectionAdoption>[0][] = [];
  const appInstallSessions: Parameters<GithubAppInstallSessionCreate>[0][] = [];
  const authorizationTokens: string[] = [];
  const callbackWrites: CallbackWrite[] = [];
  const deletes: Parameters<GithubConnectionDelete>[0][] = [];
  const lookups: Parameters<GithubConnectionStatusLookup>[0][] = [];
  const oauthSessions: Parameters<GithubOAuthSessionCreate>[0][] = [];
  const oauthStates = new Map<string, StoredOAuthState>();
  let remainingCallbackFailures = input.callbackFailures ?? 0;
  const repositoryLookups: Parameters<GithubRepositoryList>[0][] = [];
  const ownerKey = (owner: GithubConnectionOwnerIdentity) =>
    `${owner.namespace}:${owner.userUid}:${owner.ownerIdentityVersion}`;
  /** Mirrors the persistence seam: re-key the legacy generation-1 row to the uid; a conflicting current row wins and leaves the legacy row inert. */
  const adoptLegacyConnection: GithubLegacyConnectionAdoption = (adoption) => {
    adoptions.push(adoption);
    const legacyKey = `${adoption.owner.namespace}:${adoption.legacyWorkspaceActor}:1`;
    const legacy = connections.get(legacyKey);
    if (legacy != null && !connections.has(ownerKey(adoption.owner))) {
      connections.delete(legacyKey);
      connections.set(ownerKey(adoption.owner), legacy);
    }
    return Promise.resolve();
  };
  const handler = createGithubConnectionStatusHandler({
    adoptLegacyConnection,
    getConnection: (owner) => {
      lookups.push(owner);
      return Promise.resolve(connections.get(ownerKey(owner)) ?? null);
    },
    appTokenConfig: APP_TOKEN_CONFIG,
    observeFingerprint,
    verify: ({ token }) => {
      authorizationTokens.push(token);
      return Promise.resolve(input.verification ?? { ok: true });
    },
  });
  const repositoriesHandler = createGithubRepositoryListHandler({
    adoptLegacyConnection,
    listRepositories: (owner) => {
      repositoryLookups.push(owner);
      return Promise.resolve(
        connections.get(ownerKey(owner))?.repositories ?? []
      );
    },
    appTokenConfig: APP_TOKEN_CONFIG,
    observeFingerprint,
    verify: ({ token }) => {
      authorizationTokens.push(token);
      return Promise.resolve(input.verification ?? { ok: true });
    },
  });
  const deleteHandler = createGithubConnectionDeleteHandler({
    /** Mirrors the persistence seam: forget the uid row and any legacy row. */
    deleteConnection: (actor) => {
      deletes.push(actor);
      connections.delete(ownerKey(actor.owner));
      connections.delete(
        `${actor.owner.namespace}:${actor.legacyWorkspaceActor}:1`
      );
      return Promise.resolve();
    },
    appTokenConfig: APP_TOKEN_CONFIG,
    observeFingerprint,
    verify: ({ token }) => {
      authorizationTokens.push(token);
      return Promise.resolve(input.verification ?? { ok: true });
    },
  });
  const oauthSessionHandler = createGithubOAuthSessionHandler({
    createSession: (session) => {
      oauthSessions.push(session);
      oauthStates.set("oauth-state", {
        expiresAt: new Date(Date.now() + 60_000),
        owner: session.actor.owner,
        returnPath: session.returnPath,
        state: "oauth-state",
      });
      return Promise.resolve({
        authorizeUrl:
          "https://github.test/login/oauth/authorize?state=oauth-state",
        state: "oauth-state",
      });
    },
    getBaseUrl: () => "https://brain.test",
    appTokenConfig: APP_TOKEN_CONFIG,
    observeFingerprint,
    verify: ({ token }) => {
      authorizationTokens.push(token);
      return Promise.resolve(input.verification ?? { ok: true });
    },
  });
  const appInstallSessionHandler = createGithubAppInstallSessionHandler({
    createSession: (session) => {
      appInstallSessions.push(session);
      return Promise.resolve({
        installUrl: "https://github.test/apps/sealai/installations/new",
        state: "app-state",
      });
    },
    appTokenConfig: APP_TOKEN_CONFIG,
    observeFingerprint,
    verify: ({ token }) => {
      authorizationTokens.push(token);
      return Promise.resolve(input.verification ?? { ok: true });
    },
  });
  const validOAuthState = (state: string): StoredOAuthState | null => {
    const session = oauthStates.get(state);
    if (
      session == null ||
      session.expiresAt.getTime() <= Date.now() ||
      session.owner.ownerIdentityVersion !== 2 ||
      session.owner.namespace.trim() === "" ||
      session.owner.userUid.trim() === ""
    ) {
      return null;
    }
    return session;
  };
  const consumeOAuthState = (state: string): StoredOAuthState | null => {
    const session = validOAuthState(state);
    if (session == null) {
      return null;
    }
    oauthStates.delete(state);
    return session;
  };
  const cancelAuthorization: GithubOAuthCallbackCancel = (callback) => {
    const session = consumeOAuthState(callback.state);
    return Promise.resolve(
      session == null
        ? null
        : Response.redirect("https://brain.test/github/setup-complete")
    );
  };
  const callbackHandler = createGithubOAuthCallbackHandler({
    cancelAuthorization,
    completeAuthorization: (callback) => {
      const session = consumeOAuthState(callback.state);
      if (session == null) {
        return Promise.resolve(null);
      }
      try {
        if (remainingCallbackFailures > 0) {
          remainingCallbackFailures -= 1;
          throw new Error("Failed to persist GitHub OAuth connection.");
        }
        callbackWrites.push({
          ...callback,
          owner: session.owner,
          returnPath: session.returnPath,
        });
        connections.set(ownerKey(session.owner), {
          accountLogin: `${session.owner.userUid}-github`,
        });
        return Promise.resolve(
          Response.redirect("https://brain.test/github/setup-complete")
        );
      } catch (error) {
        oauthStates.set(session.state, session);
        return Promise.reject(error);
      }
    },
    validateState: (state) => Promise.resolve(validOAuthState(state) != null),
  });

  const buildRequest = async (
    pathname: string,
    input: {
      /** undefined → mint a matching token; null → omit the header; string → send as-is. */
      appToken?: string | null;
      encodedKubeconfig?: string;
      legacyUserId?: string;
      method?: string;
      namespace?: string;
      token?: string;
    }
  ) => {
    const url = new URL(pathname, "https://brain.test");
    if (input.namespace != null) {
      url.searchParams.set("namespace", input.namespace);
    }
    if (input.legacyUserId != null) {
      url.searchParams.set("userId", input.legacyUserId);
    }
    let headers: Record<string, string> | undefined;
    if (input.encodedKubeconfig != null || input.token != null) {
      const encodedKubeconfig =
        input.encodedKubeconfig ??
        kubeconfig({
          namespace: input.namespace ?? "shared",
          token: input.token ?? "",
        });
      headers = { Authorization: `Bearer ${encodedKubeconfig}` };
      if (input.appToken === undefined) {
        Object.assign(headers, await appTokenHeaderFor(encodedKubeconfig));
      } else if (input.appToken !== null) {
        headers["X-Sealos-App-Token"] = input.appToken;
      }
    }
    return new Request(url, { headers, method: input.method });
  };

  return {
    adoptions,
    appInstallSessions,
    authorizationTokens,
    connections,
    callbackOAuth: (input: {
      code?: string;
      error?: string;
      legacyUserId?: string;
      state?: string;
    }) => {
      const url = new URL("https://brain.test/api/callback/github");
      if (input.code != null) {
        url.searchParams.set("code", input.code);
      }
      if (input.error != null) {
        url.searchParams.set("error", input.error);
      }
      if (input.state != null) {
        url.searchParams.set("state", input.state);
      }
      if (input.legacyUserId != null) {
        url.searchParams.set("userId", input.legacyUserId);
      }
      return callbackHandler(new Request(url));
    },
    callbackWrites,
    deleteConnection: async (input: {
      legacyUserId?: string;
      namespace: string;
      token: string;
    }) =>
      deleteHandler(
        await buildRequest("/api/github/connection", {
          ...input,
          method: "DELETE",
        })
      ),
    deletes,
    getStatus: async (request: {
      appToken?: string | null;
      encodedKubeconfig?: string;
      legacyUserId?: string;
      namespace?: string;
      token?: string;
    }) => {
      return handler(await buildRequest("/api/github/connection", request));
    },
    oauthSessions,
    oauthStates,
    startOAuth: async (input: {
      legacyUserId?: string;
      namespace: string;
      returnPath?: string;
      token: string;
    }) => {
      const encodedKubeconfig = kubeconfig({
        namespace: input.namespace,
        token: input.token,
      });
      return oauthSessionHandler(
        new Request("https://brain.test/api/github/oauth-session", {
          body: JSON.stringify({
            encodedKubeconfig,
            namespace: input.namespace,
            returnPath: input.returnPath,
            userId: input.legacyUserId,
          }),
          headers: {
            "content-type": "application/json",
            ...(await appTokenHeaderFor(encodedKubeconfig)),
          },
          method: "POST",
        })
      );
    },
    startAppInstall: async (input: {
      legacyUserId?: string;
      namespace: string;
      returnPath?: string;
      token: string;
    }) => {
      const encodedKubeconfig = kubeconfig({
        namespace: input.namespace,
        token: input.token,
      });
      return appInstallSessionHandler(
        new Request("https://brain.test/api/github/install-session", {
          body: JSON.stringify({
            encodedKubeconfig,
            namespace: input.namespace,
            returnPath: input.returnPath,
            userId: input.legacyUserId,
          }),
          headers: {
            "content-type": "application/json",
            ...(await appTokenHeaderFor(encodedKubeconfig)),
          },
          method: "POST",
        })
      );
    },
    listRepositories: async (input: {
      legacyUserId?: string;
      namespace: string;
      token: string;
    }) => repositoriesHandler(await buildRequest("/api/github/repos", input)),
    lookups,
    repositoryLookups,
  };
}

test("connection status ignores legacy userId and reads the verified actor's uid-keyed connection", async () => {
  const aliceToken = jwt("system:serviceaccount:user-system:alice-cr");
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map([
      [
        "shared:alice-cr-uid:2",
        {
          accessTokenCiphertext: "secret",
          accountLogin: "alice-github",
          id: "connection-alice",
        },
      ],
      ["shared:bob-cr-uid:2", { accountLogin: "bob-github" }],
    ]),
  });

  const response = await harness.getStatus({
    legacyUserId: "bob-cr",
    namespace: "shared",
    token: aliceToken,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    connection: { accountLogin: "alice-github" },
  });
  assert.deepEqual(harness.authorizationTokens, [aliceToken]);
  assert.deepEqual(harness.lookups, [
    {
      namespace: "shared",
      ownerIdentityVersion: 2,
      userUid: "alice-cr-uid",
    },
  ]);
});

test("members in one namespace see only their own connection status", async () => {
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map([
      ["shared:alice-cr-uid:2", { accountLogin: "alice-github" }],
      ["shared:bob-cr-uid:2", { accountLogin: "bob-github" }],
    ]),
  });

  const aliceResponse = await harness.getStatus({
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });
  const bobResponse = await harness.getStatus({
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:bob-cr"),
  });

  assert.deepEqual(await aliceResponse.json(), {
    connection: { accountLogin: "alice-github" },
  });
  assert.deepEqual(await bobResponse.json(), {
    connection: { accountLogin: "bob-github" },
  });
});

test("repository listing ignores legacy userId and uses only the verified actor's connection", async () => {
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map([
      [
        "shared:alice-cr-uid:2",
        {
          accountLogin: "alice-github",
          repositories: [{ fullName: "alice/private" }],
        },
      ],
      [
        "shared:bob-cr-uid:2",
        {
          accountLogin: "bob-github",
          repositories: [{ fullName: "bob/private" }],
        },
      ],
    ]),
  });

  const response = await harness.listRepositories({
    legacyUserId: "bob-cr",
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    repos: [{ fullName: "alice/private" }],
  });
  assert.deepEqual(harness.repositoryLookups, [
    {
      namespace: "shared",
      ownerIdentityVersion: 2,
      userUid: "alice-cr-uid",
    },
  ]);
});

test("disconnect ignores legacy userId and removes only the verified actor's connection", async () => {
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map([
      ["shared:alice-cr-uid:2", { accountLogin: "alice-github" }],
      ["shared:bob-cr-uid:2", { accountLogin: "bob-github" }],
    ]),
  });

  const response = await harness.deleteConnection({
    legacyUserId: "alice-cr",
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:bob-cr"),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { connection: null });
  assert.equal(harness.connections.has("shared:alice-cr-uid:2"), true);
  assert.equal(harness.connections.has("shared:bob-cr-uid:2"), false);
  assert.deepEqual(harness.deletes, [
    {
      legacyWorkspaceActor: "bob-cr",
      owner: {
        namespace: "shared",
        ownerIdentityVersion: 2,
        userUid: "bob-cr-uid",
      },
    },
  ]);
});

test("OAuth session creation binds state to the verified actor and ignores legacy userId", async () => {
  const harness = createWorkspaceActorHttpHarness({ connections: new Map() });

  const response = await harness.startOAuth({
    legacyUserId: "bob-cr",
    namespace: "shared",
    returnPath: "/projects?source=github",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    authorizeUrl: "https://github.test/login/oauth/authorize?state=oauth-state",
    state: "oauth-state",
  });
  assert.deepEqual(harness.oauthSessions, [
    {
      actor: {
        legacyWorkspaceActor: "alice-cr",
        owner: {
          namespace: "shared",
          ownerIdentityVersion: 2,
          userUid: "alice-cr-uid",
        },
      },
      baseUrl: "https://brain.test",
      returnPath: "/projects?source=github",
    },
  ]);
});

test("GitHub App install session uses the same verified owner authorization", async () => {
  const harness = createWorkspaceActorHttpHarness({ connections: new Map() });

  const response = await harness.startAppInstall({
    legacyUserId: "bob-cr",
    namespace: "shared",
    returnPath: "/projects?source=github",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    installUrl: "https://github.test/apps/sealai/installations/new",
    namespace: "shared",
    state: "app-state",
  });
  assert.deepEqual(harness.appInstallSessions, [
    {
      actor: {
        legacyWorkspaceActor: "alice-cr",
        owner: {
          namespace: "shared",
          ownerIdentityVersion: 2,
          userUid: "alice-cr-uid",
        },
      },
      returnPath: "/projects?source=github",
    },
  ]);
});

test("OAuth callback consumes the bound owner exactly once under concurrency", async () => {
  const harness = createWorkspaceActorHttpHarness({ connections: new Map() });
  await harness.startOAuth({
    legacyUserId: "bob-cr",
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });

  const responses = await Promise.all([
    harness.callbackOAuth({
      code: "first-code",
      legacyUserId: "bob-cr",
      state: "oauth-state",
    }),
    harness.callbackOAuth({
      code: "second-code",
      legacyUserId: "bob-cr",
      state: "oauth-state",
    }),
  ]);

  assert.deepEqual(
    responses.map((response) => response.status).sort((a, b) => a - b),
    [302, 400]
  );
  const failure = responses.find((response) => response.status === 400);
  assert.ok(failure);
  assert.deepEqual(await failure.json(), {
    code: "invalid_oauth_state",
    error: "OAuth state is missing, expired, invalid, or already consumed.",
  });
  assert.equal(harness.callbackWrites.length, 1);
  assert.deepEqual(harness.callbackWrites[0]?.owner, {
    namespace: "shared",
    ownerIdentityVersion: 2,
    userUid: "alice-cr-uid",
  });
  assert.equal(harness.connections.has("shared:alice-cr-uid:2"), true);
  assert.equal(harness.connections.has("shared:bob-cr-uid:2"), false);
});

test("OAuth callback rolls state consumption back when connection persistence fails", async () => {
  const harness = createWorkspaceActorHttpHarness({
    callbackFailures: 1,
    connections: new Map(),
  });
  await harness.startOAuth({
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });

  await assert.rejects(
    harness.callbackOAuth({ code: "first-code", state: "oauth-state" }),
    PERSISTENCE_FAILURE_RE
  );
  const retry = await harness.callbackOAuth({
    code: "second-code",
    state: "oauth-state",
  });

  assert.equal(retry.status, 302);
  assert.equal(harness.callbackWrites.length, 1);
  assert.equal(harness.connections.has("shared:alice-cr-uid:2"), true);
});

test("OAuth denial consumes valid state and rejects replay", async () => {
  const harness = createWorkspaceActorHttpHarness({ connections: new Map() });
  await harness.startOAuth({
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });

  const denied = await harness.callbackOAuth({
    error: "access_denied",
    state: "oauth-state",
  });
  const replay = await harness.callbackOAuth({
    error: "access_denied",
    state: "oauth-state",
  });

  assert.equal(denied.status, 302);
  assert.equal(replay.status, 400);
  assert.deepEqual(await replay.json(), {
    code: "invalid_oauth_state",
    error: "OAuth state is missing, expired, invalid, or already consumed.",
  });
});

test("invalid OAuth state takes precedence over a missing authorization code", async () => {
  const harness = createWorkspaceActorHttpHarness({ connections: new Map() });
  await harness.startOAuth({
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });
  const state = harness.oauthStates.get("oauth-state");
  assert.ok(state);
  harness.oauthStates.set("oauth-state", {
    ...state,
    expiresAt: new Date(Date.now() - 1),
  });

  const response = await harness.callbackOAuth({ state: "oauth-state" });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    code: "invalid_oauth_state",
    error: "OAuth state is missing, expired, invalid, or already consumed.",
  });
});

test("OAuth callback and denial reject expired or identity-mismatched state", async () => {
  const harness = createWorkspaceActorHttpHarness({ connections: new Map() });
  await harness.startOAuth({
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });
  const state = harness.oauthStates.get("oauth-state");
  assert.ok(state);
  harness.oauthStates.set("oauth-state", {
    ...state,
    expiresAt: new Date(Date.now() - 1),
  });

  const expired = await harness.callbackOAuth({
    error: "access_denied",
    state: "oauth-state",
  });
  assert.equal(expired.status, 400);
  assert.deepEqual(await expired.json(), {
    code: "invalid_oauth_state",
    error: "OAuth state is missing, expired, invalid, or already consumed.",
  });

  harness.oauthStates.set("oauth-state", {
    ...state,
    // A legacy-generation pending state is never honored (nor re-keyed).
    owner: { ...state.owner, ownerIdentityVersion: 1 },
  });
  const mismatched = await harness.callbackOAuth({
    code: "oauth-code",
    state: "oauth-state",
  });
  assert.equal(mismatched.status, 400);
  assert.deepEqual(await mismatched.json(), {
    code: "invalid_oauth_state",
    error: "OAuth state is missing, expired, invalid, or already consumed.",
  });
  assert.deepEqual(harness.callbackWrites, []);
});

test("reauthorization creates the current owner connection without reviving legacy state", async () => {
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map([
      ["shared:alice-cr:1", { accountLogin: "legacy-github" }],
    ]),
  });
  await harness.startOAuth({
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });

  const response = await harness.callbackOAuth({
    code: "oauth-code",
    state: "oauth-state",
  });

  assert.equal(response.status, 302);
  assert.equal(
    harness.connections.get("shared:alice-cr:1")?.accountLogin,
    "legacy-github"
  );
  assert.equal(
    harness.connections.get("shared:alice-cr-uid:2")?.accountLogin,
    "alice-cr-uid-github"
  );
});

test("rejects an authorized workload ServiceAccount on the personal endpoint", async () => {
  const harness = createWorkspaceActorHttpHarness({ connections: new Map() });

  const response = await harness.getStatus({
    namespace: "shared",
    token: jwt("system:serviceaccount:shared:default"),
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    code: "workspace_actor_required",
    error: "A verified Workspace Actor is required.",
  });
  assert.deepEqual(harness.lookups, []);
});

test("returns authentication_required when the kubeconfig has no bearer token", async () => {
  const harness = createWorkspaceActorHttpHarness({ connections: new Map() });

  const response = await harness.getStatus({
    namespace: "shared",
    token: "",
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    code: "authentication_required",
    error: "Authentication is required.",
  });
  assert.deepEqual(harness.lookups, []);
});

test("checks authentication before validating a missing namespace", async () => {
  const harness = createWorkspaceActorHttpHarness({ connections: new Map() });

  const response = await harness.getStatus({});

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    code: "authentication_required",
    error: "Authentication is required.",
  });
});

test("returns workspace_actor_required when an authenticated token has no eligible subject", async () => {
  const harness = createWorkspaceActorHttpHarness({ connections: new Map() });

  const response = await harness.getStatus({
    namespace: "shared",
    token: "authenticated-but-not-a-jwt",
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    code: "workspace_actor_required",
    error: "A verified Workspace Actor is required.",
  });
});

test("returns namespace_forbidden when Kubernetes denies namespace access", async () => {
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map(),
    verification: {
      message: "Kubeconfig is not authorized for this namespace.",
      ok: false,
      status: 403,
    },
  });

  const response = await harness.getStatus({
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    code: "namespace_forbidden",
    error: "Namespace is not accessible.",
  });
  assert.deepEqual(harness.lookups, []);
});

test("uses the active user token for both namespace authorization and actor resolution", async () => {
  const inactiveToken = jwt("system:serviceaccount:user-system:inactive-cr");
  const activeToken = jwt("system:serviceaccount:user-system:active-cr");
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map([
      ["shared:active-cr-uid:2", { accountLogin: "active-github" }],
    ]),
  });

  const response = await harness.getStatus({
    encodedKubeconfig: kubeconfigWithTwoUsers({
      activeToken,
      inactiveToken,
      namespace: "shared",
    }),
    namespace: "shared",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(harness.authorizationTokens, [activeToken]);
  assert.deepEqual(harness.lookups, [
    {
      namespace: "shared",
      ownerIdentityVersion: 2,
      userUid: "active-cr-uid",
    },
  ]);
  assert.deepEqual(await response.json(), {
    connection: { accountLogin: "active-github" },
  });
});

test("token rotation preserves the Workspace Actor and connection status", async () => {
  const subject = "system:serviceaccount:user-system:alice-cr";
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map([
      ["shared:alice-cr-uid:2", { accountLogin: "alice-github" }],
    ]),
  });

  const oldTokenResponse = await harness.getStatus({
    namespace: "shared",
    token: jwt(subject, "old-service-account-token"),
  });
  const newTokenResponse = await harness.getStatus({
    namespace: "shared",
    token: jwt(subject, "new-service-account-token"),
  });

  assert.deepEqual(await oldTokenResponse.json(), {
    connection: { accountLogin: "alice-github" },
  });
  assert.deepEqual(await newTokenResponse.json(), {
    connection: { accountLogin: "alice-github" },
  });
  assert.deepEqual(
    harness.lookups.map((lookup) => lookup.userUid),
    ["alice-cr-uid", "alice-cr-uid"]
  );
});

test("personal connection routes return 401 without the app token header", async () => {
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map([
      ["shared:alice-cr-uid:2", { accountLogin: "alice-github" }],
    ]),
  });

  const response = await harness.getStatus({
    appToken: null,
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    code: "app_token_required",
    error: "Authentication is required.",
  });
  assert.deepEqual(harness.lookups, []);
});

test("an app token bound to another actor is refused with 403", async () => {
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map([
      ["shared:alice-cr-uid:2", { accountLogin: "alice-github" }],
    ]),
  });

  const response = await harness.getStatus({
    appToken: await mintAppToken("bob-cr"),
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    code: "app_token_mismatch",
    error: "App token does not match the authenticated actor or region.",
  });
  assert.deepEqual(harness.lookups, []);
});

test("an app token signed with the wrong secret is refused with 401", async () => {
  const harness = createWorkspaceActorHttpHarness({ connections: new Map() });

  const response = await harness.getStatus({
    appToken: await mintAppToken("alice-cr", "attacker-secret"),
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    code: "app_token_invalid",
    error: "Authentication is required.",
  });
  assert.deepEqual(harness.lookups, []);
});

test("a legacy generation-1 connection is adopted to the uid owner on first verified entry", async () => {
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map([
      ["shared:alice-cr:1", { accountLogin: "alice-github" }],
    ]),
  });

  const first = await harness.getStatus({
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });
  const second = await harness.getStatus({
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });

  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    connection: { accountLogin: "alice-github" },
  });
  assert.deepEqual(await second.json(), {
    connection: { accountLogin: "alice-github" },
  });
  assert.equal(harness.connections.has("shared:alice-cr:1"), false);
  assert.equal(harness.connections.has("shared:alice-cr-uid:2"), true);
  assert.deepEqual(harness.adoptions, [
    {
      legacyWorkspaceActor: "alice-cr",
      owner: {
        namespace: "shared",
        ownerIdentityVersion: 2,
        userUid: "alice-cr-uid",
      },
    },
    {
      legacyWorkspaceActor: "alice-cr",
      owner: {
        namespace: "shared",
        ownerIdentityVersion: 2,
        userUid: "alice-cr-uid",
      },
    },
  ]);
});

test("adopting after reauthorization keeps the uid connection and leaves the legacy row inert", async () => {
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map([
      ["shared:alice-cr:1", { accountLogin: "legacy-github" }],
      ["shared:alice-cr-uid:2", { accountLogin: "reauthorized-github" }],
    ]),
  });

  const response = await harness.getStatus({
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    connection: { accountLogin: "reauthorized-github" },
  });
  assert.equal(
    harness.connections.get("shared:alice-cr:1")?.accountLogin,
    "legacy-github"
  );
});

test("another member's verified entry never adopts a foreign legacy connection", async () => {
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map([
      ["shared:alice-cr:1", { accountLogin: "alice-github" }],
    ]),
  });

  const response = await harness.getStatus({
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:bob-cr"),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { connection: null });
  assert.equal(harness.connections.has("shared:alice-cr:1"), true);
  assert.deepEqual(harness.adoptions, [
    {
      legacyWorkspaceActor: "bob-cr",
      owner: {
        namespace: "shared",
        ownerIdentityVersion: 2,
        userUid: "bob-cr-uid",
      },
    },
  ]);
});

test("disconnect forgets the actor's connection across both generations", async () => {
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map([
      ["shared:alice-cr:1", { accountLogin: "alice-github" }],
    ]),
  });

  const response = await harness.deleteConnection({
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { connection: null });
  assert.equal(harness.connections.size, 0);
  assert.deepEqual(harness.deletes, [
    {
      legacyWorkspaceActor: "alice-cr",
      owner: {
        namespace: "shared",
        ownerIdentityVersion: 2,
        userUid: "alice-cr-uid",
      },
    },
  ]);
});

test("a forgotten authorization never resurrects from the inert legacy row after disconnect", async () => {
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map([
      ["shared:alice-cr:1", { accountLogin: "legacy-github" }],
      ["shared:alice-cr-uid:2", { accountLogin: "reauthorized-github" }],
    ]),
  });
  const aliceToken = jwt("system:serviceaccount:user-system:alice-cr");

  const disconnect = await harness.deleteConnection({
    namespace: "shared",
    token: aliceToken,
  });
  const statusAfter = await harness.getStatus({
    namespace: "shared",
    token: aliceToken,
  });

  assert.equal(disconnect.status, 200);
  assert.equal(statusAfter.status, 200);
  assert.deepEqual(await statusAfter.json(), { connection: null });
  assert.equal(harness.connections.size, 0);
});
