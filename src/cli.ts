import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installCommand } from "./commands/install.js";
import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { statusCommand } from "./commands/status.js";
import { doctorCommand } from "./commands/doctor.js";
import { logsCommand } from "./commands/logs.js";
import { updateCommand } from "./commands/update.js";
import { destroyCommand } from "./commands/destroy.js";
import { keysCommand } from "./commands/keys.js";
import { sshCommand } from "./commands/ssh.js";
import { brainstormCommand } from "./commands/brainstorm.js";
import { ninetyNineCommand } from "./commands/ninety-nine.js";
import { shellCommand } from "./commands/shell.js";

function getVersionStatic(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const packagePath = join(__dirname, "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf-8"));
    return packageJson.version;
  } catch {
    return typeof __BUILDWITHNEXUS_VERSION__ !== "undefined" ? __BUILDWITHNEXUS_VERSION__ : "0.0.0-unknown";
  }
}

export const cli = new Command()
  .name("buildwithnexus")
  .description("Auto-scaffold and launch a fully autonomous NEXUS runtime")
  .version(getVersionStatic());

cli.addCommand(installCommand);
cli.addCommand(initCommand);
cli.addCommand(startCommand);
cli.addCommand(stopCommand);
cli.addCommand(statusCommand);
cli.addCommand(doctorCommand);
cli.addCommand(logsCommand);
cli.addCommand(updateCommand);
cli.addCommand(destroyCommand);
cli.addCommand(keysCommand);
cli.addCommand(sshCommand);
cli.addCommand(brainstormCommand);
cli.addCommand(ninetyNineCommand);
cli.addCommand(shellCommand);

// Default action: show help
cli.action(() => {
  cli.help();
});
