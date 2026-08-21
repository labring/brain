/**
 * Single helper for the JSON error envelope returned by `/api/chat*` routes.
 * Every chat API error shares the `{ code, error }` shape (ADR-0065): the
 * `code` is the response's formal identity for tests and non-browser callers.
 */
export function jsonError(
  code: string,
  message: string,
  status: number,
  detail?: unknown
): Response {
  const body =
    detail === undefined
      ? { code, error: message }
      : { code, error: message, detail };
  return Response.json(body, { status });
}
