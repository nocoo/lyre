import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        fetch: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearInterval: "readonly",
        setInterval: "readonly",
        EventSource: "readonly",
        KeyboardEvent: "readonly",
        Event: "readonly",
        URLSearchParams: "readonly",
        AbortController: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          // Forbid Next.js / NextAuth / next-themes anywhere in the SPA.
          patterns: [
            "next",
            "next/*",
            "next-auth",
            "next-auth/*",
            "next-themes",
            "@auth/*",
            // Server-only @lyre/api subpaths must not leak into the browser bundle.
            // Browser-safe subpaths (`@lyre/api/contracts/*`, `@lyre/api/lib/*`) are allowed.
            "@lyre/api/services/*",
            "@lyre/api/handlers/*",
            "@lyre/api/runtime",
            "@lyre/api/db/*",
          ],
        },
      ],
    },
  },
);
