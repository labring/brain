import assert from "node:assert/strict";
import { test } from "node:test";

import {
  backupPolicyFormFromBackend,
  backupPolicyFormToBackend,
  backupPolicyFormWithFrequency,
  validateDbServiceBackupPolicyRetentionDays,
} from "./backup-policy-schedule";

test("converts hourly DB Service backup policy minutes between local time and UTC cron", () => {
  const backend = backupPolicyFormToBackend(
    {
      enabled: true,
      frequency: "hourly",
      minute: 30,
      retentionDays: 7,
    },
    "America/Los_Angeles",
    "2026-06-09T12:00:00Z"
  );

  assert.deepEqual(backend, {
    cronExpression: "30 * * * *",
    retentionPeriod: "7d",
  });

  assert.deepEqual(
    backupPolicyFormFromBackend(
      {
        cronExpression: "30 * * * *",
        enabled: true,
        retentionPeriod: "7d",
      },
      "America/Los_Angeles",
      "2026-06-09T12:00:00Z"
    ),
    {
      enabled: true,
      frequency: "hourly",
      minute: 30,
      retentionDays: 7,
    }
  );
});

test("converts daily DB Service backup policy local time to UTC cron", () => {
  const backend = backupPolicyFormToBackend(
    {
      enabled: true,
      frequency: "daily",
      hour: 1,
      minute: 15,
      retentionDays: 14,
    },
    "America/Los_Angeles",
    "2026-06-09T12:00:00Z"
  );

  assert.deepEqual(backend, {
    cronExpression: "15 8 * * *",
    retentionPeriod: "14d",
  });
});

test("converts weekly DB Service backup policy with UTC weekday rollover", () => {
  const backend = backupPolicyFormToBackend(
    {
      enabled: true,
      frequency: "weekly",
      hour: 23,
      minute: 45,
      retentionDays: 30,
      weekdays: [5],
    },
    "America/Los_Angeles",
    "2026-06-09T12:00:00Z"
  );

  assert.deepEqual(backend, {
    cronExpression: "45 6 * * 6",
    retentionPeriod: "30d",
  });

  assert.deepEqual(
    backupPolicyFormFromBackend(
      {
        cronExpression: "45 6 * * 6",
        enabled: true,
        retentionPeriod: "30d",
      },
      "America/Los_Angeles",
      "2026-06-09T12:00:00Z"
    ),
    {
      enabled: true,
      frequency: "weekly",
      hour: 23,
      minute: 45,
      retentionDays: 30,
      weekdays: [5],
    }
  );
});

test("validates DB Service backup policy retention choices", () => {
  assert.equal(validateDbServiceBackupPolicyRetentionDays(1).ok, true);
  assert.equal(validateDbServiceBackupPolicyRetentionDays(7).ok, true);
  assert.deepEqual(validateDbServiceBackupPolicyRetentionDays(2), {
    message: "Retention must be one of 1, 3, 7, 14, or 30 days.",
    ok: false,
  });
});

test("preserves shared DB Service backup policy form values when frequency mode changes", () => {
  const daily = {
    enabled: true,
    frequency: "daily",
    hour: 9,
    minute: 10,
    retentionDays: 14,
  } as const;

  assert.deepEqual(backupPolicyFormWithFrequency(daily, "weekly"), {
    enabled: true,
    frequency: "weekly",
    hour: 9,
    minute: 10,
    retentionDays: 14,
    weekdays: [1],
  });
  assert.deepEqual(backupPolicyFormWithFrequency(daily, "hourly"), {
    enabled: true,
    frequency: "hourly",
    minute: 10,
    retentionDays: 14,
  });
});
