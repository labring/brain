import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";

mock.module("server-only", () => ({}));
const {
  createDesktopClient,
  desktopApiBaseUrlFromEnv,
  encodedTokenAuthorization,
} = await import("./desktop-client");

const dataSchema = z.object({ token: z.string() });

function envelope(code: number, data: unknown, message = ""): Response {
  return Response.json({ code, data, message });
}

describe("createDesktopClient", () => {
  it("posts JSON with the verbatim Authorization header and unpacks a 200 envelope", async () => {
    let seen: { init: RequestInit; url: URL } | undefined;
    const client = createDesktopClient({
      baseUrl: "http://sealos-desktop.sealos.svc:3000/",
      fetch: (url, init) => {
        seen = { init, url };
        return Promise.resolve(envelope(200, { token: "regional" }));
      },
    });

    const result = await client.call({
      authorization: encodedTokenAuthorization("glo/bal+token"),
      body: { ns_uid: "uuid" },
      dataSchema,
      method: "POST",
      path: "/api/auth/namespace/switch",
    });

    expect(result).toEqual({ data: { token: "regional" }, ok: true });
    expect(seen?.url.toString()).toBe(
      "http://sealos-desktop.sealos.svc:3000/api/auth/namespace/switch"
    );
    expect(seen?.init.method).toBe("POST");
    expect(seen?.init.body).toBe('{"ns_uid":"uuid"}');
    const headers = seen?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("glo%2Fbal%2Btoken");
    expect(headers.Authorization?.startsWith("Bearer")).toBe(false);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(seen?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends no body or content type on GET", async () => {
    let seen: RequestInit | undefined;
    const client = createDesktopClient({
      baseUrl: "http://desktop.test",
      fetch: (_url, init) => {
        seen = init;
        return Promise.resolve(envelope(200, { token: "t" }));
      },
    });
    await client.call({
      authorization: "x",
      dataSchema,
      method: "GET",
      path: "/api/auth/namespace/list",
    });
    expect(seen?.body).toBeUndefined();
    expect(
      (seen?.headers as Record<string, string>)["Content-Type"]
    ).toBeUndefined();
  });

  it("surfaces a non-200 business code from an HTTP 200 envelope", async () => {
    const client = createDesktopClient({
      baseUrl: "http://desktop.test",
      fetch: () => Promise.resolve(envelope(401, null, "invalid token")),
    });
    expect(
      await client.call({
        authorization: "x",
        dataSchema,
        method: "POST",
        path: "/api/auth/regionToken",
      })
    ).toEqual({
      code: 401,
      kind: "desktop_code",
      message: "invalid token",
      ok: false,
    });
  });

  it("treats a bad envelope, a bad data shape, and non-JSON as malformed", async () => {
    const call = (response: Response) =>
      createDesktopClient({
        baseUrl: "http://desktop.test",
        fetch: () => Promise.resolve(response),
      }).call({
        authorization: "x",
        dataSchema,
        method: "GET",
        path: "/p",
      });
    expect(await call(Response.json({ hello: "world" }))).toEqual({
      kind: "malformed",
      ok: false,
    });
    expect(await call(envelope(200, { token: 5 }))).toEqual({
      kind: "malformed",
      ok: false,
    });
    expect(await call(new Response("<html>", { status: 200 }))).toEqual({
      kind: "malformed",
      ok: false,
    });
  });

  it("reports non-2xx HTTP statuses, timeouts, and network failures distinctly", async () => {
    const call = (respond: () => Promise<Response>) =>
      createDesktopClient({
        baseUrl: "http://desktop.test",
        fetch: respond,
      }).call({ authorization: "x", dataSchema, method: "GET", path: "/p" });
    expect(
      await call(() => Promise.resolve(new Response("nope", { status: 502 })))
    ).toEqual({ kind: "http", ok: false, status: 502 });
    expect(
      await call(() => {
        const error = new Error("timed out");
        error.name = "TimeoutError";
        return Promise.reject(error);
      })
    ).toEqual({ kind: "timeout", ok: false });
    expect(await call(() => Promise.reject(new Error("ECONNREFUSED")))).toEqual(
      { kind: "unreachable", ok: false }
    );
  });
});

describe("desktopApiBaseUrlFromEnv", () => {
  it("reads DESKTOP_API_BASE_URL and drops trailing slashes", () => {
    expect(
      desktopApiBaseUrlFromEnv({ DESKTOP_API_BASE_URL: " http://d.test// " })
    ).toBe("http://d.test");
    expect(desktopApiBaseUrlFromEnv({ DESKTOP_API_BASE_URL: "" })).toBeNull();
    expect(desktopApiBaseUrlFromEnv({})).toBeNull();
  });
});
