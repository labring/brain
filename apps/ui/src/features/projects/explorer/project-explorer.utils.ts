export function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatCreatedAt(value: Date | string): string {
  const d = toDate(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}
