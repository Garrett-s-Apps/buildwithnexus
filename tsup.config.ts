import { defineConfig } from "tsup";
import { writeFileSync, readFileSync, chmodSync } from "node:fs";

export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  // Don't bundle dependencies — they have CJS internals that break ESM bundling
  external: [
    "commander", "chalk", "ora", "inquirer", "@inquirer/prompts",
    "ejs", "execa", "node-ssh", "yaml",
  ],
  onSuccess: async () => {
    const file = "dist/bin.js";
    const content = readFileSync(file, "utf-8");
    writeFileSync(file, "#!/usr/bin/env node\n" + content);
    chmodSync(file, 0o755);
  },
});
