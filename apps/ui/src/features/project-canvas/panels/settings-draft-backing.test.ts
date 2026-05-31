import assert from "node:assert/strict";
import { test } from "node:test";

import type { ContainerSettingsDraft } from "@workspace/ui/components/container-settings-pane/container-settings-pane";
import { containerSettingsDraftIsDirty } from "@workspace/ui/components/container-settings-pane/container-settings-pane";
import {
  commitSettingsDraftBackingState,
  createSettingsDraftBackingState,
  failSettingsDraftSave,
  keepEditingSettingsDraftBackingState,
  reloadSettingsDraftBackingState,
  syncSettingsDraftBackingState,
} from "@workspace/ui/lib/settings-draft-backing";
import type { DatabaseSettingsDraft } from "./database-settings-draft";
import { dbSettingsDraftIsDirty } from "./database-settings-draft";

const DRAFT_AVAILABLE_RE = /draft is still available/;

test("DB settings dirty draft survives backing refresh until the user reloads", () => {
  const base: DatabaseSettingsDraft = {
    cpuLimitCores: 1,
    exposeNodePort: false,
    memoryLimitGi: 2,
    replicas: 2,
    storageSizeGi: 20,
  };
  const draft = { ...base, replicas: 3 };
  const latest = { ...base, memoryLimitGi: 4, replicas: 4 };
  const state = createSettingsDraftBackingState(base, "rv-1");

  const refreshed = syncSettingsDraftBackingState(state, {
    backing: latest,
    backingKey: "rv-2",
    draft,
    isDirty: dbSettingsDraftIsDirty,
  });

  assert.equal(refreshed.draft, undefined);
  assert.equal(refreshed.state.resourceChanged, true);
  assert.deepEqual(refreshed.state.base, base);
  assert.deepEqual(refreshed.state.latest, latest);

  const kept = keepEditingSettingsDraftBackingState(refreshed.state);
  assert.equal(kept.resourceChanged, false);
  assert.deepEqual(kept.base, base);

  const reloaded = reloadSettingsDraftBackingState(refreshed.state);
  assert.deepEqual(reloaded.draft, latest);
  assert.deepEqual(reloaded.state.base, latest);
  assert.equal(reloaded.state.resourceChanged, false);
});

test("AP settings clean draft follows backing refresh while dirty draft preserves save failures", () => {
  const base: ContainerSettingsDraft = {
    cpuCores: 1,
    env: [{ name: "DATABASE_URL", value: "postgres://old" }],
    image: "ghcr.io/acme/api:old",
    memoryMib: 512,
    replicaStrategy: { fixed: { replicas: 2 }, type: "fixed" },
    replicas: 2,
  };
  const latest = {
    ...base,
    env: [{ name: "DATABASE_URL", value: "postgres://latest" }],
  };
  const state = createSettingsDraftBackingState(base, "rv-1");

  const cleanRefresh = syncSettingsDraftBackingState(state, {
    backing: latest,
    backingKey: "rv-2",
    draft: base,
    isDirty: containerSettingsDraftIsDirty,
  });

  assert.deepEqual(cleanRefresh.draft, latest);
  assert.deepEqual(cleanRefresh.state.base, latest);
  assert.equal(cleanRefresh.state.resourceChanged, false);

  const dirtyDraft = {
    ...latest,
    image: "ghcr.io/acme/api:user-edit",
  };
  const externallyChanged = {
    ...latest,
    memoryMib: 1024,
  };
  const dirtyRefresh = syncSettingsDraftBackingState(cleanRefresh.state, {
    backing: externallyChanged,
    backingKey: "rv-3",
    draft: dirtyDraft,
    isDirty: containerSettingsDraftIsDirty,
  });

  assert.equal(dirtyRefresh.draft, undefined);
  assert.equal(dirtyRefresh.state.resourceChanged, true);
  assert.deepEqual(dirtyRefresh.state.base, latest);

  const failed = failSettingsDraftSave(
    dirtyRefresh.state,
    new Error("API 409: resource was modified"),
    "Could not save settings."
  );
  assert.equal(failed.resourceChanged, true);
  assert.deepEqual(failed.base, latest);
  assert.match(failed.saveFailureMessage ?? "", DRAFT_AVAILABLE_RE);

  const committed = commitSettingsDraftBackingState(failed, dirtyDraft);
  assert.deepEqual(committed.base, dirtyDraft);
  assert.equal(committed.saveFailureMessage, null);
});
