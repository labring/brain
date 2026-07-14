import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aggregateProjectStatuses,
  phaseToVisualTone,
} from "./project-aggregate-status";

test("phaseToVisualTone maps 'Running' to positive", () => {
  assert.equal(phaseToVisualTone("Running"), "positive");
});

test("phaseToVisualTone maps 'Succeeded' to positive", () => {
  assert.equal(phaseToVisualTone("Succeeded"), "positive");
});

test("phaseToVisualTone maps 'Ready' to positive", () => {
  assert.equal(phaseToVisualTone("Ready"), "positive");
});

test("phaseToVisualTone maps 'Available' to positive", () => {
  assert.equal(phaseToVisualTone("Available"), "positive");
});

test("phaseToVisualTone maps 'Bound' to positive", () => {
  assert.equal(phaseToVisualTone("Bound"), "positive");
});

test("phaseToVisualTone maps 'Pending' to progress", () => {
  assert.equal(phaseToVisualTone("Pending"), "progress");
});

test("phaseToVisualTone maps 'Creating' to progress", () => {
  assert.equal(phaseToVisualTone("Creating"), "progress");
});

test("phaseToVisualTone maps 'Progressing' to progress", () => {
  assert.equal(phaseToVisualTone("Progressing"), "progress");
});

test("phaseToVisualTone maps 'Binding' to progress", () => {
  assert.equal(phaseToVisualTone("Binding"), "progress");
});

test("phaseToVisualTone maps 'Restarting' to progress", () => {
  assert.equal(phaseToVisualTone("Restarting"), "progress");
});

test("phaseToVisualTone maps 'Starting' to progress", () => {
  assert.equal(phaseToVisualTone("Starting"), "progress");
});

test("phaseToVisualTone maps 'Stopping' to progress", () => {
  assert.equal(phaseToVisualTone("Stopping"), "progress");
});

test("phaseToVisualTone maps 'Updating' to progress", () => {
  assert.equal(phaseToVisualTone("Updating"), "progress");
});

test("phaseToVisualTone maps 'Unknown' to progress", () => {
  assert.equal(phaseToVisualTone("Unknown"), "progress");
});

test("phaseToVisualTone maps 'Paused' to neutral", () => {
  assert.equal(phaseToVisualTone("Paused"), "neutral");
});

test("phaseToVisualTone maps 'Stopped' to neutral", () => {
  assert.equal(phaseToVisualTone("Stopped"), "neutral");
});

test("phaseToVisualTone maps 'Shutdown' to neutral", () => {
  assert.equal(phaseToVisualTone("Shutdown"), "neutral");
});

test("phaseToVisualTone maps 'Failed' to negative", () => {
  assert.equal(phaseToVisualTone("Failed"), "negative");
});

test("phaseToVisualTone maps 'Error' to negative", () => {
  assert.equal(phaseToVisualTone("Error"), "negative");
});

test("phaseToVisualTone maps 'Degraded' to negative", () => {
  assert.equal(phaseToVisualTone("Degraded"), "negative");
});

test("phaseToVisualTone maps 'Deleting' to negative", () => {
  assert.equal(phaseToVisualTone("Deleting"), "negative");
});

test("phaseToVisualTone maps 'Unavailable' to negative", () => {
  assert.equal(phaseToVisualTone("Unavailable"), "negative");
});

test("phaseToVisualTone is case-insensitive (lowercase phase)", () => {
  assert.equal(phaseToVisualTone("running"), "positive");
});

test("phaseToVisualTone is case-insensitive (UPPER phase)", () => {
  assert.equal(phaseToVisualTone("FAILED"), "negative");
});

test("phaseToVisualTone is case-insensitive (mixed-case phase)", () => {
  assert.equal(phaseToVisualTone("CrEaTiNg"), "progress");
});

test("phaseToVisualTone trims surrounding whitespace", () => {
  assert.equal(phaseToVisualTone("  Running  "), "positive");
});

test("phaseToVisualTone maps unknown phases to neutral", () => {
  assert.equal(phaseToVisualTone("CrashLoopBackOff"), "neutral");
});

test("phaseToVisualTone maps empty string to neutral", () => {
  assert.equal(phaseToVisualTone(""), "neutral");
});

test("phaseToVisualTone maps whitespace-only string to neutral", () => {
  assert.equal(phaseToVisualTone("   "), "neutral");
});

test("phaseToVisualTone maps undefined to neutral", () => {
  assert.equal(phaseToVisualTone(undefined), "neutral");
});

test("aggregateProjectStatuses returns empty map for empty input", () => {
  const result = aggregateProjectStatuses([]);
  assert.equal(result.size, 0);
});

test("aggregateProjectStatuses maps a single Running workload to positive", () => {
  const result = aggregateProjectStatuses([
    { projectId: "p1", phase: "Running" },
  ]);
  assert.equal(result.size, 1);
  assert.equal(result.get("p1"), "positive");
});

test("aggregateProjectStatuses promotes positive + progress to progress", () => {
  const result = aggregateProjectStatuses([
    { projectId: "p1", phase: "Running" },
    { projectId: "p1", phase: "Creating" },
  ]);
  assert.equal(result.get("p1"), "progress");
});

test("aggregateProjectStatuses promotes any + negative to negative", () => {
  const result = aggregateProjectStatuses([
    { projectId: "p1", phase: "Running" },
    { projectId: "p1", phase: "Creating" },
    { projectId: "p1", phase: "Failed" },
  ]);
  assert.equal(result.get("p1"), "negative");
});

test("aggregateProjectStatuses treats a paused-only project as neutral", () => {
  const result = aggregateProjectStatuses([
    { projectId: "p1", phase: "Running", paused: true },
  ]);
  assert.equal(result.get("p1"), "neutral");
});

test("aggregateProjectStatuses: paused workload does not promote severity", () => {
  // A paused workload whose raw phase is "Failed" must not push the project to negative.
  const result = aggregateProjectStatuses([
    { projectId: "p1", phase: "Running" },
    { projectId: "p1", phase: "Failed", paused: true },
  ]);
  assert.equal(result.get("p1"), "positive");
});

test("aggregateProjectStatuses: 'Paused' phase string also reads as neutral", () => {
  // Direct product views may report `phase: "Paused"` directly; the phase-side
  // mapping already covers this (see phaseToVisualTone tests).
  const result = aggregateProjectStatuses([
    { projectId: "p1", phase: "Paused" },
    { projectId: "p1", phase: "Running" },
  ]);
  assert.equal(result.get("p1"), "positive");
});

test("aggregateProjectStatuses: unknown-phase-only project is neutral", () => {
  const result = aggregateProjectStatuses([
    { projectId: "p1", phase: "CrashLoopBackOff" },
  ]);
  assert.equal(result.get("p1"), "neutral");
});

test("aggregateProjectStatuses: unknown phase contributes as neutral alongside positive", () => {
  const result = aggregateProjectStatuses([
    { projectId: "p1", phase: "Running" },
    { projectId: "p1", phase: "CrashLoopBackOff" },
  ]);
  assert.equal(result.get("p1"), "positive");
});

test("aggregateProjectStatuses groups multiple projects independently", () => {
  const result = aggregateProjectStatuses([
    { projectId: "p1", phase: "Running" },
    { projectId: "p2", phase: "Failed" },
    { projectId: "p3", phase: "Creating" },
  ]);
  assert.equal(result.size, 3);
  assert.equal(result.get("p1"), "positive");
  assert.equal(result.get("p2"), "negative");
  assert.equal(result.get("p3"), "progress");
});

test("aggregateProjectStatuses groups same-projectId entries regardless of input order", () => {
  const a = aggregateProjectStatuses([
    { projectId: "p1", phase: "Running" },
    { projectId: "p2", phase: "Running" },
    { projectId: "p1", phase: "Failed" },
    { projectId: "p2", phase: "Creating" },
  ]);
  const b = aggregateProjectStatuses([
    { projectId: "p1", phase: "Failed" },
    { projectId: "p2", phase: "Creating" },
    { projectId: "p1", phase: "Running" },
    { projectId: "p2", phase: "Running" },
  ]);
  assert.equal(a.get("p1"), "negative");
  assert.equal(a.get("p2"), "progress");
  assert.equal(b.get("p1"), "negative");
  assert.equal(b.get("p2"), "progress");
});

test("aggregateProjectStatuses: severity tie-breaking is deterministic", () => {
  // Two positive workloads → still positive (tie produces same tone, not undefined).
  const result = aggregateProjectStatuses([
    { projectId: "p1", phase: "Running" },
    { projectId: "p1", phase: "Available" },
    { projectId: "p1", phase: "Bound" },
  ]);
  assert.equal(result.get("p1"), "positive");
});

test("aggregateProjectStatuses: only workloads listed contribute (no projectId → no entry)", () => {
  const result = aggregateProjectStatuses([
    { projectId: "p1", phase: "Running" },
  ]);
  assert.equal(result.has("p2"), false);
});
