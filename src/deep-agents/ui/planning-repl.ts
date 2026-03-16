import readline from "node:readline";
import chalk from "chalk";

export interface Todo {
  title: string;
  description: string;
  status: "pending" | "in_progress" | "done";
  durationSeconds?: number;
  toolCallCount?: number;
}

export interface AgentExecutionState {
  wall_clock_seconds: number;
  cost_usd: number;
  tokens_used: number;
  checkpoint_count: number;
  current_agent?: string;
  phase?: string;
}

export class PlanningREPL {
  private rl: readline.Interface;
  private currentPlan: Todo[] = [];
  private agentState: AgentExecutionState | null = null;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /**
   * Display the current plan state:
   * [x] Task 1 - completed in 2m 15s
   * [>] Task 2 - in progress (2 tool calls)
   * [ ] Task 3 - pending
   */
  displayPlan(plan: Todo[]): void {
    this.currentPlan = plan;
    console.log("\n" + chalk.bold("  Current Plan:"));
    console.log(chalk.dim("  " + "─".repeat(58)));

    plan.forEach((todo, idx) => {
      const icon =
        todo.status === "done"
          ? chalk.green("✓")
          : todo.status === "in_progress"
            ? chalk.cyan("⚙")
            : chalk.dim("○");

      const num = chalk.dim(`[${idx + 1}]`);
      const title =
        todo.status === "done"
          ? chalk.dim(todo.title)
          : todo.status === "in_progress"
            ? chalk.bold(todo.title)
            : todo.title;

      let meta = "";
      if (todo.status === "done" && todo.durationSeconds !== undefined) {
        const m = Math.floor(todo.durationSeconds / 60);
        const s = todo.durationSeconds % 60;
        meta = chalk.dim(` — ${m > 0 ? `${m}m ` : ""}${s}s`);
      } else if (
        todo.status === "in_progress" &&
        todo.toolCallCount !== undefined
      ) {
        meta = chalk.dim(` (${todo.toolCallCount} tool calls)`);
      } else if (todo.status === "pending") {
        const prevIdx = idx - 1;
        if (prevIdx >= 0 && plan[prevIdx].status !== "done") {
          meta = chalk.dim(` — waiting for task ${prevIdx + 1}`);
        }
      }

      console.log(`  ${icon} ${num} ${title}${meta}`);
      console.log(chalk.dim(`        ${todo.description}`));
    });

    console.log(chalk.dim("  " + "─".repeat(58)));
  }

  /**
   * Display ReAct-style agent execution:
   * Thought: I need to research the market
   * Action: search[market research 2025]
   * Observation: Market size is $500B
   */
  displayReAct(
    message: string,
    type: "thought" | "action" | "observation",
  ): void {
    const styles: Record<typeof type, (s: string) => string> = {
      thought: (s) => chalk.magenta(s),
      action: (s) => chalk.cyan(s),
      observation: (s) => chalk.yellow(s),
    };
    const icons = { thought: "Thought", action: "Action", observation: "Obs" };
    const label = styles[type](icons[type].padEnd(11));
    console.log(`  ${label} ${message}`);
  }

  /**
   * Write a streaming token directly to stdout without a newline.
   */
  streamToken(token: string): void {
    process.stdout.write(token);
  }

  /**
   * Pause execution and prompt for human input.
   */
  pauseForInput(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(
        `\n${chalk.yellow("  Paused")} ${chalk.dim("—")} ${prompt}\n${chalk.bold.cyan("  >")} `,
        resolve,
      );
    });
  }

  /**
   * Display execution metrics summary.
   */
  displayMetrics(state: AgentExecutionState): void {
    this.agentState = state;
    const m = Math.floor(state.wall_clock_seconds / 60);
    const s = state.wall_clock_seconds % 60;
    const elapsed = m > 0 ? `${m}m ${s}s` : `${s}s`;

    console.log("\n" + chalk.bold("  Metrics:"));
    console.log(
      chalk.dim("    Wall clock  ") + chalk.bold(elapsed),
    );
    console.log(
      chalk.dim("    Cost        ") + chalk.bold(`$${state.cost_usd.toFixed(4)}`),
    );
    console.log(
      chalk.dim("    Tokens      ") + chalk.bold(state.tokens_used.toLocaleString()),
    );
    console.log(
      chalk.dim("    Checkpoints ") + chalk.bold(state.checkpoint_count),
    );
    if (state.current_agent) {
      console.log(
        chalk.dim("    Agent       ") + chalk.bold(state.current_agent),
      );
    }
  }

  close(): void {
    this.rl.close();
  }
}
