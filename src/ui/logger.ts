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
};
