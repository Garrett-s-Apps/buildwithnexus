import { Command } from "commander";
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

export const cli = new Command()
  .name("buildwithnexus")
  .description("Auto-scaffold and launch a fully autonomous NEXUS runtime")
  .version("0.3.1");

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

// Default action: launch interactive shell if configured, else show help
cli.action(async () => {
  try {
    const { loadConfig } = await import("./core/secrets.js");
    const { isVmRunning } = await import("./core/qemu.js");
    const config = loadConfig();
    if (config && isVmRunning()) {
      await shellCommand.parseAsync([], { from: "user" });
      return;
    }
  } catch {
    // Fall through to help
  }
  cli.help();
});
