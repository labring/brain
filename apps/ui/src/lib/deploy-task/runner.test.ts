import { describe, expect, it } from "bun:test";

import { deployTaskFailureSummary } from "./failure-summary";

describe("deploy task runner failure summaries", () => {
  it("summarizes noisy skill install failures", () => {
    expect(
      deployTaskFailureSummary(
        new Error("No valid skills found. Skills require a SKILL.md")
      )
    ).toBe("Deploy skill installation failed.");
  });

  it("uses a generic summary for unknown failures", () => {
    expect(deployTaskFailureSummary(new Error("very long stderr"))).toBe(
      "Deployment task failed."
    );
  });
});
