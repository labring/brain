# Mask DB connection rows behind one shared reveal interaction

ADR-0052 made DB read responses carry a credential-free DB Connection Template, and the first UI iteration displayed that template text (`postgresql://<username>:<password>@…`) directly in the canvas DB node and DB Settings rows. In practice the template text earns nothing on screen: the constant placeholder prefix consumes the narrow node row before the address becomes visible, and it introduces a second visual language for "value with a secret behind it" alongside the AP Environment editor's established `*******` mask. DB connection rows now render a fixed `*******` mask by default and adopt the product's single secret-value interaction, with one shared row anatomy on both surfaces:

- Label on the top line (plus the public-access switch on public rows); masked value + eye + copy on the value line.
- The eye fetches the complete DB Connection DSN from the reveal route and swaps it into the row for 30 seconds (one revealed row at a time, auto-hidden; toggling the eye hides it early).
- Rows truncate, so hovering the revealed value shows the full DSN in a standard tooltip — the tooltip is a reading surface only; nothing opens without hover.
- Copy (whole-row click or the copy button) fetches the complete DSN on demand; the page never holds it outside an active reveal.

The DB Connection Template remains the API-level contract exactly as ADR-0052 decided — served on read paths, consumed by canvas connection derivation, safe in API responses and logs. This ADR only removes it from human-facing display.

## Considered Options

- **Keep displaying the template text.** Rejected: the visible prefix is constant noise on narrow rows, and screenshots showed users reading `<username>:<password>` as a bug rather than a placeholder. Two masking vocabularies in one product is worse than one.
- **Show only the connection address on the node row.** Rejected in favor of visual and behavioral consistency with the AP Environment editor's masked rows, accepting the trade-off that the address is no longer glanceable — checking even the public port now requires a reveal (a credential fetch), making reveal a routine action rather than an exceptional one.
- **Reveal into an anchored popover with the full DSN.** Prototyped and rejected as too heavy — a plain tooltip over the in-row plaintext answers the "row is too narrow to read" problem without a new surface.

## Consequences

- Revises the display-layer half of ADR-0052's "masking the whole connection string" rejection; the data-layer half (API keeps serving the template) stands.
- Canvas node footprints are unaffected: reveal swaps text in place and the tooltip overlays, so node size never changes (ADR-0040 measured footprints).
- The node and settings connection rows should share one row component/behavior rather than two parallel implementations; the AP Environment editor itself is untouched.
