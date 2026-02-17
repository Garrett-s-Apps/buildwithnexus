import { input, confirm, select, password } from "@inquirer/prompts";
import chalk from "chalk";

export interface InitConfig {
  anthropicKey: string;
  openaiKey: string;
  googleKey: string;
  slackBotToken: string;
  slackAppToken: string;
  slackChannel: string;
  vmRam: number;
  vmCpus: number;
  vmDisk: number;
  enableTunnel: boolean;
  nestingLevel: "standard" | "advanced";
}

export async function promptInitConfig(): Promise<InitConfig> {
  console.log(chalk.bold("\n  API Keys\n"));

  const anthropicKey = await password({
    message: "Anthropic API key (required):",
    mask: "*",
    validate: (val) => {
      if (!val) return "API key is required";
      if (!val.startsWith("sk-ant-")) return "Must start with sk-ant-";
      return true;
    },
  });

  const openaiKey = await password({
    message: "OpenAI API key (optional, press Enter to skip):",
    mask: "*",
  });

  const googleKey = await password({
    message: "Google AI API key (optional, press Enter to skip):",
    mask: "*",
  });

  console.log(chalk.bold("\n  Slack Integration (optional)\n"));

  const slackBotToken = await input({
    message: "Slack Bot Token (xoxb-..., Enter to skip):",
  });

  let slackAppToken = "";
  let slackChannel = "";
  if (slackBotToken) {
    slackAppToken = await input({
      message: "Slack App Token (xapp-...):",
    });
    slackChannel = await input({
      message: "Slack Channel ID:",
    });
  }

  console.log(chalk.bold("\n  VM Resources\n"));

  const vmRam = Number(
    await input({
      message: "VM RAM in GB:",
      default: "4",
      validate: (v) => (Number(v) >= 2 ? true : "Minimum 2GB"),
    })
  );

  const vmCpus = Number(
    await input({
      message: "VM CPUs:",
      default: "2",
      validate: (v) => (Number(v) >= 1 ? true : "Minimum 1 CPU"),
    })
  );

  const vmDisk = Number(
    await input({
      message: "VM Disk in GB:",
      default: "20",
      validate: (v) => (Number(v) >= 10 ? true : "Minimum 10GB"),
    })
  );

  console.log(chalk.bold("\n  Configuration\n"));

  const enableTunnel = await confirm({
    message: "Enable Cloudflare tunnel for remote access?",
    default: true,
  });

  const nestingLevel = await select({
    message: "Isolation level:",
    choices: [
      {
        name: "Standard (VM + Docker) — recommended",
        value: "standard" as const,
        description: "Two levels of isolation. Good security, ~80% native performance.",
      },
      {
        name: "Advanced (VM + Docker + inner KVM) — maximum isolation",
        value: "advanced" as const,
        description: "Triple nesting. Maximum isolation, 40-50% performance overhead.",
      },
    ],
  });

  return {
    anthropicKey,
    openaiKey,
    googleKey,
    slackBotToken,
    slackAppToken,
    slackChannel,
    vmRam,
    vmCpus,
    vmDisk,
    enableTunnel,
    nestingLevel,
  };
}
