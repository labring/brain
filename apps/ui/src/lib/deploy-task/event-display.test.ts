import { describe, expect, it } from "bun:test";

import {
  deployTaskDisplayEvents,
  summarizeDeployTaskError,
  summarizeDeployTaskText,
} from "./event-display";

describe("deploy task event display", () => {
  it("strips terminal control output and truncates long messages", () => {
    const text = summarizeDeployTaskText(
      `\u001b[?25l◐ Cloning repository...\u001b[999D\u001b[J${"A".repeat(180)}`
    );

    expect(text).not.toContain("\u001b");
    expect(text).not.toContain("[999D");
    expect(text?.length).toBeLessThanOrEqual(120);
    expect(text?.endsWith("…")).toBe(true);
  });

  it("keeps only useful recent deploy events", () => {
    const events = deployTaskDisplayEvents(
      [
        { message: "Preparing deploy runtime.", phase: "prepare", seq: 1 },
        { message: "\u001b[999D\u001b[J◐", phase: "prepare", seq: 2 },
        { message: "Repository clone is ready.", phase: "prepare", seq: 3 },
        { message: "Deployment workspace is ready.", phase: "prepare", seq: 4 },
        { message: "Codex gateway session is ready.", phase: "plan", seq: 5 },
      ],
      3
    );

    expect(events.map((event) => event.seq)).toEqual([3, 4, 5]);
  });

  it("summarizes long errors for compact chat cards", () => {
    const error = summarizeDeployTaskError("Build failed. ".repeat(40));

    expect(error?.length).toBeLessThanOrEqual(240);
    expect(error?.endsWith("…")).toBe(true);
  });
});
