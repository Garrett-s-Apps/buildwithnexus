import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf-8"));

export default defineConfig({
  entry: ["src/bin.ts", "src/deep-agents-bin.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  define: {
    __BUILDWITHNEXUS_VERSION__: JSON.stringify(packageJson.version),
  },
  // Don't bundle dependencies — they have CJS internals that break ESM bundling
  external: [
    "commander", "chalk", "ora", "inquirer", "@inquirer/prompts",
    "ejs", "execa", "node-ssh", "yaml", "dotenv",
  ],
  // ESM files don't use shebangs — npm handles executable setup via bin entry
  // Note: npm will make dist/bin.js executable in node_modules/.bin automatically
});
