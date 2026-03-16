import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { agentTemplates } from "./agent-templates.js";

export interface AgentDefinition {
  name: string;
  role: string;
  goal: string;
  backstory: string;
  tools: string[];
  model?: string;
  temperature?: number;
}

export class AgentLoader {
  private configDir: string;

  constructor(configDir?: string) {
    this.configDir =
      configDir ?? path.join(os.homedir(), ".buildwithnexus", "agents");
  }

  loadFromYAML(filePath: string): AgentDefinition {
    const content = fs.readFileSync(filePath, "utf-8");
    return parseYaml(content) as AgentDefinition;
  }

  loadAllAgents(): AgentDefinition[] {
    if (!fs.existsSync(this.configDir)) {
      return this.getDefaultAgents();
    }

    const agents: AgentDefinition[] = [];
    const files = fs.readdirSync(this.configDir);

    for (const file of files) {
      if (file.endsWith(".yaml") || file.endsWith(".yml")) {
        try {
          const agent = this.loadFromYAML(path.join(this.configDir, file));
          agents.push(agent);
        } catch {
          // Skip malformed agent files
        }
      }
    }

    return agents.length > 0 ? agents : this.getDefaultAgents();
  }

  getDefaultAgents(): AgentDefinition[] {
    return agentTemplates;
  }

  saveAgent(agent: AgentDefinition): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }

    const filePath = path.join(this.configDir, `${agent.name}.yaml`);
    fs.writeFileSync(filePath, stringifyYaml(agent), { encoding: "utf-8" });
  }

  deleteAgent(name: string): boolean {
    const filePath = path.join(this.configDir, `${name}.yaml`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }
}
