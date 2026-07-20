/**
 * Fixed-width mask rendered in place of a DB connection DSN, so the row never
 * varies with the secret behind it (ADR-0055). The AP Environment editor owns
 * its own mask sized to its own rows; the two surfaces share the reveal
 * interaction, not this string.
 */
export const DATABASE_CONNECTION_MASK = "************";
