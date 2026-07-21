import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { decodeJwt } from "jose";
import { Agent } from "undici";
import { parse } from "yaml";
import { decodeKubeconfig } from "@/lib/kubeconfig";
import { namespaceFromKubeconfigText } from "@/lib/kubeconfig-namespace-core";

type FetchInitWithDispatcher = RequestInit & {
  dispatcher?: Agent;
};

const HEADER_WHITESPACE_RE = /\s+/;

interface KubeconfigCluster {
  "certificate-authority-data"?: string;
  "insecure-skip-tls-verify"?: boolean;
  server?: string;
  "tls-server-name"?: string;
}

interface KubeconfigContext {
  cluster?: string;
  namespace?: string;
  user?: string;
}

interface KubeconfigUser {
  token?: string;
}

interface KubeconfigYaml {
  clusters?: Array<{ cluster?: KubeconfigCluster; name?: string }>;
  contexts?: Array<{ context?: KubeconfigContext; name?: string }>;
  "current-context"?: string;
  users?: Array<{ name?: string; user?: KubeconfigUser }>;
}

export type KubeconfigNamespaceAuthorization =
  | {
      encodedKubeconfig: string;
      kubeconfig: string;
      namespace: string;
      ok: true;
    }
  | {
      message: string;
      ok: false;
      status: number;
    };

export type KubeconfigNamespaceVerification =
  | { ok: true }
  | { message: string; ok: false; status: number };

export type VerifyKubeconfigNamespace = (input: {
  kubeconfig: string;
  namespace: string;
  token: string;
}) => Promise<KubeconfigNamespaceVerification>;

export type WorkspaceActorAuthorization =
  | {
      namespace: string;
      ok: true;
      workspaceActor: string;
    }
  | {
      code:
        | "authentication_required"
        | "namespace_authorization_failed"
        | "namespace_forbidden"
        | "workspace_actor_required";
      message: string;
      ok: false;
      status: number;
    };

export type ResolvedKubeconfigNamespaceAuthorization =
  | {
      encodedKubeconfig: string;
      kubeconfig: string;
      namespace: string;
      ok: true;
    }
  | {
      code:
        | "authentication_required"
        | "invalid_kubeconfig"
        | "namespace_mismatch"
        | "namespace_unresolved";
      ok: false;
    }
  | {
      code: "verification_failed";
      message: string;
      ok: false;
      status: number;
    };

function activeKubeconfigCredentials(kubeconfig: string):
  | {
      ca: string | undefined;
      insecureSkipTlsVerify: boolean;
      ok: true;
      server: string;
      serverName: string | undefined;
      token: string;
    }
  | { message: string; ok: false } {
  let raw: unknown;
  try {
    raw = parse(kubeconfig);
  } catch {
    return { message: "Invalid kubeconfig.", ok: false };
  }
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { message: "Invalid kubeconfig.", ok: false };
  }

  const cfg = raw as KubeconfigYaml;
  const currentContext = cfg["current-context"]?.trim();
  if (!currentContext) {
    return { message: "Invalid kubeconfig current context.", ok: false };
  }
  const context = cfg.contexts?.find(
    (entry) => entry.name === currentContext
  )?.context;
  if (context == null) {
    return { message: "Invalid kubeconfig current context.", ok: false };
  }

  const cluster = cfg.clusters?.find(
    (entry) => entry.name === context.cluster
  )?.cluster;
  const user = cfg.users?.find((entry) => entry.name === context.user)?.user;
  const server = cluster?.server?.trim() ?? "";
  const token = user?.token?.trim() ?? "";
  if (server === "" || token === "") {
    return {
      message:
        "Kubeconfig must include an active cluster server and bearer token.",
      ok: false,
    };
  }

  let serverUrl: URL;
  try {
    serverUrl = new URL(server);
  } catch {
    return { message: "Kubeconfig cluster server is invalid.", ok: false };
  }
  if (!isAllowedKubernetesServerUrl(serverUrl)) {
    return { message: "Kubeconfig cluster server is invalid.", ok: false };
  }

  const caData = cluster?.["certificate-authority-data"]?.trim();
  let ca: string | undefined;
  if (caData) {
    try {
      ca = Buffer.from(caData, "base64").toString("utf8");
    } catch {
      return {
        message: "Kubeconfig certificate authority is invalid.",
        ok: false,
      };
    }
  }

  return {
    ca,
    insecureSkipTlsVerify: cluster?.["insecure-skip-tls-verify"] === true,
    ok: true,
    server: trimTrailingSlashes(serverUrl.toString()),
    serverName: cluster?.["tls-server-name"]?.trim() || undefined,
    token,
  };
}

function workspaceActorFromToken(token: string): string | null {
  try {
    const subject = decodeJwt(token).sub;
    if (typeof subject !== "string") {
      return null;
    }
    const prefix = "system:serviceaccount:user-system:";
    if (!subject.startsWith(prefix)) {
      return null;
    }
    const workspaceActor = subject.slice(prefix.length);
    return workspaceActor !== "" && !workspaceActor.includes(":")
      ? workspaceActor
      : null;
  } catch {
    return null;
  }
}

/** Resolve the active token's actor after its kubeconfig has been authorized. */
export function workspaceActorFromAuthorizedKubeconfig(
  kubeconfig: string
): string | null {
  const credentials = activeKubeconfigCredentials(kubeconfig);
  return credentials.ok ? workspaceActorFromToken(credentials.token) : null;
}

function trimTrailingSlashes(value: string): string {
  let out = value;
  while (out.endsWith("/")) {
    out = out.slice(0, -1);
  }
  return out;
}

function isAllowedKubernetesServerUrl(serverUrl: URL): boolean {
  if (serverUrl.protocol === "https:") {
    return true;
  }
  if (serverUrl.protocol !== "http:") {
    return false;
  }
  let hostname = serverUrl.hostname.toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }
  if (hostname === "localhost" || hostname === "::1") {
    return true;
  }
  return isIP(hostname) === 4 && hostname.startsWith("127.");
}

function joinHostPort(host: string, port: string): string {
  const unwrappedHost =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return isIP(unwrappedHost) === 6
    ? `[${unwrappedHost}]:${port}`
    : `${host}:${port}`;
}

function kubernetesApiUrl(server: string, path: string): URL {
  const url = new URL(server);
  let relativePath = path;
  while (relativePath.startsWith("/")) {
    relativePath = relativePath.slice(1);
  }
  url.pathname = `${trimTrailingSlashes(url.pathname)}/${relativePath}`;
  url.search = "";
  url.hash = "";
  return url;
}

const IN_CLUSTER_CA_PATH =
  "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

/** Pins Pods to their internal API transport and otherwise uses the active kubeconfig cluster. */
export function resolveKubernetesApiServer(input: {
  allowKubeconfigTransport?: boolean;
  inClusterCa?: string;
  kubeconfigCa?: string;
  kubeconfigInsecureSkipTlsVerify?: boolean;
  kubeconfigServer: string;
  kubeconfigServerName?: string;
  serviceHost?: string;
  servicePort?: string;
}):
  | {
      ca: string | undefined;
      insecureSkipTlsVerify: boolean;
      ok: true;
      server: string;
      serverName: string | undefined;
    }
  | { message: string; ok: false } {
  const inClusterCa = input.inClusterCa?.trim() ?? "";
  const kubeconfigCa = input.kubeconfigCa?.trim() ?? "";
  const kubeconfigServer = input.kubeconfigServer.trim();
  const kubeconfigServerName = input.kubeconfigServerName?.trim() || undefined;
  const serviceHost = input.serviceHost?.trim() ?? "";
  const servicePort = input.servicePort?.trim() ?? "";

  if ((serviceHost === "") !== (servicePort === "")) {
    return {
      message: "In-cluster Kubernetes API server configuration is incomplete.",
      ok: false,
    };
  }

  let insecureSkipTlsVerify: boolean;
  let raw: string;
  let ca: string | undefined;
  let serverName: string | undefined;
  if (serviceHost !== "" && servicePort !== "") {
    if (inClusterCa === "") {
      return {
        message: "In-cluster Kubernetes API server CA is unavailable.",
        ok: false,
      };
    }
    raw = `https://${joinHostPort(serviceHost, servicePort)}`;
    ca = inClusterCa;
    insecureSkipTlsVerify = false;
    serverName = undefined;
  } else {
    if (input.allowKubeconfigTransport !== true) {
      return {
        message:
          "Off-cluster Kubernetes API access is available only in development.",
        ok: false,
      };
    }
    raw = kubeconfigServer;
    insecureSkipTlsVerify = input.kubeconfigInsecureSkipTlsVerify === true;
    ca = insecureSkipTlsVerify ? undefined : kubeconfigCa || undefined;
    serverName = kubeconfigServerName;
  }

  let serverUrl: URL;
  try {
    serverUrl = new URL(raw);
  } catch {
    return { message: "Kubernetes API server is invalid.", ok: false };
  }
  if (!isAllowedKubernetesServerUrl(serverUrl)) {
    return {
      message: "Kubernetes API server must use HTTPS unless it is loopback.",
      ok: false,
    };
  }
  return {
    ca,
    insecureSkipTlsVerify,
    ok: true,
    server: trimTrailingSlashes(serverUrl.toString()),
    serverName,
  };
}

/**
 * Production Pods use only their Kubernetes-injected endpoint and mounted CA.
 * Off-cluster development follows the active kubeconfig cluster transport.
 */
function kubernetesApiServer(
  credentials: Extract<
    ReturnType<typeof activeKubeconfigCredentials>,
    { ok: true }
  >
): ReturnType<typeof resolveKubernetesApiServer> {
  const serviceHost = process.env.KUBERNETES_SERVICE_HOST;
  const servicePort = process.env.KUBERNETES_SERVICE_PORT;
  let inClusterCa: string | undefined;
  try {
    if (serviceHost?.trim() && servicePort?.trim()) {
      inClusterCa = readFileSync(IN_CLUSTER_CA_PATH, "utf8");
    }
  } catch {
    // The resolver fails closed for an in-cluster process without its mounted CA.
  }

  return resolveKubernetesApiServer({
    allowKubeconfigTransport: process.env.NODE_ENV === "development",
    inClusterCa,
    kubeconfigCa: credentials.ca,
    kubeconfigInsecureSkipTlsVerify: credentials.insecureSkipTlsVerify,
    kubeconfigServer: credentials.server,
    kubeconfigServerName: credentials.serverName,
    serviceHost,
    servicePort,
  });
}

function verificationDispatcher(input: {
  ca: string | undefined;
  insecureSkipTlsVerify: boolean;
  serverName: string | undefined;
}): Agent | undefined {
  if (
    input.ca == null &&
    !input.insecureSkipTlsVerify &&
    input.serverName == null
  ) {
    return undefined;
  }
  return new Agent({
    connect: {
      ca: input.ca,
      rejectUnauthorized: !input.insecureSkipTlsVerify,
      servername: input.serverName,
    },
  });
}

async function verifyKubeconfigNamespaceAccessWithCredentials(input: {
  credentials: Extract<
    ReturnType<typeof activeKubeconfigCredentials>,
    { ok: true }
  >;
  namespace: string;
}): Promise<KubeconfigNamespaceVerification> {
  const apiServer = kubernetesApiServer(input.credentials);
  if (!apiServer.ok) {
    return { message: apiServer.message, ok: false, status: 500 };
  }

  const controller = new AbortController();
  const dispatcher = verificationDispatcher(apiServer);
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const url = kubernetesApiUrl(
      apiServer.server,
      "/apis/authorization.k8s.io/v1/selfsubjectaccessreviews"
    );
    const init: FetchInitWithDispatcher = {
      body: JSON.stringify({
        apiVersion: "authorization.k8s.io/v1",
        kind: "SelfSubjectAccessReview",
        spec: {
          resourceAttributes: {
            group: "",
            namespace: input.namespace,
            resource: "pods",
            verb: "list",
          },
        },
      }),
      dispatcher,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.credentials.token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    };
    const response = await fetch(url, init as RequestInit);
    if (!response.ok) {
      await response.body?.cancel();
    }

    if (response.status === 401) {
      return {
        message: "Kubeconfig token is not authenticated.",
        ok: false,
        status: 401,
      };
    }
    if (response.status === 403) {
      return {
        message: "Kubeconfig cannot perform access review.",
        ok: false,
        status: 403,
      };
    }
    if (!response.ok) {
      return {
        message: `Kubernetes access review failed with status ${response.status}.`,
        ok: false,
        status: 502,
      };
    }

    const body = (await response.json().catch(() => null)) as {
      status?: { allowed?: unknown; reason?: unknown };
    } | null;
    if (body?.status?.allowed === true) {
      return { ok: true };
    }
    const reason =
      typeof body?.status?.reason === "string" &&
      body.status.reason.trim() !== ""
        ? ` ${body.status.reason.trim()}`
        : "";
    return {
      message: `Kubeconfig is not authorized for this namespace.${reason}`,
      ok: false,
      status: 403,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error && error.name === "AbortError"
          ? "Kubernetes access review timed out."
          : "Kubernetes access review failed.",
      ok: false,
      status: 502,
    };
  } finally {
    clearTimeout(timeout);
    await dispatcher?.close();
  }
}

export function verifyKubeconfigNamespaceAccess(input: {
  kubeconfig: string;
  namespace: string;
  token: string;
}): Promise<KubeconfigNamespaceVerification> {
  const credentials = activeKubeconfigCredentials(input.kubeconfig);
  if (!credentials.ok) {
    return Promise.resolve({
      message: credentials.message,
      ok: false,
      status: 400,
    });
  }
  if (credentials.token !== input.token) {
    return Promise.resolve({
      message: "Kubeconfig token is not authenticated.",
      ok: false,
      status: 401,
    });
  }
  return verifyKubeconfigNamespaceAccessWithCredentials({
    credentials,
    namespace: input.namespace,
  });
}

function bearerToken(header: string | null): string {
  const value = header?.trim() ?? "";
  if (value === "") {
    return "";
  }
  const [scheme, ...rest] = value.split(HEADER_WHITESPACE_RE);
  if (scheme?.toLowerCase() !== "bearer") {
    return "";
  }
  return rest.join(" ").trim();
}

export function encodedKubeconfigFromRequest(request: Request): string {
  return bearerToken(request.headers.get("authorization"));
}

/**
 * Resolves and authorizes the active namespace carried by a request kubeconfig.
 * Callers may adapt the typed failures to their existing HTTP error contracts.
 */
type VerifiedKubeconfigNamespaceAuthorization =
  | Exclude<ResolvedKubeconfigNamespaceAuthorization, { ok: true }>
  | (Extract<ResolvedKubeconfigNamespaceAuthorization, { ok: true }> & {
      token: string;
    });

async function resolveKubeconfigNamespaceAuthorization(input: {
  encodedKubeconfig: string | undefined;
  expectedNamespace?: string;
  normalizeNamespace?: (namespace: string) => string;
  verify?: VerifyKubeconfigNamespace;
}): Promise<VerifiedKubeconfigNamespaceAuthorization> {
  const encodedKubeconfig = input.encodedKubeconfig ?? "";
  if (encodedKubeconfig === "") {
    return { code: "authentication_required", ok: false };
  }

  const kubeconfig = decodeKubeconfig(encodedKubeconfig);
  if (kubeconfig == null) {
    return { code: "invalid_kubeconfig", ok: false };
  }

  const resolvedNamespace = namespaceFromKubeconfigText(kubeconfig);
  if (resolvedNamespace == null || resolvedNamespace === "") {
    return { code: "namespace_unresolved", ok: false };
  }

  const normalizeNamespace =
    input.normalizeNamespace ?? ((value) => value.trim());
  const namespace = normalizeNamespace(resolvedNamespace);
  if (
    input.expectedNamespace !== undefined &&
    normalizeNamespace(input.expectedNamespace) !== namespace
  ) {
    return { code: "namespace_mismatch", ok: false };
  }

  const credentials = activeKubeconfigCredentials(kubeconfig);
  const token = credentials.ok ? credentials.token : "";
  let verification: KubeconfigNamespaceVerification;
  if (input.verify) {
    verification = await input.verify({ kubeconfig, namespace, token });
  } else if (credentials.ok) {
    verification = await verifyKubeconfigNamespaceAccessWithCredentials({
      credentials,
      namespace,
    });
  } else {
    verification = { message: credentials.message, ok: false, status: 400 };
  }
  if (!verification.ok) {
    return {
      code: "verification_failed",
      message: verification.message,
      ok: false,
      status: verification.status,
    };
  }

  return {
    encodedKubeconfig,
    kubeconfig,
    namespace,
    ok: true,
    token,
  };
}

export async function authorizeKubeconfigNamespace(input: {
  encodedKubeconfig: string | undefined;
  expectedNamespace?: string;
  normalizeNamespace?: (namespace: string) => string;
  verify?: VerifyKubeconfigNamespace;
}): Promise<ResolvedKubeconfigNamespaceAuthorization> {
  const authorization = await resolveKubeconfigNamespaceAuthorization(input);
  if (!authorization.ok) {
    return authorization;
  }
  return {
    encodedKubeconfig: authorization.encodedKubeconfig,
    kubeconfig: authorization.kubeconfig,
    namespace: authorization.namespace,
    ok: true,
  };
}

/**
 * Authorizes a namespace and then resolves the individual represented by the
 * exact bearer token supplied to that authorization attempt.
 */
export async function authorizeWorkspaceActor(input: {
  encodedKubeconfig: string | undefined;
  expectedNamespace?: string;
  normalizeNamespace?: (namespace: string) => string;
  verify?: VerifyKubeconfigNamespace;
}): Promise<WorkspaceActorAuthorization> {
  const authorization = await resolveKubeconfigNamespaceAuthorization({
    encodedKubeconfig: input.encodedKubeconfig,
    expectedNamespace: input.expectedNamespace,
    normalizeNamespace: input.normalizeNamespace,
    verify: input.verify,
  });

  if (!authorization.ok) {
    if (
      authorization.code === "authentication_required" ||
      authorization.code === "invalid_kubeconfig" ||
      (authorization.code === "verification_failed" &&
        authorization.status === 401)
    ) {
      return {
        code: "authentication_required",
        message: "Authentication is required.",
        ok: false,
        status: 401,
      };
    }
    if (
      authorization.code === "namespace_mismatch" ||
      (authorization.code === "verification_failed" &&
        authorization.status === 403)
    ) {
      return {
        code: "namespace_forbidden",
        message: "Namespace is not accessible.",
        ok: false,
        status: 403,
      };
    }
    if (authorization.code === "verification_failed") {
      return {
        code: "namespace_authorization_failed",
        message: authorization.message,
        ok: false,
        status: authorization.status,
      };
    }
    return {
      code: "authentication_required",
      message: "Authentication is required.",
      ok: false,
      status: 401,
    };
  }

  if (authorization.token === "") {
    return {
      code: "authentication_required",
      message: "Authentication is required.",
      ok: false,
      status: 401,
    };
  }
  const workspaceActor = workspaceActorFromToken(authorization.token);
  if (workspaceActor == null) {
    return {
      code: "workspace_actor_required",
      message: "A verified Workspace Actor is required.",
      ok: false,
      status: 403,
    };
  }
  return {
    namespace: authorization.namespace,
    ok: true,
    workspaceActor,
  };
}

export async function authorizeEncodedKubeconfigNamespace(input: {
  encodedKubeconfig: string | undefined;
  namespace: string;
  subject: string;
  verify?: VerifyKubeconfigNamespace;
}): Promise<KubeconfigNamespaceAuthorization> {
  const authorization = await authorizeKubeconfigNamespace({
    encodedKubeconfig: input.encodedKubeconfig?.trim(),
    expectedNamespace: input.namespace,
    verify: input.verify,
  });
  if (authorization.ok) {
    return authorization;
  }

  if (authorization.code === "verification_failed") {
    return {
      message: authorization.message,
      ok: false,
      status: authorization.status,
    };
  }
  if (authorization.code === "authentication_required") {
    return {
      message: "Authentication is required.",
      ok: false,
      status: 401,
    };
  }
  if (authorization.code === "invalid_kubeconfig") {
    return { message: "Invalid kubeconfig.", ok: false, status: 400 };
  }
  if (authorization.code === "namespace_unresolved") {
    return {
      message: "Could not resolve namespace from kubeconfig.",
      ok: false,
      status: 400,
    };
  }
  return {
    message: `${input.subject} namespace is not accessible.`,
    ok: false,
    status: 403,
  };
}

export function authorizeRequestNamespace(
  request: Request,
  input: {
    namespace: string;
    subject: string;
    verify?: VerifyKubeconfigNamespace;
  }
): Promise<KubeconfigNamespaceAuthorization> {
  return authorizeEncodedKubeconfigNamespace({
    encodedKubeconfig: encodedKubeconfigFromRequest(request),
    namespace: input.namespace,
    subject: input.subject,
    verify: input.verify,
  });
}
