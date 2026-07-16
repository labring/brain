# Serve DB connection strings as credential-free templates with explicit reveal

DB read responses previously embedded decoded Secret credentials in `status.connectionStringPrivate` / `status.connectionStringPublic`, so plaintext passwords traveled with every project canvas snapshot and projects explorer poll and sat in browser state — while DB Access and the DB Terminal (ADR-0013) deliberately keep credentials server-side. DB read surfaces now carry a DB Connection Template instead: the same fields, with literal `<username>:<password>` placeholders and a real address and database name. The complete DB Connection DSN is returned only by an explicit reveal endpoint modeled on the existing `ap-env-value` route — explicit user action, server-side composition, `no-store` response. The invariant this buys: DB read paths never decode the credential Secret's username or password keys.

This is not a privilege-escalation fix. Callers authenticate with their own kubeconfig and could read the same Secret directly under the same RBAC; the change removes the needless amplification of plaintext credentials into polling responses, frontend caches, and screenshots, and aligns the DB node and DB Settings with the credential-isolation posture the rest of the product already follows.

## Considered Options

- **`***` as the placeholder text.** Rejected because `*` is valid URL userinfo — a pasted template would parse and fail late at authentication. `<username>` / `<password>` fail at parse time and read as fill-me-in placeholders (the convention Supabase uses), not as a redacted real value.
- **Masking the whole connection string.** Rejected because the address is not a secret (the private address is composed deterministically from the DB name and namespace) and it is exactly what canvas connection derivation and users need at a glance. Full masking would force separate address fields and restructure every consumer.
- **Real username with only the password as a placeholder.** Rejected to keep the no-credential-decoding invariant clean; the username's informational value (almost always `postgres`/`root`) does not justify the exception.
- **Client-side DSN composition at reveal time** (reading the Secret through the generic k8s route). Rejected because the engine-profile composition logic would be duplicated in the frontend and the response would lack `no-store` semantics.
- **Reveal hardening: project-ownership checks, short TTL, rate limits.** Rejected as ceremony — the caller's kubeconfig already grants direct Secret reads under the same RBAC, mirroring ADR-0013's audit reasoning.

## Consequences

- Revises ADR-0002's connection evidence clause: canvas AP-to-DB detection for literal env values now matches by address (scheme + host + port) instead of equality with the complete DSN. Address matching also survives password rotation, which previously broke pasted-DSN edges silently.
- DB Settings and canvas DB node copy/reveal actions fetch the complete DSN on demand from the reveal endpoint. The AP Environment editor is untouched — it already resolves saved values through `ap-env-value`, and runtime compilation (ADR-0018) never consumed the plaintext DSN.
- Landing order matters: address-based matching must land before the API starts serving templates, or pasted-DSN edges break in the interim.
- The legacy generic-get DB enrichment — whole Secret objects injected into `status.secrets` plus a resolved `{ENGINE}_URL` — was reachable only for Crossplane-era `kind: DB` objects and is deleted rather than templated.
