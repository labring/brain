export const DB_SERVICE_BACKUP_RETENTION_DAY_CHOICES = [
  1, 3, 7, 14, 30,
] as const;

export type DbServiceBackupRetentionDays =
  (typeof DB_SERVICE_BACKUP_RETENTION_DAY_CHOICES)[number];

export const DB_SERVICE_BACKUP_POLICY_FREQUENCY_CHOICES = [
  "hourly",
  "daily",
  "weekly",
] as const;

export type DbServiceBackupPolicyFrequency =
  (typeof DB_SERVICE_BACKUP_POLICY_FREQUENCY_CHOICES)[number];

export const DB_SERVICE_BACKUP_WEEKDAY_LABELS: readonly string[] = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

export interface DbServiceBackupPolicyBackend {
  cronExpression?: string;
  enabled?: boolean;
  retentionPeriod?: string;
}

export interface DbServiceBackupPolicyBackendUpdate {
  cronExpression?: string;
  retentionPeriod?: string;
}

export type DbServiceBackupPolicyForm =
  | {
      enabled: boolean;
      frequency: "hourly";
      minute: number;
      retentionDays: number;
    }
  | {
      enabled: boolean;
      frequency: "daily";
      hour: number;
      minute: number;
      retentionDays: number;
    }
  | {
      enabled: boolean;
      frequency: "weekly";
      hour: number;
      minute: number;
      retentionDays: number;
      weekdays: number[];
    };

export interface DbServiceBackupPolicyValidationResult {
  message?: string;
  ok: boolean;
}

interface ZonedParts {
  day: number;
  hour: number;
  minute: number;
  month: number;
  weekday: number;
  year: number;
}

const DEFAULT_REFERENCE_INSTANT = "2026-01-01T12:00:00Z";
const RETENTION_MESSAGE = "Retention must be one of 1, 3, 7, 14, or 30 days.";

function defaultTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function dateFromReference(referenceInstant?: Date | string): Date {
  if (referenceInstant instanceof Date) {
    return referenceInstant;
  }
  if (typeof referenceInstant === "string") {
    return new Date(referenceInstant);
  }
  return new Date();
}

function safeReferenceDate(referenceInstant?: Date | string): Date {
  const date = dateFromReference(referenceInstant);
  return Number.isFinite(date.getTime())
    ? date
    : new Date(DEFAULT_REFERENCE_INSTANT);
}

function numberPart(parts: Intl.DateTimeFormatPart[], type: string): number {
  const value = parts.find((part) => part.type === type)?.value;
  return Number(value);
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    weekday: "short",
    year: "numeric",
  }).formatToParts(date);
  const weekdayLabel = parts.find((part) => part.type === "weekday")?.value;
  const weekday = Math.max(
    0,
    DB_SERVICE_BACKUP_WEEKDAY_LABELS.indexOf(weekdayLabel ?? "Sun")
  );
  return {
    day: numberPart(parts, "day"),
    hour: numberPart(parts, "hour"),
    minute: numberPart(parts, "minute"),
    month: numberPart(parts, "month"),
    weekday,
    year: numberPart(parts, "year"),
  };
}

function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const localAsUTC = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute
  );
  return (localAsUTC - date.getTime()) / 60_000;
}

function localDateTimeToUTC({
  day,
  hour,
  minute,
  month,
  timeZone,
  year,
}: {
  day: number;
  hour: number;
  minute: number;
  month: number;
  timeZone: string;
  year: number;
}): Date {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 3; i += 1) {
    const offset = timeZoneOffsetMinutes(new Date(utcMs), timeZone);
    utcMs = Date.UTC(year, month - 1, day, hour, minute) - offset * 60_000;
  }
  return new Date(utcMs);
}

function localCalendarDateForWeekday(
  reference: Date,
  timeZone: string,
  weekday: number
): { day: number; month: number; year: number } {
  const parts = zonedParts(reference, timeZone);
  const localDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  localDate.setUTCDate(localDate.getUTCDate() + (weekday - parts.weekday));
  return {
    day: localDate.getUTCDate(),
    month: localDate.getUTCMonth() + 1,
    year: localDate.getUTCFullYear(),
  };
}

function utcDateForWeekday(
  reference: Date,
  weekday: number,
  hour: number,
  minute: number
): Date {
  const date = new Date(
    Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      reference.getUTCDate(),
      hour,
      minute
    )
  );
  date.setUTCDate(date.getUTCDate() + (weekday - date.getUTCDay()));
  return date;
}

function cronFields(cronExpression: string | undefined): string[] | undefined {
  const fields = cronExpression?.trim().split(/\s+/);
  return fields?.length === 5 ? fields : undefined;
}

function parseCronNumber(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }
  return Number(value);
}

function parseCronWeekdays(value: string | undefined): number[] {
  if (value === undefined || value === "*") {
    return [];
  }
  return value
    .split(",")
    .map((part) => Number(part))
    .filter(
      (weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6
    );
}

function retentionDaysFromPeriod(value: string | undefined): number {
  const match = value?.trim().match(/^(\d+)d$/);
  if (!match) {
    return 7;
  }
  const days = Number(match[1]);
  return isRetentionChoice(days) ? days : 7;
}

function isRetentionChoice(
  value: number
): value is DbServiceBackupRetentionDays {
  return DB_SERVICE_BACKUP_RETENTION_DAY_CHOICES.some(
    (choice) => choice === value
  );
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function formHour(form: DbServiceBackupPolicyForm): number {
  return "hour" in form ? form.hour : 0;
}

function formWeekdays(form: DbServiceBackupPolicyForm): number[] {
  return "weekdays" in form && form.weekdays.length > 0 ? form.weekdays : [1];
}

function defaultForm(enabled = false): DbServiceBackupPolicyForm {
  return {
    enabled,
    frequency: "daily",
    hour: 0,
    minute: 0,
    retentionDays: 7,
  };
}

export function validateDbServiceBackupPolicyRetentionDays(
  retentionDays: number
): DbServiceBackupPolicyValidationResult {
  if (isRetentionChoice(retentionDays)) {
    return { ok: true };
  }
  return { message: RETENTION_MESSAGE, ok: false };
}

export function backupPolicyFormWithFrequency(
  form: DbServiceBackupPolicyForm,
  frequency: DbServiceBackupPolicyFrequency
): DbServiceBackupPolicyForm {
  const minute = clampInteger(form.minute, 0, 59);
  const hour = clampInteger(formHour(form), 0, 23);
  const retentionDays = isRetentionChoice(form.retentionDays)
    ? form.retentionDays
    : 7;

  switch (frequency) {
    case "hourly":
      return {
        enabled: form.enabled,
        frequency,
        minute,
        retentionDays,
      };
    case "daily":
      return {
        enabled: form.enabled,
        frequency,
        hour,
        minute,
        retentionDays,
      };
    case "weekly":
      return {
        enabled: form.enabled,
        frequency,
        hour,
        minute,
        retentionDays,
        weekdays: formWeekdays(form),
      };
  }
}

export function backupPolicyFormToBackend(
  form: DbServiceBackupPolicyForm,
  timeZone = defaultTimeZone(),
  referenceInstant?: Date | string
): DbServiceBackupPolicyBackendUpdate {
  if (!form.enabled) {
    return {};
  }
  const retention = validateDbServiceBackupPolicyRetentionDays(
    form.retentionDays
  );
  if (!retention.ok) {
    throw new Error(retention.message);
  }
  if (form.frequency === "hourly") {
    return {
      cronExpression: `${form.minute} * * * *`,
      retentionPeriod: `${form.retentionDays}d`,
    };
  }

  const reference = safeReferenceDate(referenceInstant);
  if (form.frequency === "daily") {
    const local = zonedParts(reference, timeZone);
    const utc = localDateTimeToUTC({
      day: local.day,
      hour: form.hour,
      minute: form.minute,
      month: local.month,
      timeZone,
      year: local.year,
    });
    return {
      cronExpression: `${utc.getUTCMinutes()} ${utc.getUTCHours()} * * *`,
      retentionPeriod: `${form.retentionDays}d`,
    };
  }

  const firstWeeklyUTC = localDateTimeToUTC({
    ...localCalendarDateForWeekday(reference, timeZone, form.weekdays[0] ?? 0),
    hour: form.hour,
    minute: form.minute,
    timeZone,
  });
  const utcWeekdays = form.weekdays
    .map((weekday) => {
      const localDate = localCalendarDateForWeekday(
        reference,
        timeZone,
        weekday
      );
      return localDateTimeToUTC({
        ...localDate,
        hour: form.hour,
        minute: form.minute,
        timeZone,
      }).getUTCDay();
    })
    .filter((weekday, index, values) => values.indexOf(weekday) === index)
    .sort((left, right) => left - right);

  return {
    cronExpression: `${firstWeeklyUTC.getUTCMinutes()} ${firstWeeklyUTC.getUTCHours()} * * ${utcWeekdays.join(",")}`,
    retentionPeriod: `${form.retentionDays}d`,
  };
}

export function backupPolicyFormFromBackend(
  policy: DbServiceBackupPolicyBackend | undefined,
  timeZone = defaultTimeZone(),
  referenceInstant?: Date | string
): DbServiceBackupPolicyForm {
  const enabled = policy?.enabled === true;
  const retentionDays = retentionDaysFromPeriod(policy?.retentionPeriod);
  const fields = cronFields(policy?.cronExpression);
  if (fields === undefined) {
    return { ...defaultForm(enabled), retentionDays };
  }

  const minute = parseCronNumber(fields[0]);
  const hour = parseCronNumber(fields[1]);
  if (minute === undefined || minute < 0 || minute > 59) {
    return { ...defaultForm(enabled), retentionDays };
  }

  if (
    fields[1] === "*" &&
    fields[2] === "*" &&
    fields[3] === "*" &&
    fields[4] === "*"
  ) {
    return {
      enabled,
      frequency: "hourly",
      minute,
      retentionDays,
    };
  }

  if (hour === undefined || hour < 0 || hour > 23) {
    return { ...defaultForm(enabled), retentionDays };
  }

  const reference = safeReferenceDate(referenceInstant);
  if (fields[2] === "*" && fields[3] === "*" && fields[4] === "*") {
    const local = zonedParts(
      new Date(
        Date.UTC(
          reference.getUTCFullYear(),
          reference.getUTCMonth(),
          reference.getUTCDate(),
          hour,
          minute
        )
      ),
      timeZone
    );
    return {
      enabled,
      frequency: "daily",
      hour: local.hour,
      minute: local.minute,
      retentionDays,
    };
  }

  const utcWeekdays = parseCronWeekdays(fields[4]);
  if (fields[2] === "*" && fields[3] === "*" && utcWeekdays.length > 0) {
    const localEntries = utcWeekdays.map((weekday) => {
      const local = zonedParts(
        utcDateForWeekday(reference, weekday, hour, minute),
        timeZone
      );
      return local;
    });
    const first = localEntries[0];
    if (first === undefined) {
      return { ...defaultForm(enabled), retentionDays };
    }
    return {
      enabled,
      frequency: "weekly",
      hour: first.hour,
      minute: first.minute,
      retentionDays,
      weekdays: localEntries
        .map((entry) => entry.weekday)
        .filter((weekday, index, values) => values.indexOf(weekday) === index)
        .sort((left, right) => left - right),
    };
  }

  return { ...defaultForm(enabled), retentionDays };
}
