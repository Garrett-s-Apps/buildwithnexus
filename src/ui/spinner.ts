import ora, { type Ora } from "ora";
import chalk from "chalk";

export function createSpinner(text: string): Ora {
  return ora({ text, color: "cyan", spinner: "dots" });
}

export function succeed(spinner: Ora, text: string): void {
  spinner.succeed(chalk.green(text));
}

export function fail(spinner: Ora, text: string): void {
  spinner.fail(chalk.red(text));
}

export function info(text: string): void {
  ora().info(chalk.blue(text));
}

export function warn(text: string): void {
  ora().warn(chalk.yellow(text));
}
