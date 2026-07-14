/** Single helper for the JSON error envelope returned by `/api/chat*` routes. */
export function jsonError(
  message: string,
  status: number,
  detail?: unknown
): Response {
  const body =
    detail === undefined ? { error: message } : { error: message, detail };
  return Response.json(body, { status });
}
