import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // Forbid process.env reads outside runtime/env.ts (Wave B.3 audit rule).
  {
    files: ["src/**/*.ts"],
    ignores: ["src/runtime/env.ts", "src/__tests__/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Do not read process.env outside runtime/env.ts. Inject env via RuntimeContext.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*"],
              message:
                "@lyre/api must stay framework-agnostic — no Next imports.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores(["dist/**", "node_modules/**"]),
]);
