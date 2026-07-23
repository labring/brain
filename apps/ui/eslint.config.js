import { config } from "@workspace/eslint-config/base";

const eslintConfig = [
  ...config,
  {
    // Ratchet: pre-existing violations, tracked for burn-down. Re-enable each
    // rule (delete its line) once the app is clean under it; `bun lint` then
    // keeps it clean. Counts at time of writing: refs 58,
    // set-state-in-effect 46, purity 1 (the resource-snapshot grace clock,
    // entangled with that file's refs debt).
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
