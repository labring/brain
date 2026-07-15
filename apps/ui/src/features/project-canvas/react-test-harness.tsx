/**
 * Shared primitives for mounting Project Canvas React modules in tests: global
 * stubbing per repo convention (hand-stubbed window, no DOM library), an act()
 * pass that also drains pending timers, and dialog-element inspection.
 *
 * Modules publish dialogs as React elements on their interface, so scenarios
 * read a dialog's props to assert its presence and drive its decisions rather
 * than rendering it into a DOM.
 */
import { isValidElement, type ReactElement } from "react";
import { act } from "react-test-renderer";

export interface GlobalOverride {
  key: string;
  previous: PropertyDescriptor | undefined;
}

export function defineGlobal(key: string, value: unknown): GlobalOverride {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, value });
  return { key, previous };
}

export function restoreGlobal(override: GlobalOverride) {
  if (override.previous === undefined) {
    Reflect.deleteProperty(globalThis, override.key);
    return;
  }
  Object.defineProperty(globalThis, override.key, override.previous);
}

export function setActEnvironment(enabled: boolean): boolean | undefined {
  const reactGlobals = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previous = reactGlobals.IS_REACT_ACT_ENVIRONMENT;
  reactGlobals.IS_REACT_ACT_ENVIRONMENT = enabled;
  return previous;
}

export function restoreActEnvironment(previous: boolean | undefined) {
  const reactGlobals = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  reactGlobals.IS_REACT_ACT_ENVIRONMENT = previous;
}

/**
 * Settles React, then drains work queued on a timer. Adapters that commit
 * through a queue (nuqs URL writes) would otherwise leave the observable
 * stream empty and every "wrote nothing" assertion would pass vacuously.
 */
export async function actAndDrain(
  fn: () => Promise<void> | void,
  drainMs = 10
): Promise<void> {
  await act(async () => {
    await fn();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, drainMs));
  });
}

export function* walkElements(node: unknown): Generator<ReactElement> {
  if (Array.isArray(node)) {
    for (const child of node) {
      yield* walkElements(child);
    }
    return;
  }
  if (!isValidElement(node)) {
    return;
  }
  yield node;
  yield* walkElements((node.props as { children?: unknown }).children);
}

/** Finds the first published dialog whose props match, or null if none is open. */
export function findDialog<T extends Record<string, unknown>>(
  dialogs: unknown,
  match: (props: Record<string, unknown>) => boolean
): T | null {
  for (const element of walkElements(dialogs)) {
    const props = element.props as Record<string, unknown>;
    if (match(props)) {
      return props as T;
    }
  }
  return null;
}

/** Records every request a module issues, so scenarios can assert the network. */
export interface StubbedFetchCall {
  body: string | undefined;
  method: string;
  url: string;
}

export function requestUrl(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return String((input as { url?: string }).url);
}

export function stubFetch(respond: (url: string) => Response): {
  calls: StubbedFetchCall[];
  override: GlobalOverride;
} {
  const calls: StubbedFetchCall[] = [];
  const override = defineGlobal(
    "fetch",
    (input: unknown, init?: RequestInit) => {
      const url = requestUrl(input);
      calls.push({
        body: typeof init?.body === "string" ? init.body : undefined,
        method: init?.method ?? "GET",
        url,
      });
      return Promise.resolve(respond(url));
    }
  );
  return { calls, override };
}

export function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
