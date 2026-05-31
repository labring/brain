import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDbSettingsPatch,
  DB_SETTINGS_CPU_LIMIT_CORES,
  DB_SETTINGS_MEMORY_LIMIT_GIB,
  DB_SETTINGS_REPLICAS,
  DB_SETTINGS_STORAGE_GIB,
  dbSettingsCpuLimitQuantity,
  dbSettingsDraftFromNodeData,
  dbSettingsDraftIsDirty,
  dbSettingsMemoryLimitQuantity,
  dbSettingsStorageQuantity,
} from "./database-settings-draft";

test("DB settings draft initializes bounded replicas from desired state", () => {
  assert.deepEqual(DB_SETTINGS_REPLICAS, { max: 10, min: 1 });

  assert.deepEqual(
    dbSettingsDraftFromNodeData({
      desired: { replicas: 12 },
    }),
    {
      cpuLimitCores: 0.5,
      exposeNodePort: false,
      memoryLimitGi: 1,
      replicas: 10,
      storageSizeGi: 3,
    }
  );

  assert.deepEqual(
    dbSettingsDraftFromNodeData({
      desired: {},
    }),
    {
      cpuLimitCores: 0.5,
      exposeNodePort: false,
      memoryLimitGi: 1,
      replicas: 1,
      storageSizeGi: 3,
    }
  );
});

test("DB settings draft detects replica changes and builds focused patches", () => {
  const data = {
    desired: { exposeNodePort: false, replicas: 2 },
  };
  const original = dbSettingsDraftFromNodeData(data);

  assert.equal(dbSettingsDraftIsDirty(original, original), false);
  assert.equal(buildDbSettingsPatch(original, original), null);

  assert.equal(
    dbSettingsDraftIsDirty(original, { ...original, replicas: 3 }),
    true
  );
  assert.deepEqual(
    buildDbSettingsPatch(original, { ...original, replicas: 3 }),
    {
      spec: { replicas: 3 },
    }
  );
});

test("DB settings draft detects public connection changes and builds combined patches", () => {
  const original = dbSettingsDraftFromNodeData({
    desired: {
      cpuLimit: "1",
      exposeNodePort: false,
      memoryLimit: "2Gi",
      replicas: 2,
      storageSize: "20Gi",
    },
  });

  assert.equal(original.exposeNodePort, false);
  assert.equal(
    dbSettingsDraftIsDirty(original, { ...original, exposeNodePort: true }),
    true
  );
  assert.deepEqual(
    buildDbSettingsPatch(original, {
      ...original,
      exposeNodePort: true,
      replicas: 3,
      storageSizeGi: 25,
    }),
    {
      spec: {
        exposeNodePort: true,
        replicas: 3,
        storageSize: "25Gi",
      },
    }
  );
});

test("DB settings draft adds routing domain when public connection needs region label", () => {
  const original = dbSettingsDraftFromNodeData({
    desired: { exposeNodePort: false, replicas: 1 },
  });

  assert.deepEqual(
    buildDbSettingsPatch(
      original,
      { ...original, exposeNodePort: true },
      {
        metadata: { labels: { "crossplane.io/project-name": "project" } },
        routingDomain: "192.168.12.53.nip.io",
      }
    ),
    {
      metadata: { labels: { region: "192.168.12.53.nip.io" } },
      spec: { exposeNodePort: true },
    }
  );
});

test("DB settings draft can repair missing region for already-enabled public connection", () => {
  const original = dbSettingsDraftFromNodeData({
    desired: { exposeNodePort: true, replicas: 1 },
  });

  assert.deepEqual(
    buildDbSettingsPatch(original, original, {
      metadata: { labels: { "crossplane.io/project-name": "project" } },
      routingDomain: "192.168.12.53.nip.io",
    }),
    {
      metadata: { labels: { region: "192.168.12.53.nip.io" } },
    }
  );
});

test("DB settings draft preserves existing public connection region label", () => {
  const original = dbSettingsDraftFromNodeData({
    desired: { exposeNodePort: false, replicas: 1 },
  });

  assert.deepEqual(
    buildDbSettingsPatch(
      original,
      { ...original, exposeNodePort: true },
      {
        metadata: { labels: { region: "custom.example.com" } },
        routingDomain: "192.168.12.53.nip.io",
      }
    ),
    {
      spec: { exposeNodePort: true },
    }
  );
});

test("DB settings draft normalizes resource and storage values into focused patches", () => {
  assert.deepEqual(DB_SETTINGS_CPU_LIMIT_CORES, {
    max: 4,
    min: 0.25,
    step: 0.25,
  });
  assert.deepEqual(DB_SETTINGS_MEMORY_LIMIT_GIB, {
    max: 8,
    min: 0.5,
    step: 0.5,
  });
  assert.deepEqual(DB_SETTINGS_STORAGE_GIB, { max: 100, min: 1, step: 1 });

  const original = dbSettingsDraftFromNodeData({
    desired: {
      cpuLimit: "1500m",
      cpuRequest: "500m",
      memoryLimit: "2Gi",
      memoryRequest: "1Gi",
      replicas: 2,
      storageSize: "20Gi",
    },
  });

  assert.deepEqual(original, {
    cpuLimitCores: 1.5,
    exposeNodePort: false,
    memoryLimitGi: 2,
    replicas: 2,
    storageSizeGi: 20,
  });

  const draft = {
    cpuLimitCores: 2,
    exposeNodePort: false,
    memoryLimitGi: 4,
    replicas: 3,
    storageSizeGi: 25,
  };

  assert.equal(dbSettingsDraftIsDirty(original, draft), true);
  assert.deepEqual(buildDbSettingsPatch(original, draft), {
    spec: {
      cpuLimit: "2",
      memoryLimit: "4Gi",
      replicas: 3,
      storageSize: "25Gi",
    },
  });
});

test("DB settings draft builds focused single-field patches", () => {
  const original = dbSettingsDraftFromNodeData({
    desired: {
      cpuLimit: "1",
      memoryLimit: "2Gi",
      replicas: 2,
      storageSize: "20Gi",
    },
  });

  assert.deepEqual(
    buildDbSettingsPatch(original, { ...original, cpuLimitCores: 1.25 }),
    { spec: { cpuLimit: "1250m" } }
  );
  assert.deepEqual(
    buildDbSettingsPatch(original, { ...original, memoryLimitGi: 2.5 }),
    { spec: { memoryLimit: "2560Mi" } }
  );
  assert.deepEqual(
    buildDbSettingsPatch(original, { ...original, storageSizeGi: 21 }),
    { spec: { storageSize: "21Gi" } }
  );
});

test("DB settings draft normalizes storage quantities to Gi draft values", () => {
  const original = dbSettingsDraftFromNodeData({
    desired: {
      cpuLimit: "1",
      memoryLimit: "1024Mi",
      replicas: 1,
      storageSize: "20480Mi",
    },
  });

  assert.equal(original.memoryLimitGi, 1);
  assert.equal(original.storageSizeGi, 20);
  assert.equal(dbSettingsStorageQuantity(20), "20Gi");
  assert.equal(dbSettingsMemoryLimitQuantity(1.5), "1536Mi");
  assert.equal(dbSettingsCpuLimitQuantity(0.5), "500m");
});
