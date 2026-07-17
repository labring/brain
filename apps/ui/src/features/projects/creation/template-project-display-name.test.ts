import assert from "node:assert/strict";
import { test } from "node:test";

import type { TemplateDeploymentChoice } from "@/features/deploy/template-deployer";
import { deriveTemplateProjectDisplayName } from "./template-project-display-name";

const choice = {
  args: [],
  description: "Flowise template",
  name: "flowise",
  title: "Flowise",
} satisfies TemplateDeploymentChoice;

test("template project display name uses the title", () => {
  assert.equal(
    deriveTemplateProjectDisplayName({
      choice,
      existingProjectDisplayNames: [],
    }),
    "Flowise"
  );
});

test("template project display name avoids trimmed case-insensitive conflicts", () => {
  assert.equal(
    deriveTemplateProjectDisplayName({
      choice,
      existingProjectDisplayNames: [" flowise ", "FLOWISE-2"],
    }),
    "Flowise-3"
  );
});

test("template project display name falls back to name and a generic label", () => {
  assert.equal(
    deriveTemplateProjectDisplayName({
      choice: { ...choice, title: "" },
      existingProjectDisplayNames: [],
    }),
    "flowise"
  );
  assert.equal(
    deriveTemplateProjectDisplayName({
      choice: { ...choice, name: "", title: "" },
      existingProjectDisplayNames: [],
    }),
    "Template Project"
  );
});
