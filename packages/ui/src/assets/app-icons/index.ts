import applaunchpadIcon from "./applaunchpad.svg";
import appstoreIcon from "./appstore.svg";
import cloudserverIcon from "./cloudserver.svg";
import cronjobIcon from "./cronjob.svg";
import databaseIcon from "./database.svg";
import devboxIcon from "./devbox.svg";
import objectstorageIcon from "./objectstorage.svg";
import terminalIcon from "./terminal.svg";

/**
 * The app-type codes returned by the account service's
 * `/account/v1alpha1/cost-app-type-list` map. Billing rows carry a numeric
 * app type; that endpoint translates the number to one of these codes, and
 * this registry translates the code to a display name and icon.
 */
export type AppTypeCode =
  | "APP"
  | "APP-STORE"
  | "CLOUD-VM"
  | "DB"
  | "DB-BACKUP"
  | "DEV-BOX"
  | "JOB"
  | "LLM-TOKEN"
  | "OBJECT-STORAGE"
  | "OTHER"
  | "TERMINAL";

type SvgSource = string | { src: string };

export interface AppTypeInfo {
  displayName: string;
  icon?: SvgSource;
}

export const appTypesByCode = {
  APP: { displayName: "App Launchpad", icon: applaunchpadIcon },
  "APP-STORE": { displayName: "App Store", icon: appstoreIcon },
  "CLOUD-VM": { displayName: "Cloud Server", icon: cloudserverIcon },
  DB: { displayName: "Database", icon: databaseIcon },
  // No dedicated backup icon exists anywhere upstream; the database icon is
  // the closest honest match.
  "DB-BACKUP": { displayName: "Database Backup", icon: databaseIcon },
  "DEV-BOX": { displayName: "DevBox", icon: devboxIcon },
  JOB: { displayName: "Cron Job", icon: cronjobIcon },
  // AI Proxy ships no logo asset in the sealos frontend; callers fall back
  // to their generic glyph until one exists upstream.
  "LLM-TOKEN": { displayName: "AI Proxy" },
  "OBJECT-STORAGE": { displayName: "Object Storage", icon: objectstorageIcon },
  OTHER: { displayName: "Other" },
  TERMINAL: { displayName: "Terminal", icon: terminalIcon },
} as const satisfies Record<AppTypeCode, AppTypeInfo>;

export function appTypeInfo(
  code: string | null | undefined
): AppTypeInfo | undefined {
  if (code == null) {
    return undefined;
  }
  return (appTypesByCode as Record<string, AppTypeInfo>)[
    code.trim().toUpperCase()
  ];
}

export function appTypeDisplayName(
  code: string | null | undefined
): string | undefined {
  return appTypeInfo(code)?.displayName;
}

export function appTypeIconSrc(
  code: string | null | undefined
): string | undefined {
  const icon = appTypeInfo(code)?.icon;
  if (icon === undefined) {
    return undefined;
  }
  return typeof icon === "string" ? icon : icon.src;
}
