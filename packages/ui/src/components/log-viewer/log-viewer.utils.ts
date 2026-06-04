const LEADING_LOG_TIMESTAMP_RE =
  /^\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s+(?=(?:ERROR|WARN|INFO|DEBUG):?\s)/;

export function formatLogMessage(message: string): string {
  return message.replace(LEADING_LOG_TIMESTAMP_RE, "");
}

export function formatLogTime(iso: string): string {
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return `${y}/${mo}/${da} ${h}:${mi}:${s}`;
  } catch {
    return iso;
  }
}
