export type ChildResourceKind = "ap" | "db" | "template";

const LOWERCASE_LETTERS = "abcdefghijklmnopqrstuvwxyz";
const RANDOM_LETTER_COUNT = 6;
const DNS_1035_MAX_LENGTH = 63;
const RANDOM_SUFFIX_LENGTH = RANDOM_LETTER_COUNT + 1;
const DNS_1035_START_RE = /^[a-z]/;

function randomLowercaseLetters(length = RANDOM_LETTER_COUNT): string {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto == null) {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  } else {
    globalThis.crypto.getRandomValues(bytes);
  }

  let out = "";
  for (const byte of bytes) {
    out += LOWERCASE_LETTERS[byte % LOWERCASE_LETTERS.length];
  }
  return out;
}

/** Child resource name: `{kind}-{6 random lowercase letters}` (DNS-1035 label). */
export function childResourceName(
  projectName: string,
  kind: ChildResourceKind = "ap"
): string {
  if (kind === "template") {
    const maxPrefixLength = DNS_1035_MAX_LENGTH - RANDOM_SUFFIX_LENGTH;
    let prefix = projectName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxPrefixLength)
      .replace(/-+$/g, "");
    if (prefix === "") {
      prefix = "template";
    } else if (!DNS_1035_START_RE.test(prefix)) {
      prefix = `app-${prefix}`.slice(0, maxPrefixLength).replace(/-+$/g, "");
    }

    return `${prefix}-${randomLowercaseLetters()}`;
  }

  return `${kind}-${randomLowercaseLetters()}`;
}
