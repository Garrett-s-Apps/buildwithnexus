import chalk from "chalk";

export const log = {
  step(msg: string): void {
    console.log(chalk.cyan("  → ") + msg);
  },
  success(msg: string): void {
    console.log(chalk.green("  ✓ ") + msg);
  },
  error(msg: string): void {
    console.error(chalk.red("  ✗ ") + msg);
  },
  warn(msg: string): void {
    console.log(chalk.yellow("  ⚠ ") + msg);
  },
  dim(msg: string): void {
    console.log(chalk.dim("    " + msg));
  },
  detail(label: string, value: string): void {
    console.log(chalk.dim("    " + label + ": ") + value);
  },
  progress(current: number, total: number, label: string): void {
    const pct = Math.round((current / total) * 100);
    const filled = Math.round((current / total) * 20);
    const bar = chalk.cyan("█".repeat(filled)) + chalk.dim("░".repeat(20 - filled));
    process.stdout.write(`\r  [${bar}] ${chalk.bold(`${pct}%`)} ${chalk.dim(label)}`);
    if (current >= total) process.stdout.write("\n");
  },
};
