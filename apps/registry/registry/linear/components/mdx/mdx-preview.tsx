"use client";

import { MessageResponse } from "@workspace/ui/components/ai-elements/message";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";

const BASIC_RESPONSE = `
### Deployment summary

The assistant keeps prose compact, uses links clearly, and preserves inline code like \`bun typecheck\`.

- Namespace: \`sealai-dev\`
- Workload: \`api-gateway\`
- Next action: [open logs](https://example.com/logs)

> The rollout is healthy. Keep the old replica set warm until the first metrics window closes.
`.trim();

const OPERATIONS_DENSE = `
### Checks before restart

1. Confirm no migration job is running.
2. Drain pending websocket sessions.
3. Restart the deployment after the cache flush completes.

| Signal | Current | Expected |
| --- | ---: | --- |
| CPU p95 | 71% | < 80% |
| Memory | 1.7 GiB | < 2 GiB |
| Ready pods | 3 / 3 | 3 / 3 |

Small table cells should stay readable without turning the chat pane into a document page.
`.trim();

const CODE_RESPONSE = `
### Patch shape

Inline code should read as code, not as a badge: \`kubectl rollout status deploy/api-gateway -n sealai-dev\`.

\`\`\`typescript
type RolloutState = {
  namespace: string;
  workload: string;
  healthyReplicas: number;
  desiredReplicas: number;
};

export function isReady(state: RolloutState) {
  return state.healthyReplicas >= state.desiredReplicas;
}
\`\`\`

Long commands need horizontal scrolling inside the code block:

\`\`\`bash
kubectl get pods -n sealai-dev -l app.kubernetes.io/name=api-gateway,app.kubernetes.io/component=edge --sort-by=.metadata.creationTimestamp --output=custom-columns=NAME:.metadata.name,READY:.status.containerStatuses[*].ready,RESTARTS:.status.containerStatuses[*].restartCount,NODE:.spec.nodeName
\`\`\`
`.trim();

const EDGE_CASES = `
### Edge cases

- A very long token should not blow out the pane: \`sha256:61f1d2ec2e02e80903b0a7df8077689d6a216f7b0b37e33ed5d62f7b7b7d7b7d\`
- Raw URLs should wrap or scroll without covering actions: https://console.example.com/project/sealai-dev/workloads/api-gateway/events/2026/07/02/rollout/replicaset/very-long-diagnostic-path-that-keeps-going
- Nested content:
  - first level
    - second level with \`inline code\`
      - third level, still compact

\`\`\`
unlabelled fenced code should still render as a block
and keep mono spacing.
\`\`\`
`.trim();

const STREAMING_PARTIAL = `
### Streaming partial

The renderer should remain stable while markdown is incomplete:

- opening bullet with **bold text
- inline code starts here: \`kubectl get pods

\`\`\`json
{ "phase": "Reconciling", "ready": false,
`.trim();

const DIAGRAM_AND_MATH = `
### Rollout topology

A complete mermaid fence upgrades to a rendered diagram; a broken or
streaming fence falls back to highlighted source.

\`\`\`mermaid
graph LR
  ingress[Ingress] --> gw[api-gateway]
  gw --> api[api]
  gw --> ui[ui]
  api --> db[(postgres)]
\`\`\`

Inline math like $p_{95} < 250\\,\\text{ms}$ and display math:

$$
\\text{error budget} = 1 - \\frac{\\text{good requests}}{\\text{total requests}}
$$
`.trim();

const SCENARIOS = [
  {
    markdown: BASIC_RESPONSE,
    title: "Assistant prose",
  },
  {
    markdown: OPERATIONS_DENSE,
    title: "Dense operational answer",
  },
  {
    markdown: CODE_RESPONSE,
    title: "Code and long commands",
  },
  {
    markdown: EDGE_CASES,
    title: "Wrapping and unlabelled code",
  },
  {
    markdown: STREAMING_PARTIAL,
    title: "Streaming partial markdown",
  },
  {
    markdown: DIAGRAM_AND_MATH,
    title: "Mermaid diagram and math",
  },
] as const;

export default function MdxPreview() {
  return (
    <PreviewWrapper className="lg:grid-cols-1">
      <Preview
        showMaximize
        title="MessageResponse + markdownComponents (Streamdown)"
      >
        <div className="grid w-full min-w-0 gap-4 xl:grid-cols-2">
          {SCENARIOS.map((scenario) => (
            <section
              className="min-w-0 rounded-md border border-border/70 bg-background/60"
              key={scenario.title}
            >
              <div className="border-border/70 border-b px-3 py-2 font-medium text-muted-foreground text-xs">
                {scenario.title}
              </div>
              <div className="max-h-[24rem] min-w-0 overflow-auto p-3">
                <MessageResponse mode="static">
                  {scenario.markdown}
                </MessageResponse>
              </div>
            </section>
          ))}
        </div>
      </Preview>
    </PreviewWrapper>
  );
}
