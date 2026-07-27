import assert from "node:assert/strict";
import { test } from "node:test";

import { render } from "@testing-library/react/pure";

import type {
  TemplateDeploymentChoice,
  TemplateDeploymentSettings,
} from "@/features/deploy/template-deployer";
import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
} from "@/features/project-canvas/react-test-harness";
import { ProjectCreationPane } from "./project-creation-pane";

const FLOWISE = {
  args: [
    {
      default: "3000",
      description: "HTTP port",
      key: "port",
      required: true,
      type: "string",
    },
    {
      default: "",
      description: "Optional API token",
      key: "api_token",
      required: false,
      type: "password",
    },
  ],
  description: "Flowise template",
  name: "flowise",
  title: "Flowise",
} satisfies TemplateDeploymentChoice;

const FLOWISE_RE = /Flowise/;

test("template URL intent prefills parameters and deploys automatically", async () => {
  const dom = installTestDom();
  const previousAct = setActEnvironment(true);
  const confirmations: TemplateDeploymentSettings[] = [];
  let rendered: ReturnType<typeof render> | undefined;
  try {
    await actAndDrain(() => {
      rendered = render(
        <ProjectCreationPane
          creatorRootProps={{
            actions: {
              onTemplateConfirm: (settings) => {
                confirmations.push(settings);
              },
            },
            databaseOptions: [],
            initialTemplateArgs: { port: "8080" },
            initialTemplateName: "flowise",
            templateOptions: [FLOWISE],
            templateOptionsLoading: false,
          }}
          entryMode="templateDirect"
          onClose={() => undefined}
          resetKey="templateDirect:flowise"
        />
      );
    });

    assert.match(
      rendered?.getByTestId("template.deployer.template-combobox")
        .textContent ?? "",
      FLOWISE_RE
    );
    assert.ok(
      rendered?.container.querySelector("header .lucide-panels-top-left"),
      "template creation uses the PanelsTopLeft header icon"
    );
    assert.equal(
      (rendered?.getByLabelText("port") as HTMLInputElement).value,
      "8080"
    );
    assert.equal(confirmations.length, 1);
    assert.equal(confirmations[0]?.templateName, "flowise");
    assert.deepEqual(confirmations[0]?.args, {
      api_token: "",
      port: "8080",
    });
    assert.deepEqual(confirmations[0]?.sensitiveKeys, ["api_token"]);
  } finally {
    await actAndDrain(() => rendered?.unmount());
    restoreActEnvironment(previousAct);
    await dom.restore();
  }
});
