# DB Console runs the native engine client via pod-exec with server-side credential injection

The DB node's console must give users an interactive database session. We considered reusing the WhoDB path that DB Access uses (server-side GraphQL `RawExecute`), but that yields a query-runner returning result sets, not a real engine REPL. Following the production sealos `dbprovider` approach, the DB Console instead execs into the DB Service's primary (leader) pod and launches the engine's native client (`psql`/`mysql`/`mongosh`/`redis-cli`), reusing the existing AP terminal WebSocket exec transport and terminal pane. Unlike sealos — which fetches the connection secret to the browser and bakes the password into the command string — brainv2 resolves the leader pod, reads the secret, and builds the client command entirely server-side, so credentials never reach the client. This preserves the credential-isolation posture established for DB Access (see ADR-0011/0012 and the DB Access definition in `CONTEXT.md`).

## Considered Options

- **WhoDB `RawExecute`/`StreamRawExecute` (the DB Access transport).** Rejected as the console because it returns tabular result sets, not an interactive native-client REPL (no `\d`, `\copy`, meta-commands, or native transaction state). DB Access already covers read-only browsing and ad-hoc queries via this path; the DB Console complements it rather than replacing it.
- **Client-side credential injection (sealos verbatim).** Rejected because it exposes the connection secret and password to the browser, contradicting DB Access's "credentials stay server-side" contract.

## Consequences

- Offered only for engines that ship a client in their KubeBlocks container and only while the DB Service is Running; engines without a client (kafka, qdrant, milvus, nebula, weaviate, pulsar) hide the console.
- Primary-pod resolution depends on KubeBlocks `InstanceSet` member roles (`status.membersStatus[].role.isLeader`); a console always targets the writable primary.
- The constructed command's password is visible in the target pod's own process args (`ps`); acceptable because that pod already mounts the DB secret, and can be hardened later via env (`PGPASSWORD`/`MYSQL_PWD`) or stdin.
- No command-level audit in v1. A DB Console grants no privilege the user lacks — the DB node already exposes the connection string and a public-access toggle, so the user can connect directly — which makes auditing only console sessions both incomplete and redundant. v1 emits a lightweight session-open event (actor, DB Service, timestamp) for telemetry only; statement-level audit, if ever required, belongs at the engine (`pgaudit` / MySQL audit log), where it covers all connections rather than just the console.
