#!/usr/bin/env bun
/**
 * Mints a local-dev App Token (ADR-0059) for the dev kubeconfig's crName,
 * signed with the dev `JWT_INTERNAL`. The production verifier has zero
 * development branches, so dev traffic needs a genuinely signed token; this
 * script is how it gets minted.
 *
 * Usage (from apps/ui; Bun auto-loads .env.local):
 *   bun scripts/mint-dev-app-token.mjs
 *
 * Prints the token on stdout; paste it into NEXT_PUBLIC_DEV_APP_TOKEN in
 * apps/ui/.env.local. Requires JWT_INTERNAL and
 * NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG in the environment.
 */
import { createHash } from "node:crypto";
import { SignJWT } from "jose";
import { parse } from "yaml";

function fail(message) {
  console.error(`mint-dev-app-token: ${message}`);
  process.exit(1);
}

function requiredEnv(name) {
  const value = (process.env[name] ?? "").trim();
  if (value === "") {
    fail(`${name} is required (set it in apps/ui/.env.local).`);
  }
  return value;
}

function decodedKubeconfig(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The active kubeconfig user's ServiceAccount crName, as the server derives it. */
function crNameFromKubeconfig(kubeconfigText) {
  let cfg;
  try {
    cfg = parse(kubeconfigText);
  } catch {
    fail("NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG is not valid kubeconfig YAML.");
  }
  const context = cfg?.contexts?.find(
    (entry) => entry.name === cfg?.["current-context"]
  )?.context;
  const token = cfg?.users
    ?.find((entry) => entry.name === context?.user)
    ?.user?.token?.trim();
  if (!token) {
    fail("The dev kubeconfig has no active user bearer token.");
  }
  let subject;
  try {
    subject = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")
    ).sub;
  } catch {
    fail("The dev kubeconfig bearer token is not a JWT.");
  }
  const prefix = "system:serviceaccount:user-system:";
  if (typeof subject !== "string" || !subject.startsWith(prefix)) {
    fail(
      `The dev kubeconfig subject is not a user-system ServiceAccount: ${subject}`
    );
  }
  return subject.slice(prefix.length);
}

/** Stable dev-only userUid: a UUID-shaped digest of the crName. */
function devUserUid(crName) {
  const hex = createHash("sha256")
    .update(`dev-app-token:${crName}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const secret = requiredEnv("JWT_INTERNAL");
const kubeconfigText = decodedKubeconfig(
  requiredEnv("NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG")
);

const crName = crNameFromKubeconfig(kubeconfigText);
const userUid =
  (process.env.DEV_APP_TOKEN_USER_UID ?? "").trim() || devUserUid(crName);
// account-service resolves some endpoints (e.g. /account) by the `User.id`
// column, not the uid, so the claim must be overridable independently.
const userId = (process.env.DEV_APP_TOKEN_USER_ID ?? "").trim() || userUid;

const token = await new SignJWT({
  userCrName: crName,
  userId,
  userUid,
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("7d")
  .sign(new TextEncoder().encode(secret));

console.error("Minted dev App Token.");
console.error(
  "Paste it into apps/ui/.env.local as NEXT_PUBLIC_DEV_APP_TOKEN:\n"
);
console.log(token);
