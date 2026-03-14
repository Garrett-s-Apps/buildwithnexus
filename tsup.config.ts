import { defineConfig } from "tsup";
import { writeFileSync, readFileSync, chmodSync, mkdirSync, copyFileSync } from "node:fs";
import { readFileSync as readSync } from "node:fs";

const packageJson = JSON.parse(readSync("package.json", "utf-8"));

export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: false,  // Preserve tarball across builds; remove JS manually in onSuccess if needed
  splitting: false,
  sourcemap: false,
  dts: false,
  define: {
    __BUILDWITHNEXUS_VERSION__: JSON.stringify(packageJson.version),
  },
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

    // Copy non-TS assets that init needs at runtime
    mkdirSync("dist/templates", { recursive: true });
    copyFileSync("src/templates/cloud-init.yaml.ejs", "dist/templates/cloud-init.yaml.ejs");

    // Warn if tarball is missing (it's critical for 'buildwithnexus init')
    const tarballPath = "dist/nexus-release.tar.gz";
    try {
      readFileSync(tarballPath);
    } catch {
      console.warn(`\n⚠️  WARNING: ${tarballPath} not found. Run: npm run bundle\n`);
    }
  },
});
