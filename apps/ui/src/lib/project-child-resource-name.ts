export type ChildResourceKind = "ap" | "db" | "template";

const LOWERCASE_LETTERS = "abcdefghijklmnopqrstuvwxyz";
const RANDOM_LETTER_COUNT = 6;

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
  _projectName: string,
  kind: ChildResourceKind = "ap"
): string {
  return `${kind}-${randomLowercaseLetters()}`;
}
