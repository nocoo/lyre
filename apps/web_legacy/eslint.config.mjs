import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Contracts boundary (Wave B.1, docs/03 决策点 7):
  // UI components / pages / hooks must not import server-only @lyre/api code.
  // Routes (src/app/api/**) keep full access; server services stay free too.
  {
    files: [
      "src/components/**/*.{ts,tsx}",
      "src/hooks/**/*.{ts,tsx}",
      "src/app/(app)/**/*.{ts,tsx}",
      "src/app/login/**/*.{ts,tsx}",
      "src/app/layout.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@lyre/api/services/**", "@lyre/api/handlers/**", "@lyre/api/db/**"],
              message:
                "UI may only import @lyre/api/contracts/* — server modules are off-limits.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    ".next-e2e/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
