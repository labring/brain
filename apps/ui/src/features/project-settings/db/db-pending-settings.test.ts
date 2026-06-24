import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyDbPendingTargets,
  dbPendingTargetForDomain,
  dbPendingTargetsForDirtyDomains,
} from "./db-pending-settings";
import type { DatabaseSettingsDraft } from "./db-settings-draft";

test("DB pending adapter keeps resource and public connection targets separate", () => {
  const base: DatabaseSettingsDraft = {
    cpuLimitCores: 1,
    exposeNodePort: false,
    memoryLimitGi: 2,
    replicas: 1,
    storageSizeGi: 20,
  };
  const resourcesDraft = {
    ...base,
    memoryLimitGi: 4,
    replicas: 2,
  };
  const accessDraft = {
    ...base,
    exposeNodePort: true,
  };

  assert.deepEqual(dbPendingTargetsForDirtyDomains(base, resourcesDraft), {
    resources: {
      cpuLimitCores: 1,
      memoryLimitGi: 4,
      replicas: 2,
      storageSizeGi: 20,
    },
  });
  assert.deepEqual(dbPendingTargetsForDirtyDomains(base, accessDraft), {
    access: { exposeNodePort: true },
  });

  const effective = applyDbPendingTargets(base, {
    access: dbPendingTargetForDomain("access", accessDraft),
    resources: dbPendingTargetForDomain("resources", resourcesDraft),
  });

  assert.deepEqual(effective, {
    cpuLimitCores: 1,
    exposeNodePort: true,
    memoryLimitGi: 4,
    replicas: 2,
    storageSizeGi: 20,
  });
});
