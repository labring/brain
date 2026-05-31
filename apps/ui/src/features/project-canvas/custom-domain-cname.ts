import { resolveCname } from "node:dns/promises";

export type CustomDomainCnameFailureReason = "invalid" | "mismatch" | "missing";

export interface CustomDomainCnameSuccess {
  domain: string;
  ok: true;
  records: string[];
  target: string;
}

export interface CustomDomainCnameFailure {
  domain: string;
  message: string;
  ok: false;
  reason: CustomDomainCnameFailureReason;
  records: string[];
  target: string;
}

export type CustomDomainCnameResult =
  | CustomDomainCnameFailure
  | CustomDomainCnameSuccess;

export interface VerifyCustomDomainCnameInput {
  domain: string;
  resolveCname?: (domain: string) => Promise<string[]>;
  target: string;
}

const DNS_NOT_FOUND_CODES = new Set(["ENODATA", "ENOTFOUND"]);
const DOMAIN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function normalizeDnsName(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/g, "");
}

function isValidDomainName(value: string): boolean {
  const domain = normalizeDnsName(value);
  if (domain.length < 1 || domain.length > 253 || !domain.includes(".")) {
    return false;
  }
  return domain.split(".").every((label) => DOMAIN_LABEL_RE.test(label));
}

function errorCode(error: unknown): string {
  return typeof error === "object" &&
    error != null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "";
}

function missingResult(
  domain: string,
  target: string
): CustomDomainCnameFailure {
  return {
    domain,
    message: `No CNAME record was found for ${domain}.`,
    ok: false,
    reason: "missing",
    records: [],
    target,
  };
}

export async function verifyCustomDomainCname({
  domain,
  resolveCname: resolve = resolveCname,
  target,
}: VerifyCustomDomainCnameInput): Promise<CustomDomainCnameResult> {
  const normalizedDomain = normalizeDnsName(domain);
  const normalizedTarget = normalizeDnsName(target);

  if (!isValidDomainName(normalizedDomain) || normalizedTarget === "") {
    return {
      domain: normalizedDomain,
      message: "Custom Domain and CNAME target must be valid DNS names.",
      ok: false,
      reason: "invalid",
      records: [],
      target: normalizedTarget,
    };
  }

  let records: string[];
  try {
    records = (await resolve(normalizedDomain)).map(normalizeDnsName);
  } catch (error) {
    if (DNS_NOT_FOUND_CODES.has(errorCode(error))) {
      return missingResult(normalizedDomain, normalizedTarget);
    }
    throw error;
  }

  if (records.length === 0) {
    return missingResult(normalizedDomain, normalizedTarget);
  }

  if (records.includes(normalizedTarget)) {
    return {
      domain: normalizedDomain,
      ok: true,
      records,
      target: normalizedTarget,
    };
  }

  return {
    domain: normalizedDomain,
    message: `CNAME record for ${normalizedDomain} points to ${records.join(
      ", "
    )}, not ${normalizedTarget}.`,
    ok: false,
    reason: "mismatch",
    records,
    target: normalizedTarget,
  };
}
