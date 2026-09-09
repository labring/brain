# Local GitHub deployment smoke test

`apps/ui/scripts/github-deploy-smoke.mjs` drives the real Brain UI at
`localhost` with Playwright CLI. It does not support the Sealos Desktop shell
or iframe mode.

## Prerequisites

1. Configure `apps/ui/.env.local` with a working
   `NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG`, `DATABASE_URL`, Devbox deployment
   settings, and GitHub OAuth settings.
2. Configure `JWT_INTERNAL`, then run `bun scripts/mint-dev-app-token.mjs` from
   `apps/ui` and set the emitted token as `NEXT_PUBLIC_DEV_APP_TOKEN`.
3. Start Brain locally with `bun dev` from the repository root.
4. Connect GitHub once in the local UI for the development user represented by
   the App Token.
5. Ensure `npx` is available. The script prefers the Playwright CLI wrapper
   from `PWCLI`, `~/.codex/skills`, or `~/.agents/skills`, and falls back to
   `npx --package @playwright/cli`.

Never commit `.env.local`, a kubeconfig, App Token, GitHub token, or generated
Playwright artifacts.

## Inspect without deploying

This is the default and safe mode. It opens the project GitHub deployment pane,
checks GitHub authorization, fills the repository URL, and verifies that the
Deploy button becomes enabled. It does not click Deploy.

```bash
bun apps/ui/scripts/github-deploy-smoke.mjs \
  --project-id <existing-project-id> \
  --repo https://github.com/owner/repo
```

Use `--headed` to watch the browser.

## Submit a real deployment

`--submit` is the only option that permits the script to create a deployment
task:

```bash
bun apps/ui/scripts/github-deploy-smoke.mjs \
  --project-id <existing-project-id> \
  --repo https://github.com/owner/repo \
  --submit \
  --headed
```

After creation, the script opens the task timeline and polls the authenticated
timeline endpoint with the request headers already supplied by the UI. Those
headers are kept only in browser memory and are never written to the report.

Success requires all of the following:

- the created task uses the AI runner;
- `status` is `completed`;
- `phase` is `completed`;
- every reported public result URL returns a successful application response;
  the status code and response body are not application-health assertions.

In the Agent-managed state machine, `completed/completed` is only written after
the task's `deployment_completed` MCP call is accepted. The public DTO does not
expose the private completion receipt.

For v1, this is a trusted-Agent workflow assertion rather than an independent
security attestation. The Agent selects the reported workload references, and
the readiness observations are collected inside the Agent-controlled Devbox.
The smoke test proves that the configured Agent workflow converges through the
completion protocol; it does not prove Brain independently discovered resource
ownership or verified the cluster through a separate trusted execution path.

`blocked`, `failed`, and `cancelled` are reported as unsuccessful. A blocked
task exits with code `3`; other failures exit with code `1`.

## Artifacts

Each run writes a private-mode report under:

```text
output/playwright/github-deploy/<timestamp>/
  flow.js
  initial-snapshot.yml
  final.png
  summary.json
```

The summary contains task identity, status, phase, failure reason, sanitized
URLs, and HTTP status. It does not contain request headers, cookies, kubeconfig,
tokens, Secrets, or raw network bodies. A Playwright trace is intentionally not
captured because it can retain authenticated request headers.
