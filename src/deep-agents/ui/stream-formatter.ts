import chalk from "chalk";

export type StreamEventType =
  | "text"
  | "tool_use"
  | "tool_result"
  | "thinking"
  | "error"
  | "agent_switch";

export interface StreamEvent {
  type: StreamEventType;
  content: string;
  agentName?: string;
  toolName?: string;
  elapsed?: number;
}

/**
 * StreamFormatter renders agent output events to the terminal with
 * consistent formatting and color coding.
 */
export class StreamFormatter {
  private currentAgent: string | null = null;
  private lineBuffer = "";

  /**
   * Render a single stream event to stdout.
   */
  format(event: StreamEvent): void {
    switch (event.type) {
      case "text":
        this.renderText(event.content);
        break;
      case "tool_use":
        this.flushLine();
        this.renderToolUse(event.toolName ?? "unknown", event.content);
        break;
      case "tool_result":
        this.renderToolResult(event.content);
        break;
      case "thinking":
        this.flushLine();
        this.renderThinking(event.content);
        break;
      case "error":
        this.flushLine();
        this.renderError(event.content);
        break;
      case "agent_switch":
        this.flushLine();
        this.renderAgentSwitch(event.agentName ?? "unknown");
        break;
    }
  }

  /**
   * Write a raw token directly without classification.
   */
  token(t: string): void {
    process.stdout.write(t);
    this.lineBuffer += t;
    if (t.includes("\n")) this.lineBuffer = "";
  }

  /**
   * Flush any buffered partial line.
   */
  flushLine(): void {
    if (this.lineBuffer.length > 0) {
      process.stdout.write("\n");
      this.lineBuffer = "";
    }
  }

  private renderText(content: string): void {
    process.stdout.write(content);
    this.lineBuffer += content;
    if (content.includes("\n")) this.lineBuffer = "";
  }

  private renderToolUse(toolName: string, input: string): void {
    console.log(
      `\n  ${chalk.cyan("Tool")} ${chalk.bold(toolName)} ${chalk.dim(this.truncate(input, 80))}`,
    );
  }

  private renderToolResult(content: string): void {
    const lines = content.split("\n").slice(0, 6);
    for (const line of lines) {
      console.log(chalk.dim("    " + this.truncate(line, 100)));
    }
    if (content.split("\n").length > 6) {
      console.log(chalk.dim("    ..."));
    }
  }

  private renderThinking(content: string): void {
    console.log(chalk.dim("  [thinking] ") + chalk.dim(this.truncate(content, 120)));
  }

  private renderError(content: string): void {
    console.log(chalk.red("  Error: ") + content);
  }

  private renderAgentSwitch(agentName: string): void {
    if (agentName === this.currentAgent) return;
    this.currentAgent = agentName;
    console.log(
      "\n" +
        chalk.bold.cyan("  Agent ") +
        chalk.bold(agentName) +
        chalk.dim(" ─────────────────────────────────────────"),
    );
  }

  private truncate(s: string, maxLen: number): string {
    return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
  }
}
