import type { ContainerHistorySnapshotRow } from "./container-history-pane.types";

const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
});

const SHA256_PREFIX = "sha256:";
const VERSION_HASH_PREVIEW_LENGTH = 12;

function shortText(
  value: string,
  length = VERSION_HASH_PREVIEW_LENGTH
): string {
  const v = value.trim();
  return v.length <= length ? v : v.slice(0, length);
}

export function formatSnapshotAge(iso: string, now = Date.now()): string {
  const t = iso.trim();
  if (t === "") {
    return "";
  }
  const time = Date.parse(t);
  if (!Number.isFinite(time)) {
    return "";
  }
  const seconds = Math.round((time - now) / 1000);
  const absSeconds = Math.abs(seconds);
  if (absSeconds < 60) {
    return RELATIVE_TIME_FORMAT.format(seconds, "second");
  }
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) {
    return RELATIVE_TIME_FORMAT.format(minutes, "minute");
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return RELATIVE_TIME_FORMAT.format(hours, "hour");
  }
  const days = Math.round(hours / 24);
  return RELATIVE_TIME_FORMAT.format(days, "day");
}

export function imageVersionLabel(
  row: Pick<ContainerHistorySnapshotRow, "image" | "versionHash">
): string {
  const image = row.image.trim();
  const fallback = shortText(row.versionHash);
  if (image === "") {
    return fallback || "-";
  }
  const digestIndex = image.lastIndexOf("@");
  if (digestIndex !== -1) {
    const digest = image.slice(digestIndex + 1).trim();
    if (digest.startsWith(SHA256_PREFIX)) {
      return shortText(digest.slice(SHA256_PREFIX.length));
    }
    return shortText(digest);
  }
  const slashIndex = image.lastIndexOf("/");
  const colonIndex = image.lastIndexOf(":");
  if (colonIndex > slashIndex) {
    const tag = image.slice(colonIndex + 1).trim();
    if (tag !== "") {
      return tag;
    }
  }
  return fallback || image;
}

export function formatSnapshotCount(count: number): string {
  return count === 1 ? "1 Item" : `${count} Items`;
}
