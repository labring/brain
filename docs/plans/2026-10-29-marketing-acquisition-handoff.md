# Brain acquisition handoff implementation plan

1. Reuse existing workspace actor authorization and signed marketing attribution normalization; fetch account snapshots through one explicitly configured server-only client.
2. Persist the canonical user snapshot on an authenticated bootstrap request before deployment. Fetch the linked snapshot at Deployment Task create without blocking existing deployment on optional analytics failures.
3. Extend the lifecycle table with durable delivery metadata, then add a bounded SQL-locked publisher using the central collector protocol.
4. Exercise the handler, migrated PGlite store and HTTP receiver boundaries; run Bun type/check gates and record limits in the PR.

No production deployment, credential changes or paid conversion simulation is part of the PR.
