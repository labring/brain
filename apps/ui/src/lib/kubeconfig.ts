/** Decode the URL-encoded kubeconfig that the client appends to every chat request. */
export function decodeKubeconfig(encoded: string | undefined): string | null {
  if (encoded === undefined || encoded === "") {
    return null;
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}
