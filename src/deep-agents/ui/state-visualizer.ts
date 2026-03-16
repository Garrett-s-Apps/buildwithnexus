import chalk from "chalk";
import type { AgentExecutionState } from "./planning-repl.js";

export type TransitionStatus = "start" | "checkpoint" | "complete" | "error";

export interface StateTransition {
  from: string;
  to: string;
  status: TransitionStatus;
  timestampMs: number;
  durationMs?: number;
  notes?: string;
}

/**
 * StateVisualizer renders agent state transitions as a timeline
 * in the terminal.
 */
export class StateVisualizer {
  private transitions: StateTransition[] = [];
  private startMs = Date.now();

  /**
   * Record and display a state transition.
   */
  record(transition: StateTransition): void {
    this.transitions.push(transition);
    this.render(transition);
  }

  private render(t: StateTransition): void {
    const elapsed = ((t.timestampMs - this.startMs) / 1000).toFixed(1);
    const elapsedLabel = chalk.dim(`+${elapsed}s`);

    const icon = this.iconFor(t.status);
    const arrow = chalk.dim("→");
    const from = chalk.dim(t.from);
    const to = this.styleFor(t.status, t.to);

    let line = `  ${icon} ${elapsedLabel}  ${from} ${arrow} ${to}`;
    if (t.durationMs !== undefined) {
      line += chalk.dim(` (${(t.durationMs / 1000).toFixed(2)}s)`);
    }
    if (t.notes) {
      line += "  " + chalk.dim(t.notes);
    }
    console.log(line);
  }

  /**
   * Print the full transition history as a timeline.
   */
  displayTimeline(): void {
    console.log("\n" + chalk.bold("  State Timeline:"));
    console.log(chalk.dim("  " + "─".repeat(58)));
    for (const t of this.transitions) {
      this.render(t);
    }
    console.log(chalk.dim("  " + "─".repeat(58)));
  }

  /**
   * Display a compact status bar showing current agent state.
   */
  displayStatusBar(state: AgentExecutionState): void {
    const parts = [
      state.current_agent
        ? chalk.bold.cyan(state.current_agent)
        : chalk.dim("idle"),
      state.phase ? chalk.dim(`[${state.phase}]`) : "",
      chalk.dim(`${state.checkpoint_count} ckpt`),
      chalk.dim(`$${state.cost_usd.toFixed(4)}`),
    ].filter(Boolean);

    process.stdout.write(
      `\r  ${parts.join(chalk.dim("  |  "))}  `,
    );
  }

  private iconFor(status: TransitionStatus): string {
    switch (status) {
      case "start":
        return chalk.cyan("◎");
      case "checkpoint":
        return chalk.yellow("◈");
      case "complete":
        return chalk.green("✓");
      case "error":
        return chalk.red("✗");
    }
  }

  private styleFor(status: TransitionStatus, label: string): string {
    switch (status) {
      case "start":
        return chalk.bold(label);
      case "checkpoint":
        return chalk.yellow(label);
      case "complete":
        return chalk.green.bold(label);
      case "error":
        return chalk.red.bold(label);
    }
  }
}
