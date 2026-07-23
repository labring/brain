import reactHooks from "eslint-plugin-react-hooks";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";

/**
 * Shared ESLint configuration for the repository.
 *
 * Biome (`bun check`) is the source of truth for style and general lint;
 * ESLint is scoped to what Biome cannot cover: the official react-hooks
 * rules (React Compiler-derived analysis) and turbo's env-var check.
 * Run with `--max-warnings 0` so any finding fails the task.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const config = [
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      sourceType: "module",
    },
    plugins: {
      "react-hooks": reactHooks,
      turbo: turboPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "turbo/no-undeclared-env-vars": "error",
    },
  },
  {
    // .next* also matches the NEXT_DIST_DIR preview dist dirs (.next-preview).
    ignores: [
      "**/dist/**",
      "**/.next*/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/node_modules/**",
    ],
  },
];
