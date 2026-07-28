# Derive Project Display Names from Deployment Sources at Creation

New Projects were named with a client-generated random `adjective-noun` pair,
which made multi-Project namespaces hard to scan (issue
labring/sealos-private#49). A Project Display Name is display-only — stable
identity is the Project UUID — so naming exists purely for human recognition.
The creation flow deliberately shows no name field; users rename after
creation.

## Decision

`displayName` on the `newProject` deploy-task target becomes optional, with
exactly two channels and no third mode:

- **Absent** — the server derives the name from the Deployment Source when it
  creates the Project, and resolves collisions itself with an incrementing
  suffix (`nginx`, `nginx-2`, `nginx-3`).
- **Present** — the caller-chosen name is used verbatim; a collision is a 409
  error, never a silent rename.

Derivation is a pure function shared as one module (usable from both server
routes and any future client preview): Docker → last image path segment with
tag/digest stripped (`ghcr.io/org/my-api@sha256:…` → `my-api`); GitHub →
`repo.name` with case preserved; Database → lowercase engine id
(`postgresql`); Template → `templateName`; Prompt or any source yielding no
usable name → a readable random name. The Chat deploy tool is encouraged (not
required) to pass a prompt-derived name through the explicit channel and retry
on 409.

Uniqueness authority is the database, not application reads: the unique index
moves to `(namespace, lower(display_name))` so Postgres enforces the
documented case-insensitive contract, and the server's suffix loop retries on
unique-violation errors rather than trusting a pre-read. The migration
defensively de-duplicates existing case-variant names (keep earliest, suffix
the rest). All client-side naming code — the random generator, the four
per-source `derive*` helpers, and their duplicated normalize/conflict checks —
is retired; older client bundles that still send a random `displayName` simply
use the explicit channel.

## Considered Options

- **Extend client-side derivation to all entry modes** — rejected. The client
  judges conflicts against a stale SWR project list (concurrent creates race),
  the logic was already duplicated four times, and every new entry point
  (Chat, direct API callers, automation) would have to reimplement naming.
  Server-side derivation makes "meaningful, unique name" an invariant of
  Project creation regardless of caller.
- **Auto-suffix explicit names too** — rejected. Silently altering a name the
  caller chose is surprising; for the AI caller a 409-and-retry is cheap. A
  `suggestion` flag can be added compatibly later if retries prove costly.
- **Case-sensitive uniqueness (keep the plain index)** — rejected. The
  uniqueness rule exists only for human distinguishability, and humans read
  `nginx` and `Nginx` as the same thing; source-derived names (lowercase
  image segments vs case-preserving repo names) would collide on case
  variants routinely, defeating the issue's goal.
- **Editable name field in the creation flow** — deferred, not adopted. The
  creation UI keeps hiding the name; the optional-`displayName` contract
  already supports a future field (prefill via the pure derivation module,
  submit through the explicit channel) without API changes.
