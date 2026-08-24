import { describe, expect, test } from "bun:test";

import { formatAiCredits, parseAiQuotaPayload } from "./ai-quota-core";

describe("AI quota core", () => {
  test("parses numeric and string quota values", () => {
    expect(
      parseAiQuotaPayload({
        quota: {
          hard: { ai_quota: "20000000" },
          used: { ai_quota: 5_000_000 },
        },
      })
    ).toEqual({
      hasAllowance: true,
      totalMicroUnits: 20_000_000,
      usedMicroUnits: 5_000_000,
    });
    expect(formatAiCredits(15_000_000)).toBe("1,500");
  });

  test("distinguishes a workspace without an AI allowance", () => {
    expect(
      parseAiQuotaPayload({
        quota: { hard: { cpu: "2" }, used: { cpu: "1" } },
      })
    ).toEqual({
      hasAllowance: false,
      totalMicroUnits: 0,
      usedMicroUnits: 0,
    });
  });

  test("rejects malformed quota responses", () => {
    expect(() => parseAiQuotaPayload({ quota: "invalid" })).toThrow(
      "AI quota response is invalid."
    );
  });
});
