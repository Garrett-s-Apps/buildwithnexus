import { Command } from "commander";
import { password } from "@inquirer/prompts";
import chalk from "chalk";
import { log } from "../ui/logger.js";
import { loadKeys, saveKeys, maskKey } from "../core/secrets.js";
import { validateKeyValue, DlpViolation, audit } from "../core/dlp.js";

export const keysCommand = new Command("keys")
  .description("Manage API keys");

keysCommand
  .command("list")
  .description("Show configured API keys (masked)")
  .action(() => {
    const keys = loadKeys();
    if (!keys) {
      log.error("No keys configured. Run: buildwithnexus init");
      process.exit(1);
    }

    console.log(chalk.bold("\n  Configured Keys\n"));
    for (const [name, value] of Object.entries(keys)) {
      if (value) {
        console.log(`  ${chalk.cyan(name.padEnd(24))} ${maskKey(value)}`);
      }
    }
    console.log("");
  });

keysCommand
  .command("set <key>")
  .description("Set or update an API key (e.g. ANTHROPIC_API_KEY)")
  .action(async (keyName: string) => {
    const keys = loadKeys();
    if (!keys) {
      log.error("No keys configured. Run: buildwithnexus init");
      process.exit(1);
    }

    const validKeys = [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GOOGLE_API_KEY",
      "NEXUS_MASTER_SECRET",
    ];

    const upper = keyName.toUpperCase();
    if (!validKeys.includes(upper)) {
      log.error(`Unknown key: ${keyName}`);
      log.dim(`Valid keys: ${validKeys.join(", ")}`);
      process.exit(1);
    }

    const value = await password({ message: `Enter value for ${upper}:`, mask: "*" });

    if (!value) {
      log.warn("Empty value — key not changed");
      return;
    }

    try {
      validateKeyValue(upper, value);
    } catch (err) {
      if (err instanceof DlpViolation) {
        log.error(err.message);
        process.exit(1);
      }
      throw err;
    }

    (keys as unknown as Record<string, string>)[upper] = value;
    saveKeys(keys);
    audit("keys_saved", `${upper} updated via CLI`);
    log.success(`${upper} updated`);
    log.warn("Restart the runtime for changes to take effect: buildwithnexus stop && buildwithnexus start");
  });
