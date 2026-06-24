// biome-ignore-all lint/suspicious/noBitwiseOperators: SHA-256 is intentionally implemented with 32-bit bitwise operations for browser-safe synchronous host allocation.
export interface PlatformAddressHostInput {
  appName: string;
  domainPrefix?: string;
  namespace: string;
  platformAddressId: string;
  routingDomain: string;
}

export interface PlatformAddressEndpoint {
  host: string;
  url: string;
}

export const PLATFORM_ADDRESS_ID_PATTERN = "^pa_[a-z0-9]{6,32}$";
export const PLATFORM_ADDRESS_ID_RE = new RegExp(PLATFORM_ADDRESS_ID_PATTERN);
export const PLATFORM_ADDRESS_DOMAIN_PREFIX_PATTERN = "^(brain|[a-z]{6})$";
export const PLATFORM_ADDRESS_DOMAIN_PREFIX_RE = new RegExp(
  PLATFORM_ADDRESS_DOMAIN_PREFIX_PATTERN
);
export const CUSTOM_DOMAIN_BINDING_ID_PATTERN = "^cd_[a-z0-9]{6,32}$";
export const CUSTOM_DOMAIN_BINDING_ID_RE = new RegExp(
  CUSTOM_DOMAIN_BINDING_ID_PATTERN
);
const PLATFORM_ADDRESS_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const PLATFORM_ADDRESS_ID_RANDOM_BYTES = 12;
const PLATFORM_ADDRESS_HOST_ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const PLATFORM_ADDRESS_HOST_LABEL_LENGTH = 6;
const SHA256_INITIAL_STATE = sha256Words(
  "6a09e667",
  "bb67ae85",
  "3c6ef372",
  "a54ff53a",
  "510e527f",
  "9b05688c",
  "1f83d9ab",
  "5be0cd19"
);

export function normalizePlatformAddressId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeCustomDomainBindingId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isPlatformAddressId(value: unknown): boolean {
  return PLATFORM_ADDRESS_ID_RE.test(normalizePlatformAddressId(value));
}

export function isCustomDomainBindingId(value: unknown): boolean {
  return CUSTOM_DOMAIN_BINDING_ID_RE.test(
    normalizeCustomDomainBindingId(value)
  );
}

export function platformAddressIdFromValue(value: unknown): string | undefined {
  const id = normalizePlatformAddressId(value);
  return PLATFORM_ADDRESS_ID_RE.test(id) ? id : undefined;
}

export function customDomainBindingIdFromValue(
  value: unknown
): string | undefined {
  const id = normalizeCustomDomainBindingId(value);
  return CUSTOM_DOMAIN_BINDING_ID_RE.test(id) ? id : undefined;
}

export function platformAddressIdsFromRows(
  rows: readonly { id?: string; platformAddressId?: string }[]
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const id =
      platformAddressIdFromValue(row.id) ??
      platformAddressIdFromValue(row.platformAddressId);
    if (id !== undefined) {
      ids.add(id);
    }
  }
  return ids;
}

export function generatePlatformAddressId(): string {
  return generateOpaqueId("pa");
}

export function generatePlatformAddressDomainPrefix(): string {
  return generateLowercaseLetters(PLATFORM_ADDRESS_HOST_LABEL_LENGTH);
}

export function stablePlatformAddressDomainPrefix(source: string): string {
  const hash = sha256Hex(source.trim());
  return Array.from(
    { length: PLATFORM_ADDRESS_HOST_LABEL_LENGTH },
    (_, index) =>
      PLATFORM_ADDRESS_HOST_ALPHABET[
        Number.parseInt(hash.slice(index * 2, index * 2 + 2), 16) %
          PLATFORM_ADDRESS_HOST_ALPHABET.length
      ]
  ).join("");
}

export function generateCustomDomainBindingId(): string {
  return generateOpaqueId("cd");
}

function generateLowercaseLetters(length: number): string {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto == null) {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  } else {
    globalThis.crypto.getRandomValues(bytes);
  }
  let out = "";
  for (const byte of bytes) {
    out +=
      PLATFORM_ADDRESS_HOST_ALPHABET[
        byte % PLATFORM_ADDRESS_HOST_ALPHABET.length
      ];
  }
  return out;
}

function generateOpaqueId(prefix: "cd" | "pa"): string {
  const bytes = new Uint8Array(PLATFORM_ADDRESS_ID_RANDOM_BYTES);
  if (globalThis.crypto == null) {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  } else {
    globalThis.crypto.getRandomValues(bytes);
  }

  let suffix = "";
  for (const byte of bytes) {
    suffix +=
      PLATFORM_ADDRESS_ID_ALPHABET[byte % PLATFORM_ADDRESS_ID_ALPHABET.length];
  }
  return `${prefix}_${suffix}`;
}

const SHA256_K = sha256Words(
  "428a2f98",
  "71374491",
  "b5c0fbcf",
  "e9b5dba5",
  "3956c25b",
  "59f111f1",
  "923f82a4",
  "ab1c5ed5",
  "d807aa98",
  "12835b01",
  "243185be",
  "550c7dc3",
  "72be5d74",
  "80deb1fe",
  "9bdc06a7",
  "c19bf174",
  "e49b69c1",
  "efbe4786",
  "0fc19dc6",
  "240ca1cc",
  "2de92c6f",
  "4a7484aa",
  "5cb0a9dc",
  "76f988da",
  "983e5152",
  "a831c66d",
  "b00327c8",
  "bf597fc7",
  "c6e00bf3",
  "d5a79147",
  "06ca6351",
  "14292967",
  "27b70a85",
  "2e1b2138",
  "4d2c6dfc",
  "53380d13",
  "650a7354",
  "766a0abb",
  "81c2c92e",
  "92722c85",
  "a2bfe8a1",
  "a81a664b",
  "c24b8b70",
  "c76c51a3",
  "d192e819",
  "d6990624",
  "f40e3585",
  "106aa070",
  "19a4c116",
  "1e376c08",
  "2748774c",
  "34b0bcb5",
  "391c0cb3",
  "4ed8aa4a",
  "5b9cca4f",
  "682e6ff3",
  "748f82ee",
  "78a5636f",
  "84c87814",
  "8cc70208",
  "90befffa",
  "a4506ceb",
  "bef9a3f7",
  "c67178f2"
);

function sha256Words(...words: string[]): readonly number[] {
  return words.map((word) => Number.parseInt(word, 16));
}

function rightRotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function add32(...values: number[]): number {
  let out = 0;
  for (const value of values) {
    out = (out + value) >>> 0;
  }
  return out;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Compact SHA-256 reference implementation kept local so host generation stays synchronous in UI render paths.
function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 4_294_967_296));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const state: number[] = [...SHA256_INITIAL_STATE];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      words[i] = view.getUint32(offset + i * 4);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 =
        rightRotate(words[i - 15] ?? 0, 7) ^
        rightRotate(words[i - 15] ?? 0, 18) ^
        ((words[i - 15] ?? 0) >>> 3);
      const s1 =
        rightRotate(words[i - 2] ?? 0, 17) ^
        rightRotate(words[i - 2] ?? 0, 19) ^
        ((words[i - 2] ?? 0) >>> 10);
      words[i] = add32(words[i - 16] ?? 0, s0, words[i - 7] ?? 0, s1);
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i += 1) {
      const sigma1 =
        rightRotate(e ?? 0, 6) ^
        rightRotate(e ?? 0, 11) ^
        rightRotate(e ?? 0, 25);
      const choice = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0));
      const temp1 = add32(
        h ?? 0,
        sigma1,
        choice,
        SHA256_K[i] ?? 0,
        words[i] ?? 0
      );
      const sigma0 =
        rightRotate(a ?? 0, 2) ^
        rightRotate(a ?? 0, 13) ^
        rightRotate(a ?? 0, 22);
      const majority =
        ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0));
      const temp2 = add32(sigma0, majority);

      h = g;
      g = f;
      f = e;
      e = add32(d ?? 0, temp1);
      d = c;
      c = b;
      b = a;
      a = add32(temp1, temp2);
    }

    state[0] = add32(state[0] ?? 0, a ?? 0);
    state[1] = add32(state[1] ?? 0, b ?? 0);
    state[2] = add32(state[2] ?? 0, c ?? 0);
    state[3] = add32(state[3] ?? 0, d ?? 0);
    state[4] = add32(state[4] ?? 0, e ?? 0);
    state[5] = add32(state[5] ?? 0, f ?? 0);
    state[6] = add32(state[6] ?? 0, g ?? 0);
    state[7] = add32(state[7] ?? 0, h ?? 0);
  }

  return state.map((word) => word.toString(16).padStart(8, "0")).join("");
}

export function platformAddressHost(
  input: PlatformAddressHostInput
): string | undefined {
  const namespace = input.namespace.trim();
  const appName = input.appName.trim();
  const platformAddressId = input.platformAddressId.trim();
  const routingDomain = input.routingDomain.trim();
  const domainPrefix = input.domainPrefix?.trim().toLowerCase() ?? "";

  if (
    namespace === "" ||
    appName === "" ||
    !PLATFORM_ADDRESS_ID_RE.test(platformAddressId) ||
    routingDomain === ""
  ) {
    return undefined;
  }

  if (PLATFORM_ADDRESS_DOMAIN_PREFIX_RE.test(domainPrefix)) {
    return `${domainPrefix}.${routingDomain}`;
  }

  const label = stablePlatformAddressDomainPrefix(
    `${namespace}/${appName}/${platformAddressId}`
  );
  return `${label}.${routingDomain}`;
}

function platformAddressUrl(host: string): string {
  return `https://${host}/`;
}

export function platformAddressEndpoint(
  input: PlatformAddressHostInput
): PlatformAddressEndpoint | undefined {
  const host = platformAddressHost(input);
  return host === undefined
    ? undefined
    : { host, url: platformAddressUrl(host) };
}
