import { confirm, password } from "@inquirer/prompts";
import chalk from "chalk";
import { validateKeyValue, DlpViolation } from "../core/dlp.js";

export interface InitConfig {
  anthropicKey: string;
  openaiKey: string;
  googleKey: string;
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

  const enableTunnel = await confirm({
    message: "Enable Cloudflare tunnel for remote access?",
    default: true,
  });

  return {
    anthropicKey,
    openaiKey,
    googleKey,
    enableTunnel,
  };
}
