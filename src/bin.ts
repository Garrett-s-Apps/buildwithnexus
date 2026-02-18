import { cli } from "./cli.js";
import { checkForUpdates } from "./core/update-notifier.js";

checkForUpdates(cli.version() ?? "0.0.0");
cli.parse(process.argv);
