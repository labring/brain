import assert from "node:assert/strict";
import { test } from "node:test";

import { LAUNCHPAD_TEMPLATE_SOURCE_LABEL } from "@/lib/brain-labels";
import { templateDeploymentExtraLabels } from "./labels";

test("template deploy extra labels include Brain project ownership labels only", () => {
  const labels = templateDeploymentExtraLabels({
    projectId: "project-uid",
    templateName: "n8n",
  });

  assert.deepEqual(labels, {
    "brain.io/managed-by": "brain",
    "brain.io/project-id": "project-uid",
    "brain.io/resource-kind": "template",
    "brain.io/resource-name": "n8n",
  });
  assert.equal(LAUNCHPAD_TEMPLATE_SOURCE_LABEL in labels, false);
});
