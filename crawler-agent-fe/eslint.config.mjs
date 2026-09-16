import { fileURLToPath } from "node:url"

import nextCoreWebVitals from "eslint-config-next/core-web-vitals"
import prettier from "eslint-config-prettier"
import tailwindcss from "eslint-plugin-tailwindcss"

// eslint-plugin-tailwindcss resolves `tailwindcss` relative to this path's
// directory, so it has to be absolute rather than "tailwind.config.js".
const tailwindConfig = fileURLToPath(
  new URL("./tailwind.config.js", import.meta.url)
)

const config = [
  // Replaces .eslintignore, which ESLint 9 no longer reads.
  {
    ignores: [
      "dist/*",
      ".cache",
      ".next/**",
      "public",
      "node_modules",
      "**/*.esm.js",
    ],
  },
  ...nextCoreWebVitals,
  ...tailwindcss.configs["flat/recommended"],
  prettier,
  {
    settings: {
      tailwindcss: {
        callees: ["cn"],
        config: tailwindConfig,
      },
      next: {
        rootDir: ["./"],
      },
    },
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "react/jsx-key": "off",
      "tailwindcss/no-custom-classname": "off",
    },
  },
]

export default config
