import { afterEach, describe, expect, it } from "bun:test";

import type { DeployIntentContext } from "@/features/chat/persistence/deploy-intent-context";
import {
  buildDeployIntentQuery,
  clearDeployIntentParam,
  decodeDeployIntentQuery,
  encodeDeployIntentQuery,
  parseDeployIntentSearch,
  parseGithubRepoUrl,
  readDeployIntentParam,
} from "./deploy-intent-link";

const templateIntent: DeployIntentContext = {
  version: 1,
  kind: "template",
  source: "template-site",
  payload: { templateName: "glpi", args: { admin_email: "a@example.com" } },
};

describe("deploy intent URL codec", () => {
  it("round-trips an intent through the encoded query value", () => {
    const encoded = encodeDeployIntentQuery(templateIntent);
    expect(encoded).toContain("%7B");
    expect(decodeDeployIntentQuery(encoded)).toEqual(templateIntent);
  });

  it("builds the canonical entry query with side + intent", () => {
    const query = buildDeployIntentQuery(
      templateIntent,
      "project-creation:templateDirect:glpi"
    );
    const params = new URLSearchParams(query);
    expect(params.get("intent")).not.toBeNull();
    expect(params.get("side")).toBe("project-creation:templateDirect:glpi");
    const parsed = parseDeployIntentSearch(query);
    expect(parsed.intent).toEqual(templateIntent);
    expect(parsed.side).toBe("project-creation:templateDirect:glpi");
  });

  it("omits side when absent", () => {
    const query = buildDeployIntentQuery(templateIntent);
    expect(new URLSearchParams(query).get("side")).toBeNull();
  });

  it("returns null for malformed intent values", () => {
    expect(decodeDeployIntentQuery("not-encoded")).toBeNull();
    expect(decodeDeployIntentQuery(encodeURIComponent("{nope"))).toBeNull();
    expect(decodeDeployIntentQuery(null)).toBeNull();
  });

  it("reads the raw intent param from a search string", () => {
    const query = buildDeployIntentQuery(templateIntent);
    expect(readDeployIntentParam(`?${query}`)).toBe(
      new URLSearchParams(query).get("intent")
    );
    expect(readDeployIntentParam("?side=x")).toBeNull();
  });

  it("parses an entry URL search string", () => {
    const parsed = parseDeployIntentSearch(
      `?side=skills-workflow&${buildDeployIntentQuery(templateIntent)}`
    );
    expect(parsed.side).toBe("skills-workflow");
    expect(parsed.intent).toEqual(templateIntent);
  });
});

describe("parseGithubRepoUrl", () => {
  it("accepts legal HTTPS github.com repository URLs", () => {
    expect(parseGithubRepoUrl("https://github.com/glpi-project/glpi")).toEqual({
      fullName: "glpi-project/glpi",
      name: "glpi",
    });
    expect(
      parseGithubRepoUrl("https://github.com/glpi-project/glpi.git")
    ).toEqual({ fullName: "glpi-project/glpi", name: "glpi" });
    expect(parseGithubRepoUrl("https://www.github.com/owner/repo")).toEqual({
      fullName: "owner/repo",
      name: "repo",
    });
  });

  it("rejects non-HTTPS, non-github, or malformed URLs", () => {
    for (const url of [
      "http://github.com/owner/repo",
      "https://gitlab.com/owner/repo",
      "https://github.com/owner",
      "https://github.com/owner/repo/tree/main",
      "https://evil.com/owner/repo",
      "ftp://github.com/owner/repo",
      "",
      "not a url",
    ]) {
      expect(parseGithubRepoUrl(url)).toBeNull();
    }
  });
});

describe("clearDeployIntentParam", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (originalWindow === undefined) {
      // biome-ignore lint/performance/noDelete: restore pristine global in tests
      delete (globalThis as { window?: unknown }).window;
    } else {
      globalThis.window = originalWindow;
    }
  });

  function installFakeLocation(href: string) {
    let currentHref = href;
    const replaceStateCalls: string[] = [];
    const fakeWindow = {
      history: {
        replaceState(_state: unknown, _title: string, url: string) {
          replaceStateCalls.push(url);
        },
      },
      location: {
        get href() {
          return currentHref;
        },
        set href(value: string) {
          currentHref = value;
        },
      },
    };
    globalThis.window = fakeWindow as unknown as Window & typeof globalThis;
    return { fakeWindow, replaceStateCalls };
  }

  it("removes only the intent param via history.replaceState", () => {
    const intentQuery = buildDeployIntentQuery(templateIntent);
    const { replaceStateCalls } = installFakeLocation(
      `https://brain.example.test/project?side=skills-workflow&${intentQuery}&keep=1`
    );
    clearDeployIntentParam();
    expect(replaceStateCalls).toHaveLength(1);
    const next = new URL(replaceStateCalls[0] ?? "");
    expect(next.searchParams.get("intent")).toBeNull();
    expect(next.searchParams.get("side")).toBe("skills-workflow");
    expect(next.searchParams.get("keep")).toBe("1");
  });

  it("is a no-op when no intent param is present", () => {
    const { replaceStateCalls } = installFakeLocation(
      "https://brain.example.test/project?side=skills-workflow"
    );
    clearDeployIntentParam();
    expect(replaceStateCalls).toHaveLength(0);
  });
});
