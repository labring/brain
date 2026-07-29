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

const N8N = {
  args: [
    {
      default: "false",
      description: "Use PostgreSQL",
      key: "use_postgresql",
      required: false,
      type: "boolean",
    },
    {
      default: "UTC",
      description: "Workflow timezone",
      key: "timezone",
      options: ["UTC", "Asia/Shanghai"],
      required: false,
      type: "choice",
    },
    {
      default: "",
      description: "Private API token",
      key: "api_token",
      options: ["private-default", "private-alternative"],
      required: false,
      type: "password",
    },
  ],
  description: "Workflow automation template",
  name: "n8n",
  title: "n8n",
} satisfies TemplateDeploymentChoice;

const MAUTIC = {
  args: [
    {
      description: "PHP timezone used by Mautic",
      key: "TIMEZONE",
      options: ["UTC", "Asia/Shanghai"],
      required: false,
      type: "choice",
    },
  ],
  description: "Marketing automation template",
  name: "mautic",
  title: "Mautic",
} satisfies TemplateDeploymentChoice;

const SENSITIVE_BOOLEAN = {
  args: [
    {
      default: "TRUE",
      description: "Use secret integration",
      key: "use_secret",
      required: false,
      type: "boolean",
    },
  ],
  description: "Sensitive-looking Boolean template",
  name: "sensitive-boolean",
  title: "Sensitive Boolean",
} satisfies TemplateDeploymentChoice;

const CATALOG_ERROR_RE = /Could not load template catalog/;
const FLOWISE_RE = /Flowise/;
const LOADING_TEMPLATES_RE = /Loading templates/;
const UNAVAILABLE_TEMPLATE_RE = /Template "missing-template" is unavailable/;
const UTC_RE = /UTC/;

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

test("template controls submit canonical option and boolean values", async () => {
  await withTestDom(async (act) => {
    const deployments: TemplateDeploymentSettings[] = [];
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <TemplateDeployer
            onDeploy={(settings) => {
              deployments.push(settings);
            }}
            templateOptions={[N8N]}
          />
        );
      });

      const checkbox = rendered?.getByRole("checkbox", {
        name: "use_postgresql",
      });
      const checkboxLabel = rendered?.getByText("use_postgresql");
      const timezone = rendered?.getByRole("combobox", { name: "timezone" });
      const token = rendered?.getByLabelText("api_token") as
        | HTMLInputElement
        | undefined;
      const checkboxInput =
        checkboxLabel instanceof HTMLLabelElement
          ? checkboxLabel.ownerDocument.getElementById(checkboxLabel.htmlFor)
          : null;
      assert.equal(checkboxLabel?.tagName, "LABEL");
      assert.equal(checkboxInput?.getAttribute("type"), "checkbox");
      assert.equal(checkbox?.getAttribute("aria-checked"), "false");
      assert.match(timezone?.textContent ?? "", UTC_RE);
      assert.equal(token?.type, "password");

      await act(() => {
        if (checkboxLabel != null) {
          fireEvent.click(checkboxLabel);
        }
      });
      assert.equal(checkbox?.getAttribute("aria-checked"), "true");

      const submit = rendered?.getByTestId("template.deployer.submit");
      await act(() => {
        if (submit != null) {
          fireEvent.click(submit);
        }
      });

      assert.deepEqual(deployments, [
        {
          args: {
            api_token: "",
            timezone: "UTC",
            use_postgresql: "true",
          },
          sensitiveKeys: ["api_token"],
          templateName: "n8n",
        },
      ]);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("explicit boolean types control sensitive-looking parameter names", async () => {
  await withTestDom(async (act) => {
    const deployments: TemplateDeploymentSettings[] = [];
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <TemplateDeployer
            onDeploy={(settings) => {
              deployments.push(settings);
            }}
            templateOptions={[SENSITIVE_BOOLEAN]}
          />
        );
      });

      const checkbox = rendered?.getByRole("checkbox", {
        name: "use_secret",
      });
      assert.equal(checkbox?.getAttribute("aria-checked"), "true");

      const submit = rendered?.getByTestId("template.deployer.submit");
      await act(() => {
        if (submit != null) {
          fireEvent.click(submit);
        }
      });

      assert.deepEqual(deployments, [
        {
          args: { use_secret: "true" },
          sensitiveKeys: ["use_secret"],
          templateName: "sensitive-boolean",
        },
      ]);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("option controls without defaults select the first declared value", async () => {
  await withTestDom(async (act) => {
    const deployments: TemplateDeploymentSettings[] = [];
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <TemplateDeployer
            onDeploy={(settings) => {
              deployments.push(settings);
            }}
            templateOptions={[MAUTIC]}
          />
        );
      });

      const timezone = rendered?.getByRole("combobox", { name: "TIMEZONE" });
      assert.ok(timezone?.textContent?.includes("UTC"));

      const submit = rendered?.getByTestId("template.deployer.submit");
      await act(() => {
        if (submit != null) {
          fireEvent.click(submit);
        }
      });

      assert.deepEqual(deployments[0]?.args, { TIMEZONE: "UTC" });
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("template changes reset option and boolean defaults", async () => {
  await withTestDom(async (act) => {
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <TemplateDeployer
            initialSettings={{
              args: {
                timezone: "Asia/Shanghai",
                use_postgresql: "true",
              },
              templateName: "n8n",
            }}
            templateOptions={[N8N, MAUTIC]}
          />
        );
      });

      const checkbox = rendered?.getByRole("checkbox", {
        name: "use_postgresql",
      });
      const timezone = rendered?.getByRole("combobox", { name: "timezone" });
      assert.equal(checkbox?.getAttribute("aria-checked"), "true");
      assert.equal(timezone?.textContent, "Asia/Shanghai");

      await act(() => {
        rendered?.rerender(
          <TemplateDeployer
            initialSettings={{ args: {}, templateName: "mautic" }}
            templateOptions={[N8N, MAUTIC]}
          />
        );
      });

      const mauticTimezone = rendered?.getByRole("combobox", {
        name: "TIMEZONE",
      });
      assert.ok(mauticTimezone?.textContent?.includes("UTC"));

      await act(() => {
        rendered?.rerender(
          <TemplateDeployer
            initialSettings={{ args: {}, templateName: "n8n" }}
            templateOptions={[N8N, MAUTIC]}
          />
        );
      });

      const resetCheckbox = rendered?.getByRole("checkbox", {
        name: "use_postgresql",
      });
      assert.equal(resetCheckbox?.getAttribute("aria-checked"), "false");
      const n8nTimezone = rendered?.getByRole("combobox", {
        name: "timezone",
      });
      assert.ok(n8nTimezone?.textContent?.includes("UTC"));
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("new initial settings preserve seeded values when switching templates", async () => {
  await withTestDom(async (act) => {
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <TemplateDeployer
            initialSettings={{ args: {}, templateName: "n8n" }}
            templateOptions={[N8N, MAUTIC]}
          />
        );
      });

      await act(() => {
        rendered?.rerender(
          <TemplateDeployer
            initialSettings={{
              args: { TIMEZONE: "Asia/Shanghai" },
              templateName: "mautic",
            }}
            templateOptions={[N8N, MAUTIC]}
          />
        );
      });

      const timezone = rendered?.getByRole("combobox", { name: "TIMEZONE" });
      assert.equal(timezone?.textContent, "Asia/Shanghai");
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("initial settings normalize controlled values and preserve unknown args", async () => {
  await withTestDom(async (act) => {
    const deployments: TemplateDeploymentSettings[] = [];
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <TemplateDeployer
            initialSettings={{
              args: {
                legacy_arg: "preserved",
                timezone: "Mars/Olympus",
                use_postgresql: "TRUE",
              },
              templateName: "n8n",
            }}
            onDeploy={(settings) => {
              deployments.push(settings);
            }}
            templateOptions={[N8N]}
          />
        );
      });

      const checkbox = rendered?.getByRole("checkbox", {
        name: "use_postgresql",
      });
      const timezone = rendered?.getByRole("combobox", { name: "timezone" });
      assert.equal(checkbox?.getAttribute("aria-checked"), "true");
      assert.match(timezone?.textContent ?? "", UTC_RE);

      const submit = rendered?.getByTestId("template.deployer.submit");
      await act(() => {
        if (submit != null) {
          fireEvent.click(submit);
        }
      });

      assert.deepEqual(deployments[0]?.args, {
        api_token: "",
        legacy_arg: "preserved",
        timezone: "UTC",
        use_postgresql: "true",
      });
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
