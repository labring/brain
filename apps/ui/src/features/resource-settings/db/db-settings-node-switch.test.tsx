import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@testing-library/react/pure";
import type { ReactNode } from "react";
import type { ProjectDbTarget } from "@/features/panes/target-identity";
import {
  jsonResponse,
  restoreGlobal,
  stubFetch,
  withTestDom,
} from "@/features/project-canvas/react-test-harness";

import { DbSettingsProvider } from "../settings-provider-db";
import { DatabaseSettingsPaneContent } from "./db-settings-sections";
import type { DbSettingsData } from "./db-settings-types";

const NAMESPACE = "ns-switch-test";
const POSTGRES_HEADING_PATTERN = /Database PostgreSQL/;
const REDIS_HEADING_PATTERN = /Database Redis/;

function dbClaim(input: {
  cpuLimit: string;
  engine: string;
  memoryLimit: string;
  name: string;
  replicas: number;
  storageSize: string;
}) {
  return {
    metadata: {
      annotations: {},
      labels: {},
      name: input.name,
      namespace: NAMESPACE,
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

function settingsDataFromClaim(
  claim: ReturnType<typeof dbClaim>
): DbSettingsData {
  return {
    connections: [
      {
        id: "private",
        kind: "private",
        label: "Private connection",
        value: claim.status.connectionStringPrivate,
      },
    ],
    desired: {
      cpuLimit: claim.spec.cpuLimit,
      exposeNodePort: false,
      memoryLimit: claim.spec.memoryLimit,
      replicas: claim.spec.replicas,
      storageSize: claim.spec.storageSize,
    },
    states: {
      displayEngine: claim.spec.engine === "redis" ? "Redis" : "PostgreSQL",
      engineKey: claim.spec.engine,
      name: claim.metadata.name,
    },
    workload: { name: claim.metadata.name, namespace: NAMESPACE },
  };
}

function sliderValues(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('[role="slider"]')).map((node) =>
    Number(node.getAttribute("aria-valuenow"))
  );
}

function postgresTarget(): ProjectDbTarget {
  return { kind: "DB", name: "affine-postgresql", namespace: NAMESPACE };
}

function redisTarget(): ProjectDbTarget {
  return { kind: "DB", name: "affine-redis", namespace: NAMESPACE };
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

test("DB settings sections refresh card values when the database data switches", async () => {
  await withTestDom(async (actAndDrain) => {
    let rendered: ReturnType<typeof render> | undefined;

    await actAndDrain(() => {
      rendered = render(
        <DatabaseSettingsPaneContent
          data={settingsDataFromClaim(POSTGRES_CLAIM)}
          editable={false}
        />
      );
    });
    assert.ok(rendered, "initial render");
    const initialView = rendered;
    assert.match(
      initialView.container.textContent ?? "",
      POSTGRES_HEADING_PATTERN
    );
    assert.deepEqual(sliderValues(initialView.container), [2, 1, 2, 20]);

    await actAndDrain(() => {
      initialView.rerender(
        <DatabaseSettingsPaneContent
          data={settingsDataFromClaim(REDIS_CLAIM)}
          editable={false}
        />
      );
    });
    assert.match(
      initialView.container.textContent ?? "",
      REDIS_HEADING_PATTERN
    );
    assert.deepEqual(
      sliderValues(initialView.container),
      [4, 2, 4, 8],
      "card values must follow the newly selected database"
    );
  });
});

test("DB settings provider refreshes card values when the target switches", async () => {
  await withTestDom(async (actAndDrain) => {
    const { calls, override } = stubFetch((url) => {
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
      assert.deepEqual(sliderValues(view.container), [2, 1, 2, 20]);

      await actAndDrain(() => {
        view.rerender(
          providerElement({
            kubeconfig: "kubeconfig-switch-test",
            target: redisTarget(),
          })
        );
      });
      assert.deepEqual(
        sliderValues(view.container),
        [4, 2, 4, 8],
        "card values must follow the newly selected DB node"
      );
      assert.ok(
        calls.some((call) => call.url.includes("affine-redis")),
        "the redis DB resource must be fetched after the switch"
      );
    } finally {
      restoreGlobal(override);
    }
    await actAndDrain(() => undefined);
  });
});

test("DB settings provider revalidates when switching back after backend changes", async () => {
  await withTestDom(async (actAndDrain) => {
    let postgresClaim = dbClaim({
      cpuLimit: "1",
      engine: "postgresql",
      memoryLimit: "2Gi",
      name: "affine-postgresql",
      replicas: 2,
      storageSize: "20Gi",
    });
    const { override } = stubFetch((url) => {
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

      postgresClaim = dbClaim({
        cpuLimit: "2",
        engine: "postgresql",
        memoryLimit: "8Gi",
        name: "affine-postgresql",
        replicas: 5,
        storageSize: "50Gi",
      });

      // Wait past SWR's default 2s deduping interval before revisiting.
      await actAndDrain(() => undefined, 2500);

      await actAndDrain(() => {
        view.rerender(
          providerElement({
            kubeconfig: "kubeconfig-switch-test-2",
            target: postgresTarget(),
          })
        );
      });
      assert.deepEqual(
        sliderValues(view.container),
        [5, 2, 8, 50],
        "switching back to a node must reflect its current backend state"
      );
    } finally {
      restoreGlobal(override);
    }
    await actAndDrain(() => undefined);
  });
});

test("DB settings provider revalidates a quickly revisited node within the dedupe window", async () => {
  await withTestDom(async (actAndDrain) => {
    let postgresClaim = dbClaim({
      cpuLimit: "1",
      engine: "postgresql",
      memoryLimit: "2Gi",
      name: "affine-postgresql",
      replicas: 2,
      storageSize: "20Gi",
    });
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
            kubeconfig: "kubeconfig-switch-test-3",
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
            kubeconfig: "kubeconfig-switch-test-3",
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

      // Switch back immediately: no 2s wait. The revisit must still revalidate.
      const postgresFetchCountBefore = calls.filter((call) =>
        call.url.includes("affine-postgresql")
      ).length;
      await actAndDrain(() => {
        view.rerender(
          providerElement({
            kubeconfig: "kubeconfig-switch-test-3",
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
      restoreGlobal(override);
    }
    await actAndDrain(() => undefined);
  });
});
