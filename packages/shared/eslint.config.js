import { config } from "@workspace/eslint-config/base";

// Vendored upstream code (see src/vendor/*/VENDOR.md) is kept byte-identical and
// excluded from linting so re-syncs stay clean overwrites.
const eslintConfig = [...config, { ignores: ["src/vendor/**"] }];

export default eslintConfig;
