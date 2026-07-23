import { config } from "@workspace/eslint-config/base";

const eslintConfig = [
  ...config,
  {
    // Ratchet: pre-existing violations, tracked for burn-down. Re-enable each
    // rule (delete its line) once the app is clean under it; `bun lint` then
    // keeps it clean. Counts at time of writing: refs 33, set-state-in-effect 2,
    // purity 1 — all 36 in project-canvas/snapshot/use-project-canvas-resource-
    // snapshot.ts, which needs a whole-file refactor (grace clock + accumulator
    // refs into an external store).
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
