import { config } from "@workspace/eslint-config/base";

const eslintConfig = [
  ...config,
  {
    // Ratchet: pre-existing violations, tracked for burn-down. Re-enable each
    // rule (delete its line) once the app is clean under it; `bun lint` then
    // keeps it clean. Counts at time of writing: set-state-in-effect 5,
    // static-components 1.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
    },
  },
];

export default eslintConfig;
