# Model AP Environment as Raw Source and Compiled Runtime Env

AP Environment editing uses a `.env`-style Raw Source as the canonical product state, with the structured environment list acting as the preferred view and insertion surface over that source. On Update, Brain compiles the Raw Source into the runtime AP environment entries used by the workload; this keeps the user-facing model Railway-like while avoiding a separate full variables/secrets manager for v1.

## Considered Options

- Keep the previous structured row model with UI-only reference tokens and managed helper variables: rejected because it made raw editing secondary and introduced hidden editor semantics that were hard to explain.
- Store only compiled `spec.input.env`: rejected because the user-facing Reference expressions, comments, ordering, and `.env` source text would be lost after save.
- Build a full Railway-style variables/secrets manager now: rejected for v1 because AP runtime can already receive DB credentials through generated Kubernetes env entries, and a separate secrets system would add a new ownership and reveal/audit surface.
- Preserve legacy `valueFrom` rows in the new Raw Source editor: rejected because the product has not launched and old AP environment compatibility is out of scope for this model change.

## Consequences

The Raw Source supports direct values, comments, runtime env expansion such as `$(POSTGRES_PASSWORD)`, and product-level AP Environment References such as `${{postgres.DATABASE_URL}}`. The structured list follows Raw Source order, masks clean saved values by default, shows raw values for dirty or editing rows, and resolves values only through explicit per-row reveal or copy actions.

`DATABASE_URL` references resolve to complete connection DSNs without an automatic database path suffix. Runtime compilation always expands DB DSNs through generated supporting env variables backed by DB credential Secret refs, rather than copying DB passwords as AP plaintext env values. Supporting variables are compiled output, are named from the DB identity and field with collision handling, are reused across rows when possible, and are not written back into the Raw Source or shown as primary structured rows.
