export const DATABASE_CONNECTION_MASK = "************";

export function maskDatabaseConnectionString(value: string) {
  if (!value) {
    return value;
  }
  return DATABASE_CONNECTION_MASK;
}
