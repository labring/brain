import fs from "node:fs";
import { SignJWT } from "jose";
import { parse } from "yaml";

const DOTENV_ENTRY_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

function readDotenv(path) {
  const envText = fs.readFileSync(path, "utf8");
  return Object.fromEntries(
    envText
      .split("\n")
      .filter((line) => DOTENV_ENTRY_RE.test(line))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1)];
      })
  );
}

function namespaceFromKubeconfig(kubeconfig) {
  const kc = parse(kubeconfig);
  const current = kc?.["current-context"];
  const context = kc?.contexts?.find((item) => item.name === current)?.context;
  return context?.namespace;
}

const env = readDotenv(".env");
const kubeconfig = decodeURIComponent(
  env.NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG || ""
);
const namespace = namespaceFromKubeconfig(kubeconfig);
const devboxApiBaseUrl = (env.DEVBOX_API_BASE_URL || "").replace(/\/+$/, "");

if (!namespace) {
  throw new Error("namespace not found in kubeconfig current-context");
}
if (!devboxApiBaseUrl) {
  throw new Error("DEVBOX_API_BASE_URL is missing");
}
if (!env.DEVBOX_JWT_SIGNING_KEY) {
  throw new Error("DEVBOX_JWT_SIGNING_KEY is missing");
}

const now = Math.floor(Date.now() / 1000);
const token = await new SignJWT({ namespace })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt(now)
  .setExpirationTime(now + Number(env.DEVBOX_JWT_TTL_SECONDS || 14_400))
  .sign(new TextEncoder().encode(env.DEVBOX_JWT_SIGNING_KEY));

const name = `sealai-curl-${Date.now()}`;
const url = `${devboxApiBaseUrl}/api/v1/devbox`;
const body = {
  env: { SEALAI_ASSISTANT_NAMESPACE: namespace },
  kubeAccess: { enabled: true, roleTemplate: "edit" },
  labels: [
    { key: "app.kubernetes.io/managed-by", value: "sealai" },
    { key: "app.kubernetes.io/component", value: "assistant-runtime" },
  ],
  name,
  pauseAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  upstreamID: name,
};

console.log("namespace:", namespace);
console.log("url:", url);
console.log("devbox:", name);

const response = await fetch(url, {
  body: JSON.stringify(body),
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  method: "POST",
});

console.log("status:", response.status, response.statusText);
console.log(await response.text());
