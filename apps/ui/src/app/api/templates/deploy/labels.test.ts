import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LAUNCHPAD_TEMPLATE_SOURCE_LABEL,
  templateDeploymentExtraLabels,
} from "@/lib/brain-labels";

test("template deploy extra labels include Brain project ownership labels only", () => {
  const labels = templateDeploymentExtraLabels({
    instanceName: "n8n-demo",
    projectId: "project-uid",
    templateName: "n8n",
  });

  assert.deepEqual(labels, {
    "brain.io/managed-by": "brain",
    "brain.io/project-id": "project-uid",
    "brain.io/deployment-kind": "template",
    "brain.io/deployment-name": "n8n-demo",
    "brain.io/template-name": "n8n",
  });
  assert.equal(LAUNCHPAD_TEMPLATE_SOURCE_LABEL in labels, false);
});
