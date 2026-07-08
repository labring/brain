import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const FORMAT = "v1";
const IV_LENGTH = 12;

function tokenEncryptionSecret(): string {
  const secret = process.env.GITHUB_USER_TOKEN_ENCRYPTION_KEY?.trim();
  if (!secret) {
    throw new Error(
      "GITHUB_USER_TOKEN_ENCRYPTION_KEY is required to store GitHub user tokens."
    );
  }
  return secret;
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(tokenEncryptionSecret()).digest();
}

export function encryptGithubUserToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed === "") {
    throw new Error("GitHub user token cannot be empty.");
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(trimmed, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    FORMAT,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptGithubUserToken(encrypted: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = encrypted.split(":");
  if (version !== FORMAT || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("GitHub user token ciphertext is invalid.");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(ivRaw, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
