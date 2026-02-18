import { input, confirm, password } from "@inquirer/prompts";
import chalk from "chalk";
import { validateKeyValue, DlpViolation } from "../core/dlp.js";

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
      try {
        validateKeyValue("ANTHROPIC_API_KEY", val);
      } catch (err) {
        if (err instanceof DlpViolation) return err.message;
      }
      return true;
    },
  });

  const openaiKey = await password({
    message: "OpenAI API key (optional, press Enter to skip):",
    mask: "*",
    validate: (val) => {
      if (!val) return true;
      try { validateKeyValue("OPENAI_API_KEY", val); } catch (err) {
        if (err instanceof DlpViolation) return err.message;
      }
      return true;
    },
  });

  const googleKey = await password({
    message: "Google AI API key (optional, press Enter to skip):",
    mask: "*",
    validate: (val) => {
      if (!val) return true;
      try { validateKeyValue("GOOGLE_API_KEY", val); } catch (err) {
        if (err instanceof DlpViolation) return err.message;
      }
      return true;
    },
  });

  console.log(chalk.bold("\n  VM Resources\n"));

  const vmRam = Number(
    await input({
      message: "VM RAM in GB:",
      default: "4",
      validate: (v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 2 || n > 256) return "Must be a whole number between 2 and 256";
        return true;
      },
    })
  );

  const vmCpus = Number(
    await input({
      message: "VM CPUs:",
      default: "2",
      validate: (v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 64) return "Must be a whole number between 1 and 64";
        return true;
      },
    })
  );

  const vmDisk = Number(
    await input({
      message: "VM Disk in GB:",
      default: "20",
      validate: (v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 10 || n > 2048) return "Must be a whole number between 10 and 2048";
        return true;
      },
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
