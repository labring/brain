/**
 * Where a Workspace switch lands (spec §C.6). Brain never switches in place:
 * it hands the top window to Desktop's `?openapp=` deep link naming the
 * target Workspace, Desktop switches and reopens Brain at the landing path,
 * and Brain re-establishes its session there. The Billing Area and the
 * Workspace Area keep their page (path + query) so a user can look at each
 * Workspace's bill or members in turn; anywhere else — inside a Project in
 * particular — lands on the Project list, never on a canvas the new
 * Workspace does not own.
 */

const AREA_PREFIXES_KEPT_ACROSS_SWITCH = ["/billing", "/workspace"] as const;
const PROJECT_LIST_PATH = "/project";
const BRAIN_APP_KEY = "system-brain";
const DESKTOP_DOMAIN_SCHEME_RE = /^https?:\/\//i;
const TRAILING_SLASHES_RE = /\/+$/;

/**
 * Desktop's origin from its cloud domain (the SDK host config's
 * `cloud.domain`, or the kubeconfig's routing domain outside the iframe):
 * `https://` unless a scheme is already there, trailing slashes dropped.
 * Null for an empty domain — no Desktop link can be built yet.
 */
export function desktopOrigin(cloudDomain: string): string | null {
  const trimmed = cloudDomain.trim().replace(TRAILING_SLASHES_RE, "");
  if (trimmed === "") {
    return null;
  }
  return DESKTOP_DOMAIN_SCHEME_RE.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
}

function isInsideArea(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The in-Brain path (with query) the switch lands on. */
export function workspaceSwitchLanding(location: {
  pathname: string;
  search: string;
}): string {
  const keepsPage = AREA_PREFIXES_KEPT_ACROSS_SWITCH.some((prefix) =>
    isInsideArea(location.pathname, prefix)
  );
  return keepsPage
    ? `${location.pathname}${location.search}`
    : PROJECT_LIST_PATH;
}

/**
 * Desktop's deep link for the switch: `openapp` carries `system-brain?` plus
 * the landing path and query, encoded exactly once (Desktop's
 * `parseOpenappQuery` decodes once and splits on the first two `?`), and
 * `workspaceUid` names the Workspace Desktop switches to before reopening
 * Brain. The grammar is `appkey?<path>?<query>`: the second `?` is always
 * written, because without it Desktop reads the path as the app query
 * (the card-management return URL guards the same trap). Null without a
 * cloud domain (no host config answered).
 */
export function workspaceSwitchUrl(input: {
  cloudDomain: string;
  landing: string;
  workspaceUid: string;
}): string | null {
  const origin = desktopOrigin(input.cloudDomain);
  if (origin == null) {
    return null;
  }
  const [path = "/", ...query] = input.landing.split("?");
  const openapp = encodeURIComponent(
    `${BRAIN_APP_KEY}?${path}?${query.join("?")}`
  );
  return `${origin}/?openapp=${openapp}&workspaceUid=${encodeURIComponent(input.workspaceUid)}`;
}
