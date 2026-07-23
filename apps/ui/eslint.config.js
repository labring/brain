import { config } from "@workspace/eslint-config/base";

const eslintConfig = [
  ...config,
  {
    // Ratchet: pre-existing violations, tracked for burn-down. Re-enable each
    // rule (delete its line) once the app is clean under it; `bun lint` then
    // keeps it clean. Counts at time of writing: refs 62,
    // set-state-in-effect 48, exhaustive-deps 18, immutability 6, purity 4,
    // preserve-manual-memoization 1, static-components 1.
    // Note: Biome's useExhaustiveDependencies still guards the deps-array
    // domain repo-wide while exhaustive-deps is off here.
    rules: {
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
    },
  },
];

export default eslintConfig;
