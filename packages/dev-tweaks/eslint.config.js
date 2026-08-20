import { config } from "@workspace/eslint-config/base";

// Vendored upstream code (see src/vendor/dialkit/VENDOR.md) is kept as
// upstream wrote it and excluded from linting so re-syncs stay clean overwrites.
const eslintConfig = [...config, { ignores: ["src/vendor/**"] }];

export default eslintConfig;
