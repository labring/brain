import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render } from "@testing-library/react/pure";
import type { ReactNode } from "react";
import type { ProjectDbTarget } from "@/features/panes/target-identity";
import {
  jsonResponse,
  restoreGlobal,
  stubFetch,
  withTestDom,
} from "@/features/project-canvas/react-test-harness";

import {
  DbSettingsProvider,
  dbSettingsDataFromExactResource,
} from "../settings-provider-db";

const NAMESPACE = "ns-switch-test";
const PGSQL_HOST_PATTERN = /PGSQL-LEAK-HOST/;
const REDIS_HOST_PATTERN = /REDIS-HOST/;
const RESOURCES_SECTION_PATTERN = /Replicas & Resources/;

function dbClaim(input: {
  cpuLimit: string;
  engine: string;
  memoryLimit: string;
  name: string;
  namespace?: string;
  replicas: number;
  storageSize: string;
}) {
  return {
    metadata: {
      annotations: {},
      labels: {},
      name: input.name,
      namespace: input.namespace ?? NAMESPACE,
    },
    spec: {
      cpuLimit: input.cpuLimit,
      engine: input.engine,
      exposeNodePort: false,
      memoryLimit: input.memoryLimit,
      replicas: input.replicas,
      storageSize: input.storageSize,
    },
    status: {
      clusterVersionRef: "16.4",
      connectionStringPrivate: `db-template://${input.name}.internal:5432/db`,
      phase: "Running",
    },
  };
}

const POSTGRES_CLAIM = dbClaim({
  cpuLimit: "1",
  engine: "postgresql",
  memoryLimit: "2Gi",
  name: "affine-postgresql",
  replicas: 2,
  storageSize: "20Gi",
});

const REDIS_CLAIM = dbClaim({
  cpuLimit: "2",
  engine: "redis",
  memoryLimit: "4Gi",
  name: "affine-redis",
  replicas: 4,
  storageSize: "8Gi",
});

function postgresTarget(): ProjectDbTarget {
  return { kind: "DB", name: "affine-postgresql", namespace: NAMESPACE };
}

function redisTarget(): ProjectDbTarget {
  return { kind: "DB", name: "affine-redis", namespace: NAMESPACE };
}

function sliderValues(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('[role="slider"]')).map((node) =>
    Number(node.getAttribute("aria-valuenow"))
  );
}

function providerElement(input: {
  kubeconfig: string;
  target: ProjectDbTarget;
}): ReactNode {
  const noop = () => undefined;
  return (
    <DbSettingsProvider
      kubeconfig={input.kubeconfig}
      onClose={noop}
      onModelChange={noop}
      readOnly={false}
      target={input.target}
    />
  );
}

test("a revealed connection DSN does not leak onto another DB node's rows", async () => {
  await withTestDom(async (actAndDrain) => {
    const POSTGRES_DSN = "postgresql://u:pw@PGSQL-LEAK-HOST:5432/db";
    const REDIS_DSN = "redis://u:pw@REDIS-HOST:6379/0";
    const { override } = stubFetch((url) => {
      if (url.includes("connection-string")) {
        return jsonResponse({
          value: url.includes("affine-redis") ? REDIS_DSN : POSTGRES_DSN,
        });
      }
      if (url.includes("affine-redis")) {
        return jsonResponse(REDIS_CLAIM);
      }
      if (url.includes("affine-postgresql")) {
        return jsonResponse(POSTGRES_CLAIM);
      }
      return jsonResponse({});
    });
    let rendered: ReturnType<typeof render> | undefined;

    try {
      await actAndDrain(() => {
        rendered = render(
          providerElement({
            kubeconfig: "kubeconfig-switch-test",
            target: postgresTarget(),
          })
        );
      });
      assert.ok(rendered, "initial render");
      const view = rendered;

      await actAndDrain(() => {
        fireEvent.click(view.getByLabelText("Reveal Private Connection"));
      });
      assert.match(
        view.container.textContent ?? "",
        PGSQL_HOST_PATTERN,
        "the postgres DSN is revealed on its own pane"
      );

      await actAndDrain(() => {
        view.rerender(
          providerElement({
            kubeconfig: "kubeconfig-switch-test",
            target: redisTarget(),
          })
        );
      });
      assert.doesNotMatch(
        view.container.textContent ?? "",
        PGSQL_HOST_PATTERN,
        "the postgres DSN must not render on the redis pane"
      );

      await actAndDrain(() => {
        fireEvent.click(view.getByLabelText("Reveal Private Connection"));
      });
      assert.match(
        view.container.textContent ?? "",
        REDIS_HOST_PATTERN,
        "revealing on the redis pane resolves the redis DSN"
      );
    } finally {
      await actAndDrain(() => {
        rendered?.unmount();
      });
      restoreGlobal(override);
    }
    await actAndDrain(() => undefined);
  });
});

test("dbSettingsDataFromExactResource only accepts claims that match the target", () => {
  const target = postgresTarget();
  const matching = dbSettingsDataFromExactResource(POSTGRES_CLAIM, target);
  assert.ok(matching, "a matching claim backs the pane");
  assert.equal(matching.workload.name, "affine-postgresql");

  assert.equal(
    dbSettingsDataFromExactResource(REDIS_CLAIM, target),
    null,
    "a claim for another DB is rejected"
  );

  assert.equal(
    dbSettingsDataFromExactResource(
      dbClaim({
        cpuLimit: "1",
        engine: "postgresql",
        memoryLimit: "2Gi",
        name: "affine-postgresql",
        namespace: "ns-other",
        replicas: 2,
        storageSize: "20Gi",
      }),
      target
    ),
    null,
    "a claim from another namespace is rejected"
  );

  assert.equal(
    dbSettingsDataFromExactResource(
      {
        ...POSTGRES_CLAIM,
        metadata: { annotations: {}, labels: {}, name: "affine-postgresql" },
      },
      target
    ),
    null,
    "a claim without a namespace fails closed"
  );

  assert.equal(
    dbSettingsDataFromExactResource(undefined, target),
    null,
    "no claim is null"
  );
  assert.equal(
    dbSettingsDataFromExactResource(POSTGRES_CLAIM, null),
    null,
    "no target is null"
  );
});

test("DB settings provider ignores a fetched claim that belongs to another DB", async () => {
  await withTestDom(async (actAndDrain) => {
    // Every fetch answers with the postgres claim while the pane targets redis.
    const { override } = stubFetch(() => jsonResponse(POSTGRES_CLAIM));
    let rendered: ReturnType<typeof render> | undefined;

    try {
      await actAndDrain(() => {
        rendered = render(
          providerElement({
            kubeconfig: "kubeconfig-switch-test",
            target: redisTarget(),
          })
        );
      });
      assert.ok(rendered, "render");
      const { container } = rendered;
      assert.equal(
        sliderValues(container).length,
        0,
        "a foreign claim must not render another DB's cards"
      );
      assert.doesNotMatch(
        container.textContent ?? "",
        RESOURCES_SECTION_PATTERN,
        "the settings sections stay in their loading/unavailable state"
      );
    } finally {
      await actAndDrain(() => {
        rendered?.unmount();
      });
      restoreGlobal(override);
    }
    await actAndDrain(() => undefined);
  });
});

test("DB settings provider revalidates a quickly revisited node inside SWR's dedupe window", async () => {
  await withTestDom(async (actAndDrain) => {
    let postgresClaim = POSTGRES_CLAIM;
    const { calls, override } = stubFetch((url) => {
      if (url.includes("affine-redis")) {
        return jsonResponse(REDIS_CLAIM);
      }
      if (url.includes("affine-postgresql")) {
        return jsonResponse(postgresClaim);
      }
      return jsonResponse({});
    });
    let rendered: ReturnType<typeof render> | undefined;

    try {
      await actAndDrain(() => {
        rendered = render(
          providerElement({
            kubeconfig: "kubeconfig-switch-test-2",
            target: postgresTarget(),
          })
        );
      });
      assert.ok(rendered, "initial render");
      const view = rendered;
      assert.deepEqual(sliderValues(view.container), [2, 1, 2, 20]);

      await actAndDrain(() => {
        view.rerender(
          providerElement({
            kubeconfig: "kubeconfig-switch-test-2",
            target: redisTarget(),
          })
        );
      });
      assert.deepEqual(sliderValues(view.container), [4, 2, 4, 8]);

      postgresClaim = dbClaim({
        cpuLimit: "2",
        engine: "postgresql",
        memoryLimit: "8Gi",
        name: "affine-postgresql",
        replicas: 5,
        storageSize: "50Gi",
      });

      // Switch back immediately — inside SWR's default 2s dedupe window.
      const postgresFetchCountBefore = calls.filter((call) =>
        call.url.includes("affine-postgresql")
      ).length;
      await actAndDrain(() => {
        view.rerender(
          providerElement({
            kubeconfig: "kubeconfig-switch-test-2",
            target: postgresTarget(),
          })
        );
      });
      const postgresFetchCountAfter = calls.filter((call) =>
        call.url.includes("affine-postgresql")
      ).length;
      assert.ok(
        postgresFetchCountAfter > postgresFetchCountBefore,
        "revisiting a node must issue a fresh resource fetch"
      );
      assert.deepEqual(
        sliderValues(view.container),
        [5, 2, 8, 50],
        "a quick revisit must not serve the stale cached claim"
      );
    } finally {
      await actAndDrain(() => {
        rendered?.unmount();
      });
      restoreGlobal(override);
    }
    await actAndDrain(() => undefined);
  });
});
