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

export const cli = new Command()
  .name("buildwithnexus")
  .description("Auto-scaffold and launch a fully autonomous NEXUS runtime")
  .version("0.2.0");

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

// Default action: show help
cli.action(() => {
  cli.help();
});
