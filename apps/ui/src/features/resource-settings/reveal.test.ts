import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { copyResolvedSecretValue } from "./reveal";

const REVEAL_FAILED_RE = /reveal failed/;

const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator"
);

function withClipboard(): string[] {
  const written: string[] = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: (value: string) => {
          written.push(value);
          return Promise.resolve();
        },
      },
    },
  });
  return written;
}

afterEach(() => {
  if (originalNavigator == null) {
    Reflect.deleteProperty(globalThis, "navigator");
  } else {
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  }
});

test("copy fetches the complete value on demand instead of reading page state", async () => {
  const written = withClipboard();
  let resolved = 0;

  await copyResolvedSecretValue({
    placeholderValue: "postgresql://<username>:<password>@db.svc:5432/app",
    resolveAvailable: true,
    resolveValue: () => {
      resolved += 1;
      return Promise.resolve("postgresql://alice:s3cr3t@db.svc:5432/app");
    },
  });

  assert.equal(resolved, 1);
  assert.deepEqual(written, ["postgresql://alice:s3cr3t@db.svc:5432/app"]);
});

test("copy falls back to the displayed placeholder only when no resolver backs the surface", async () => {
  const written = withClipboard();

  await copyResolvedSecretValue({
    placeholderValue: "postgresql://<username>:<password>@db.svc:5432/app",
    resolveAvailable: false,
    resolveValue: () => Promise.reject(new Error("must not be called")),
  });

  assert.deepEqual(written, [
    "postgresql://<username>:<password>@db.svc:5432/app",
  ]);
});

test("copy rejects when the on-demand fetch fails rather than copying a non-working value", async () => {
  const written = withClipboard();

  await assert.rejects(
    copyResolvedSecretValue({
      placeholderValue: "postgresql://<username>:<password>@db.svc:5432/app",
      resolveAvailable: true,
      resolveValue: () => Promise.reject(new Error("reveal failed")),
    }),
    REVEAL_FAILED_RE
  );

  assert.deepEqual(written, []);
});
