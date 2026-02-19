import chalk from "chalk";
import { sshExec } from "./ssh.js";
import { loadConfig } from "./secrets.js";
import { redact } from "./dlp.js";

// Agent role color map
const ROLE_COLORS: Record<string, (text: string) => string> = {
  "Chief of Staff": chalk.bold.cyan,
  "VP Engineering": chalk.bold.blue,
  "VP Product": chalk.bold.magenta,
  "Senior Engineer": chalk.bold.green,
  "Engineer": chalk.green,
  "QA Lead": chalk.bold.yellow,
  "Security Engineer": chalk.bold.red,
  "DevOps Engineer": chalk.bold.hex("#FF8C00"),
  "default": chalk.bold.white,
};

export interface AgentEvent {
  id?: string;
  type: "agent_thinking" | "agent_response" | "task_delegated" | "agent_complete" | "error" | "heartbeat";
  agent?: string;
  role?: string;
  content?: string;
  target?: string;
  timestamp?: string;
}

function getColor(role?: string): (text: string) => string {
  if (!role) return ROLE_COLORS["default"];
  return ROLE_COLORS[role] || ROLE_COLORS["default"];
}

export function formatEvent(event: AgentEvent): string | null {
  const color = getColor(event.role);
  const prefix = event.role ? color(`  [${event.role}]`) : "";

  switch (event.type) {
    case "agent_thinking":
      return `${prefix} ${chalk.dim("thinking...")}`;
    case "agent_response":
      return `${prefix} ${redact(event.content ?? "")}`;
    case "task_delegated":
      return `${prefix} ${chalk.dim("→")} delegated to ${chalk.bold(event.target ?? "agent")}`;
    case "agent_complete":
      return `${prefix} ${chalk.green("✓")} ${chalk.dim("complete")}`;
    case "error":
      return `  ${chalk.red("✗")} ${redact(event.content ?? "Unknown error")}`;
    case "heartbeat":
      return null;
    default:
      return null;
  }
}

function parseSSEData(raw: string): AgentEvent[] {
  const events: AgentEvent[] = [];
  const blocks = raw.split("\n\n");
  for (const block of blocks) {
    if (!block.trim()) continue;
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("data: ")) {
        data += line.slice(6);
      }
    }
    if (data) {
      try {
        events.push(JSON.parse(data));
      } catch {
        // Skip malformed events
      }
    }
  }
  return events;
}

export class EventStream {
  private active = false;
  private lastId = "0";
  private onEvent: (event: AgentEvent) => void;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(onEvent: (event: AgentEvent) => void) {
    this.onEvent = onEvent;
  }

  async start(): Promise<void> {
    this.active = true;
    const config = loadConfig();
    if (!config) return;

    // Poll for events every 2 seconds via SSH
    this.pollInterval = setInterval(async () => {
      if (!this.active) return;
      try {
        const { stdout, code } = await sshExec(
          config.sshPort,
          `curl -sf -H 'Last-Event-ID: ${this.lastId}' http://localhost:4200/events?timeout=1 2>/dev/null || true`,
        );
        if (code === 0 && stdout.trim()) {
          const events = parseSSEData(stdout);
          for (const event of events) {
            if (event.id) this.lastId = event.id;
            this.onEvent(event);
          }
        }
      } catch {
        // Connection failed — silent retry
      }
    }, 2000);
  }

  stop(): void {
    this.active = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
