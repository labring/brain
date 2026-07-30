export interface FetcherOptions {
  base: string;
  body?: unknown;
  header?: Record<string, string> | Headers;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  select?: (data: unknown) => unknown;
  signal?: AbortSignal;
}

function resolveUrl(base: string, path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return new URL(path, base).href;
}

function mergeHeaders(
  a: Record<string, string> | Headers | undefined
): Headers {
  if (a instanceof Headers) {
    return new Headers(a);
  }
  const h = new Headers();
  if (a) {
    for (const [k, v] of Object.entries(a)) {
      h.set(k, v);
    }
  }
  return h;
}

/**
 * Minimal HTTP client: builds URL from `base` + `path` (or uses absolute `path`),
 * merges `query`, sends `body` (JSON for plain objects), parses JSON or text.
 */
export async function fetcher<T = unknown>(
  options: FetcherOptions
): Promise<T> {
  const url = new URL(resolveUrl(options.base, options.path));
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v != null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const headers = mergeHeaders(options.header);
  const method = options.method ?? "GET";

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (
      typeof options.body === "string" ||
      options.body instanceof Blob ||
      options.body instanceof ArrayBuffer ||
      options.body instanceof FormData
    ) {
      body = options.body as BodyInit;
    } else {
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      body = JSON.stringify(options.body);
    }
  }

  const res = await fetch(url.toString(), {
    body,
    headers,
    method,
    signal: options.signal,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err}`);
  }

  const ct = res.headers.get("content-type");
  let data: unknown;
  if (ct?.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  if (options.select) {
    data = options.select(data);
  }
  return data as T;
}
