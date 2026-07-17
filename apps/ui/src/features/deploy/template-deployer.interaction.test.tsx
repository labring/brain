import assert from "node:assert/strict";
import { test } from "node:test";

import { fireEvent, render } from "@testing-library/react/pure";

import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
} from "@/features/project-canvas/react-test-harness";
import {
  TemplateDeployer,
  type TemplateDeploymentChoice,
  type TemplateDeploymentSettings,
} from "./template-deployer";

const FLOWISE = {
  args: [
    {
      default: "3000",
      description: "HTTP port",
      key: "port",
      required: true,
      type: "string",
    },
  ],
  description: "Flowise template",
  name: "flowise",
  title: "Flowise",
} satisfies TemplateDeploymentChoice;

const DIFY = {
  args: [
    {
      default: "",
      description: "Admin password",
      key: "password",
      required: true,
      type: "password",
    },
  ],
  description: "Dify template",
  name: "dify",
  title: "Dify",
} satisfies TemplateDeploymentChoice;

const CATALOG_ERROR_RE = /Could not load template catalog/;
const FLOWISE_RE = /Flowise/;
const LOADING_TEMPLATES_RE = /Loading templates/;
const UNAVAILABLE_TEMPLATE_RE = /Template "missing-template" is unavailable/;

async function withTestDom(run: (act: typeof actAndDrain) => Promise<void>) {
  const dom = installTestDom();
  const previousAct = setActEnvironment(true);
  try {
    await run(actAndDrain);
  } finally {
    restoreActEnvironment(previousAct);
    await dom.restore();
  }
}

test("async catalog loading preserves and selects the requested template", async () => {
  await withTestDom(async (act) => {
    const deployments: TemplateDeploymentSettings[] = [];
    const initialSettings = { templateName: "flowise" };
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <TemplateDeployer
            initialSettings={initialSettings}
            loading
            onDeploy={(settings) => {
              deployments.push(settings);
            }}
            templateOptions={[]}
          />
        );
      });
      assert.match(rendered?.container.textContent ?? "", LOADING_TEMPLATES_RE);
      assert.equal(deployments.length, 0);

      await act(() => {
        rendered?.rerender(
          <TemplateDeployer
            initialSettings={initialSettings}
            onDeploy={(settings) => {
              deployments.push(settings);
            }}
            templateOptions={[DIFY, FLOWISE]}
          />
        );
      });

      const combobox = rendered?.getByTestId(
        "template.deployer.template-combobox"
      );
      const port = rendered?.getByLabelText("port") as
        | HTMLInputElement
        | undefined;
      const submit = rendered?.getByTestId("template.deployer.submit") as
        | HTMLButtonElement
        | undefined;
      assert.match(combobox?.textContent ?? "", FLOWISE_RE);
      assert.equal(port?.value, "3000");
      assert.equal(submit?.disabled, false);
      assert.equal(deployments.length, 0);

      await act(() => {
        if (submit != null) {
          fireEvent.click(submit);
        }
      });
      assert.equal(deployments.length, 1);
      assert.equal(deployments[0]?.templateName, "flowise");
      assert.deepEqual(deployments[0]?.args, { port: "3000" });
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("an unavailable requested template never falls back or deploys", async () => {
  await withTestDom(async (act) => {
    let deploymentCount = 0;
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <TemplateDeployer
            initialSettings={{ templateName: "missing-template" }}
            onDeploy={() => {
              deploymentCount += 1;
            }}
            templateOptions={[DIFY, FLOWISE]}
          />
        );
      });

      const submit = rendered?.getByTestId("template.deployer.submit") as
        | HTMLButtonElement
        | undefined;
      assert.match(
        rendered?.getByTestId("template.deployer.status").textContent ?? "",
        UNAVAILABLE_TEMPLATE_RE
      );
      assert.equal(submit?.disabled, true);
      await act(() => {
        if (submit != null) {
          fireEvent.click(submit);
        }
      });
      assert.equal(deploymentCount, 0);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("auto deploy waits for the catalog and applies template form values once", async () => {
  await withTestDom(async (act) => {
    const deployments: TemplateDeploymentSettings[] = [];
    const initialSettings = {
      args: { port: "8080" },
      templateName: "flowise",
    };
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <TemplateDeployer
            autoDeploy
            initialSettings={initialSettings}
            loading
            onDeploy={(settings) => {
              deployments.push(settings);
            }}
            templateOptions={[]}
          />
        );
      });
      assert.equal(deployments.length, 0);

      await act(() => {
        rendered?.rerender(
          <TemplateDeployer
            autoDeploy
            initialSettings={initialSettings}
            onDeploy={(settings) => {
              deployments.push(settings);
            }}
            templateOptions={[FLOWISE]}
          />
        );
      });

      assert.equal(deployments.length, 1);
      assert.deepEqual(deployments[0]?.args, { port: "8080" });
      assert.equal(deployments[0]?.templateName, "flowise");

      await act(() => {
        rendered?.rerender(
          <TemplateDeployer
            autoDeploy
            initialSettings={initialSettings}
            onDeploy={(settings) => {
              deployments.push(settings);
            }}
            templateOptions={[FLOWISE]}
          />
        );
      });
      assert.equal(deployments.length, 1);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("an incomplete initial form cancels auto deploy after values become valid", async () => {
  await withTestDom(async (act) => {
    const deployments: TemplateDeploymentSettings[] = [];
    const onDeploy = (settings: TemplateDeploymentSettings) => {
      deployments.push(settings);
    };
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <TemplateDeployer
            autoDeploy
            initialSettings={{ args: {}, templateName: "dify" }}
            onDeploy={onDeploy}
            templateOptions={[DIFY]}
          />
        );
      });
      assert.equal(deployments.length, 0);

      await act(() => {
        rendered?.rerender(
          <TemplateDeployer
            autoDeploy
            initialSettings={{
              args: { password: "a" },
              templateName: "dify",
            }}
            onDeploy={onDeploy}
            templateOptions={[DIFY]}
          />
        );
      });
      assert.equal(deployments.length, 0);
      assert.equal(
        (rendered?.getByLabelText("password") as HTMLInputElement).value,
        "a"
      );

      const submit = rendered?.getByTestId("template.deployer.submit") as
        | HTMLButtonElement
        | undefined;
      assert.equal(submit?.disabled, false);
      await act(() => {
        if (submit != null) {
          fireEvent.click(submit);
        }
      });
      assert.equal(deployments.length, 1);
      assert.deepEqual(deployments[0]?.args, { password: "a" });
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("catalog and initial settings changes never deploy automatically", async () => {
  await withTestDom(async (act) => {
    let deploymentCount = 0;
    let rendered: ReturnType<typeof render> | undefined;
    try {
      const onDeploy = () => {
        deploymentCount += 1;
      };
      await act(() => {
        rendered = render(
          <TemplateDeployer onDeploy={onDeploy} templateOptions={[]} />
        );
      });
      await act(() => {
        rendered?.rerender(
          <TemplateDeployer
            initialSettings={{ templateName: "flowise" }}
            onDeploy={onDeploy}
            templateOptions={[FLOWISE]}
          />
        );
      });
      await act(() => {
        rendered?.rerender(
          <TemplateDeployer
            errorMessage="Could not load template catalog."
            initialSettings={{ templateName: "flowise" }}
            onDeploy={onDeploy}
            templateOptions={[FLOWISE]}
          />
        );
      });

      assert.equal(deploymentCount, 0);
      assert.equal(
        (rendered?.getByTestId("template.deployer.submit") as HTMLButtonElement)
          .disabled,
        true
      );
      assert.match(
        rendered?.getByTestId("template.deployer.status").textContent ?? "",
        CATALOG_ERROR_RE
      );
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});
