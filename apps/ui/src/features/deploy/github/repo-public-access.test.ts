import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";

import { checkGithubRepoPublicAccess } from "./repo-public-access";

const actualFetch = globalThis.fetch;

function jsonResponse(
  body: unknown,
  init: { headers?: Headers; status: number }
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  init.headers?.forEach((value, key) => {
    headers.set(key, value);
  });
  return new Response(JSON.stringify(body), { headers, status: init.status });
}

describe("checkGithubRepoPublicAccess", () => {
  beforeEach(() => {
    mock.restore();
  });

  afterEach(() => {
    globalThis.fetch = actualFetch;
  });

  it("accepts a public repository", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        { full_name: "owner/repo" },
        { status: 200 }
      )) as unknown as typeof fetch;

    await expect(
      checkGithubRepoPublicAccess({ fullName: "owner/repo" })
    ).resolves.toEqual({ accessible: true, checked: true });
  });

  it("rejects a private or missing repository with a checked answer", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        { message: "Not Found" },
        { status: 404 }
      )) as unknown as typeof fetch;

    await expect(
      checkGithubRepoPublicAccess({ fullName: "owner/private" })
    ).resolves.toEqual({ accessible: false, checked: true });
  });

  it("rejects a blocked repository with a checked answer", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        { message: "Repository access blocked" },
        { status: 403 }
      )) as unknown as typeof fetch;

    await expect(
      checkGithubRepoPublicAccess({ fullName: "owner/blocked" })
    ).resolves.toEqual({ accessible: false, checked: true });
  });

  it("fails open when rate limited", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        { message: "API rate limit exceeded" },
        { headers: new Headers({ "x-ratelimit-remaining": "0" }), status: 403 }
      )) as unknown as typeof fetch;

    await expect(
      checkGithubRepoPublicAccess({ fullName: "owner/repo" })
    ).resolves.toEqual({ accessible: false, checked: false });
  });

  it("fails open on network errors", async () => {
    globalThis.fetch = (() => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    await expect(
      checkGithubRepoPublicAccess({ fullName: "owner/repo" })
    ).resolves.toEqual({ accessible: false, checked: false });
  });

  it("rejects an empty fullName as a checked negative", async () => {
    await expect(
      checkGithubRepoPublicAccess({ fullName: "   " })
    ).resolves.toEqual({ accessible: false, checked: true });
  });

  it("sends the token on the authenticated path", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(((
      _input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      expect(init?.headers).toEqual({
        Accept: "application/vnd.github+json",
        Authorization: "Bearer secret-token",
      });
      return jsonResponse({ full_name: "owner/repo" }, { status: 200 });
    }) as unknown as typeof fetch);

    await checkGithubRepoPublicAccess({
      fullName: "owner/repo",
      token: "secret-token",
    });
    expect(fetchSpy).toHaveBeenCalled();
  });
});
