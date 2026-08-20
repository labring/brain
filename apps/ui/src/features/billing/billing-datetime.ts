function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** The V2.0 billing timestamp: `yyyy-MM-dd HH:mm` in local time. */
export function formatBillingDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate()
  )} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** The date half of the V2.0 billing timestamp: `yyyy-MM-dd` in local time. */
export function formatBillingDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate()
  )}`;
}
