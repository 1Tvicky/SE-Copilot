import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

const eslintConfig = [
  ...nextCoreWebVitals,
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "playwright-report/**", "test-results/**"],
  },
];

export default eslintConfig;
