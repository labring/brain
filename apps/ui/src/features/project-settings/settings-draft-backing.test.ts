import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AP_SETTINGS_DRAFT_DOMAINS,
  apSettingsDraftDomainIsDirty,
  apSettingsDraftIsDirty,
  mergeApSettingsDraftDomains,
} from "@/features/project-settings/ap/ap-settings-draft";
import type { ApSettingsDraft } from "@/features/project-settings/ap/ap-settings-sections";
import {
  commitSettingsDraftBackingState,
  createSettingsDraftBackingState,
  failSettingsDraftSave,
  keepEditingSettingsDraftBackingState,
  prepareSettingsDraftSubmit,
  reloadSettingsDraftBackingState,
  syncSettingsDraftBackingState,
} from "@/features/project-settings/ap/lib/settings-draft-backing";
import {
  DATABASE_SETTINGS_DRAFT_DOMAINS,
  type DatabaseSettingsDraft,
  dbSettingsDraftDomainIsDirty,
  dbSettingsDraftIsDirty,
  mergeDbSettingsDraftDomains,
} from "@/features/project-settings/db/db-settings-draft";

const DRAFT_AVAILABLE_RE = /draft is still available/;
const DATABASE_CONFIGURATION_CHANGED_RE = /Database configuration changed/;

test("DB settings dirty draft detects overlapping submit conflicts", () => {
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
  assert.equal(refreshed.state.submitConflictMessage, null);
  assert.deepEqual(refreshed.state.base, base);
  assert.deepEqual(refreshed.state.latest, latest);

  const prepared = prepareSettingsDraftSubmit(refreshed.state, {
    conflictMessage:
      "Database configuration changed since you started editing.",
    domains: DATABASE_SETTINGS_DRAFT_DOMAINS,
    draft,
    isDomainDirty: dbSettingsDraftDomainIsDirty,
    mergeDraft: mergeDbSettingsDraftDomains,
  });

  assert.equal(prepared.status, "conflict");
  assert.match(
    prepared.state.submitConflictMessage ?? "",
    DATABASE_CONFIGURATION_CHANGED_RE
  );

  const kept = keepEditingSettingsDraftBackingState(prepared.state);
  assert.equal(kept.submitConflictMessage, null);
  assert.deepEqual(kept.base, base);

  const reloaded = reloadSettingsDraftBackingState(refreshed.state);
  assert.deepEqual(reloaded.draft, latest);
  assert.deepEqual(reloaded.state.base, latest);
  assert.equal(reloaded.state.submitConflictMessage, null);
});

test("AP settings clean draft follows refresh and dirty draft merges unrelated latest changes", () => {
  const base: ApSettingsDraft = {
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
    isDirty: apSettingsDraftIsDirty,
  });

  assert.deepEqual(cleanRefresh.draft, latest);
  assert.deepEqual(cleanRefresh.state.base, latest);
  assert.equal(cleanRefresh.state.submitConflictMessage, null);

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
    isDirty: apSettingsDraftIsDirty,
  });

  assert.equal(dirtyRefresh.draft, undefined);
  assert.equal(dirtyRefresh.state.submitConflictMessage, null);
  assert.deepEqual(dirtyRefresh.state.base, latest);

  const prepared = prepareSettingsDraftSubmit(dirtyRefresh.state, {
    conflictMessage: "AP configuration changed since you started editing.",
    domains: AP_SETTINGS_DRAFT_DOMAINS,
    draft: dirtyDraft,
    isDomainDirty: apSettingsDraftDomainIsDirty,
    mergeDraft: mergeApSettingsDraftDomains,
  });

  assert.equal(prepared.status, "ready");
  assert.deepEqual(prepared.base, externallyChanged);
  assert.deepEqual(prepared.draft, {
    ...externallyChanged,
    envRawSource: "DATABASE_URL=postgres://latest",
    image: "ghcr.io/acme/api:user-edit",
  });

  const failed = failSettingsDraftSave(
    prepared.state,
    new Error("API 409: resource was modified"),
    "Could not save settings."
  );
  assert.equal(failed.submitConflictMessage, null);
  assert.deepEqual(failed.base, latest);
  assert.match(failed.saveFailureMessage ?? "", DRAFT_AVAILABLE_RE);

  const committed = commitSettingsDraftBackingState(failed, prepared.draft);
  assert.deepEqual(committed.base, prepared.draft);
  assert.equal(committed.saveFailureMessage, null);
});

test("AP settings submit can ignore unchanged observed backing for an active pending domain", () => {
  const submittedAgainst: ApSettingsDraft = {
    cpuCores: 1,
    env: [],
    image: "ghcr.io/acme/api:v1",
    memoryMib: 512,
  };
  const pendingTarget = {
    ...submittedAgainst,
    image: "ghcr.io/acme/api:v2",
  };
  const newerDraft = {
    ...pendingTarget,
    image: "ghcr.io/acme/api:v3",
  };
  const state = {
    ...createSettingsDraftBackingState(pendingTarget, "effective-v2"),
    latest: submittedAgainst,
    latestKey: "observed-v1",
  };

  const prepared = prepareSettingsDraftSubmit(state, {
    conflictMessage: "AP configuration changed since you started editing.",
    domains: AP_SETTINGS_DRAFT_DOMAINS,
    draft: newerDraft,
    isDomainDirty: apSettingsDraftDomainIsDirty,
    isLatestDomainChanged: (domain, { latest }) =>
      domain === "launch"
        ? apSettingsDraftDomainIsDirty(domain, submittedAgainst, latest)
        : apSettingsDraftDomainIsDirty(domain, pendingTarget, latest),
    mergeDraft: mergeApSettingsDraftDomains,
  });

  assert.equal(prepared.status, "ready");
  assert.deepEqual(prepared.base, submittedAgainst);
  assert.equal(prepared.draft.image, "ghcr.io/acme/api:v3");
});
