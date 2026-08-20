// Shared environment detection for dev-only rendering.

declare const process: { env?: { NODE_ENV?: string } } | undefined;

interface ImportMetaWithEnv {
  env?: { MODE?: string };
}

function computeIsDevDefault(): boolean {
  if (process?.env?.NODE_ENV) {
    return process.env.NODE_ENV !== "production";
  }
  const meta =
    typeof import.meta === "undefined"
      ? undefined
      : (import.meta as ImportMetaWithEnv);
  if (meta?.env?.MODE) {
    return meta.env.MODE !== "production";
  }
  return true;
}

export const isDevDefault = computeIsDevDefault();
