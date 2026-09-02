// v2: renamed from "sidebar_state" to reset every remembered state once when
// the default flipped to Collapsed; old cookies are simply ignored.
export const SIDEBAR_COOKIE_NAME = "sidebar_state_v2";
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
