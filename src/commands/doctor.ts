import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs";
import { log } from "../ui/logger.js";
import { detectPlatform } from "../core/platform.js";
import { isQemuInstalled } from "../core/qemu.js";
import { NEXUS_HOME, loadConfig } from "../core/secrets.js";
import path from "node:path";
import { execa } from "execa";

export const doctorCommand = new Command("doctor")
  .description("Diagnose NEXUS runtime environment")
  .action(async () => {
    const platform = detectPlatform();
    const check = (ok: boolean) => ok ? chalk.green("✓") : chalk.red("✗");

    console.log("");
    console.log(chalk.bold("  NEXUS Doctor"));
    console.log("");

    // Node version
    const nodeOk = Number(process.versions.node.split(".")[0]) >= 18;
    console.log(`  ${check(nodeOk)}  Node.js ${process.versions.node} ${nodeOk ? "" : chalk.red("(need >= 18)")}`);

    // Platform
    console.log(`  ${check(true)}  Platform: ${platform.os} ${platform.arch}`);

    // QEMU
    const qemuOk = await isQemuInstalled(platform);
    if (qemuOk) {
      const { stdout } = await execa(platform.qemuBinary, ["--version"]);
      console.log(`  ${check(true)}  ${stdout.split("\n")[0]}`);
    } else {
      console.log(`  ${check(false)}  QEMU not installed`);
    }

    // mkisofs / genisoimage
    let isoTool = false;
    try { await execa("mkisofs", ["--version"]); isoTool = true; } catch { /* */ }
    if (!isoTool) try { await execa("genisoimage", ["--version"]); isoTool = true; } catch { /* */ }
    console.log(`  ${check(isoTool)}  ISO tool (mkisofs/genisoimage)`);

    // SSH key
    const keyExists = fs.existsSync(path.join(NEXUS_HOME, "ssh", "id_nexus_vm"));
    console.log(`  ${check(keyExists)}  SSH key`);

    // Config
    const config = loadConfig();
    console.log(`  ${check(!!config)}  Configuration`);

    // Disk
    const diskExists = fs.existsSync(path.join(NEXUS_HOME, "vm", "images", "nexus-vm-disk.qcow2"));
    console.log(`  ${check(diskExists)}  VM disk image`);

    // Port availability
    if (config) {
      for (const [name, port] of [["SSH", config.sshPort], ["HTTP", config.httpPort], ["HTTPS", config.httpsPort]] as const) {
        try {
          const net = await import("node:net");
          const available = await new Promise<boolean>((resolve) => {
            const server = net.createServer();
            server.once("error", () => resolve(false));
            server.once("listening", () => { server.close(); resolve(true); });
            server.listen(port);
          });
          console.log(`  ${check(available)}  Port ${port} (${name}) ${available ? "available" : chalk.red("in use")}`);
        } catch {
          console.log(`  ${check(false)}  Port ${port} (${name}) — check failed`);
        }
      }
    }

    // BIOS file
    const biosOk = fs.existsSync(platform.biosPath);
    console.log(`  ${check(biosOk)}  UEFI firmware ${biosOk ? "" : chalk.dim(platform.biosPath)}`);

    console.log("");
    if (qemuOk && isoTool && biosOk) {
      log.success("Environment ready for NEXUS");
    } else {
      log.warn("Some prerequisites missing — fix the items marked ✗ above");
    }
  });
