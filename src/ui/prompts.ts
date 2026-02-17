import { input, confirm, password } from "@inquirer/prompts";
import chalk from "chalk";

export interface InitConfig {
  anthropicKey: string;
  openaiKey: string;
  googleKey: string;
  vmRam: number;
  vmCpus: number;
  vmDisk: number;
  enableTunnel: boolean;
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

  return {
    anthropicKey,
    openaiKey,
    googleKey,
    vmRam,
    vmCpus,
    vmDisk,
    enableTunnel,
  };
}
