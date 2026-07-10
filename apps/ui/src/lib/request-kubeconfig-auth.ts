import { readFileSync } from "node:fs";
import { Agent } from "undici";
import { parse } from "yaml";
import { decodeKubeconfig } from "@/lib/chat-runtime/kubeconfig";
import { namespaceFromKubeconfigText } from "@/lib/chat-runtime/kubeconfig-namespace-core";

type FetchInitWithDispatcher = RequestInit & {
  dispatcher?: Agent;
};

const HEADER_WHITESPACE_RE = /\s+/;

interface KubeconfigCluster {
  "certificate-authority-data"?: string;
  "insecure-skip-tls-verify"?: boolean;
  server?: string;
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
}) => Promise<KubeconfigNamespaceVerification>;

function activeKubeconfigCredentials(kubeconfig: string):
  | {
      ca: string | undefined;
      insecureSkipTlsVerify: boolean;
      ok: true;
      server: string;
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
  if (serverUrl.protocol !== "https:" && serverUrl.protocol !== "http:") {
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
    token,
  };
}

function trimTrailingSlashes(value: string): string {
  let out = value;
  while (out.endsWith("/")) {
    out = out.slice(0, -1);
  }
  return out;
}

const IN_CLUSTER_CA_PATH =
  "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

/** Resolves a trusted endpoint and its matching CA without reading client kubeconfig trust. */
export function resolveTrustedKubernetesApiServer(input: {
  explicitCa?: string;
  explicitUrl?: string;
  inClusterCa?: string;
  serviceHost?: string;
  servicePort?: string;
}):
  | { ca: string | undefined; ok: true; server: string }
  | { message: string; ok: false } {
  const explicitCa = input.explicitCa?.trim() ?? "";
  const explicitUrl = input.explicitUrl?.trim() ?? "";
  const inClusterCa = input.inClusterCa?.trim() ?? "";
  const serviceHost = input.serviceHost?.trim() ?? "";
  const servicePort = input.servicePort?.trim() ?? "";

  if ((serviceHost === "") !== (servicePort === "")) {
    return {
      message: "In-cluster Kubernetes API server configuration is incomplete.",
      ok: false,
    };
  }

  let raw: string;
  let ca: string | undefined;
  if (serviceHost !== "" && servicePort !== "") {
    raw = `https://${serviceHost}:${servicePort}`;
    ca = inClusterCa || explicitCa || undefined;
  } else if (explicitUrl === "") {
    return {
      message:
        "Kubernetes API server is not configured (set K8S_API_URL or run in-cluster); refusing to verify namespace access.",
      ok: false,
    };
  } else {
    raw = explicitUrl;
    ca = explicitCa || undefined;
  }

  let serverUrl: URL;
  try {
    serverUrl = new URL(raw);
  } catch {
    return { message: "Trusted Kubernetes API server is invalid.", ok: false };
  }
  if (serverUrl.protocol !== "https:") {
    return {
      message: "Trusted Kubernetes API server must use https.",
      ok: false,
    };
  }
  return {
    ca,
    ok: true,
    server: trimTrailingSlashes(serverUrl.toString()),
  };
}

/**
 * The trusted Kubernetes API transport for namespace access reviews. Never the
 * client-supplied kubeconfig transport: verification against a server named by
 * that same credential would let an attacker return `allowed: true` (F5).
 * In-cluster coordinates and their mounted CA take precedence; K8S_API_URL/CA
 * are the off-cluster fallback. If the CA mount is disabled, K8S_API_CA may
 * supply the cluster CA without supplying a Pod service-account token.
 */
function trustedKubernetesApiServer(): ReturnType<
  typeof resolveTrustedKubernetesApiServer
> {
  const serviceHost = process.env.KUBERNETES_SERVICE_HOST;
  const servicePort = process.env.KUBERNETES_SERVICE_PORT;
  let inClusterCa: string | undefined;
  try {
    if (serviceHost?.trim() && servicePort?.trim()) {
      inClusterCa = readFileSync(IN_CLUSTER_CA_PATH, "utf8");
    }
  } catch {
    // K8S_API_CA or the default trust store remains available below.
  }

  return resolveTrustedKubernetesApiServer({
    explicitCa: process.env.K8S_API_CA,
    explicitUrl: process.env.K8S_API_URL,
    inClusterCa,
    serviceHost,
    servicePort,
  });
}

/**
 * Dispatcher for the trusted API server connection. TLS verification is always
 * enabled; the client kubeconfig's `insecure-skip-tls-verify` and CA are
 * deliberately ignored so a client cannot weaken or redirect the channel.
 */
function verificationDispatcher(ca: string | undefined): Agent | undefined {
  if (ca == null) {
    return undefined;
  }
  return new Agent({ connect: { ca, rejectUnauthorized: true } });
}

export async function verifyKubeconfigNamespaceAccess(input: {
  kubeconfig: string;
  namespace: string;
}): Promise<KubeconfigNamespaceVerification> {
  const credentials = activeKubeconfigCredentials(input.kubeconfig);
  if (!credentials.ok) {
    return { message: credentials.message, ok: false, status: 400 };
  }
  const apiServer = trustedKubernetesApiServer();
  if (!apiServer.ok) {
    return { message: apiServer.message, ok: false, status: 500 };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const url = new URL(
      "/apis/authorization.k8s.io/v1/selfsubjectaccessreviews",
      apiServer.server
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
      dispatcher: verificationDispatcher(apiServer.ca),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    };
    const response = await fetch(url, init as RequestInit);

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
  }
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

export async function authorizeEncodedKubeconfigNamespace(input: {
  encodedKubeconfig: string | undefined;
  namespace: string;
  subject: string;
  verify?: VerifyKubeconfigNamespace;
}): Promise<KubeconfigNamespaceAuthorization> {
  const encodedKubeconfig = input.encodedKubeconfig?.trim() ?? "";
  if (encodedKubeconfig === "") {
    return {
      message: "Authentication is required.",
      ok: false,
      status: 401,
    };
  }

  const kubeconfig = decodeKubeconfig(encodedKubeconfig);
  if (kubeconfig == null) {
    return {
      message: "Invalid kubeconfig.",
      ok: false,
      status: 400,
    };
  }

  const namespace = namespaceFromKubeconfigText(kubeconfig);
  if (namespace == null) {
    return {
      message: "Could not resolve namespace from kubeconfig.",
      ok: false,
      status: 400,
    };
  }

  if (namespace.trim() !== input.namespace.trim()) {
    return {
      message: `${input.subject} namespace is not accessible.`,
      ok: false,
      status: 403,
    };
  }

  const verification = await (input.verify ?? verifyKubeconfigNamespaceAccess)({
    kubeconfig,
    namespace,
  });
  if (!verification.ok) {
    return verification;
  }

  return {
    encodedKubeconfig,
    kubeconfig,
    namespace,
    ok: true,
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
