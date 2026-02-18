import chalk from "chalk";

const BANNER = `
  ╔══════════════════════════════════════════════╗
  ║       ${chalk.bold.cyan("B U I L D   W I T H   N E X U S")}        ║
  ║                                              ║
  ║   Autonomous AI Runtime · Nested Isolation   ║
  ╚══════════════════════════════════════════════╝
`;

export function showBanner(): void {
  console.log(BANNER);
  console.log(chalk.dim("  v0.2.1 · buildwithnexus.dev\n"));
}

export function showPhase(phase: number, total: number, description: string): void {
  const progress = chalk.cyan(`[${phase}/${total}]`);
  console.log(`\n${progress} ${chalk.bold(description)}`);
}

export function showCompletion(urls: { remote?: string; ssh: string }): void {
  const lines = [
    "",
    chalk.green("  ╔══════════════════════════════════════════════════════════╗"),
    chalk.green("  ║  ") + chalk.bold.green("NEXUS Runtime is Live!") + chalk.green("                                 ║"),
    chalk.green("  ╠══════════════════════════════════════════════════════════╣"),
    chalk.green("  ║  ") + chalk.white(`Connect:    ${urls.ssh}`.padEnd(55)) + chalk.green("║"),
  ];
  if (urls.remote) {
    lines.push(chalk.green("  ║  ") + chalk.white(`Remote:     ${urls.remote}`.padEnd(55)) + chalk.green("║"));
  }
  lines.push(
    chalk.green("  ╠══════════════════════════════════════════════════════════╣"),
    chalk.green("  ║  ") + chalk.dim("Commands:".padEnd(55)) + chalk.green("║"),
    chalk.green("  ║  ") + chalk.white("  buildwithnexus ssh       - Open CLI".padEnd(55)) + chalk.green("║"),
    chalk.green("  ║  ") + chalk.white("  buildwithnexus status    - Check health".padEnd(55)) + chalk.green("║"),
    chalk.green("  ║  ") + chalk.white("  buildwithnexus logs      - View logs".padEnd(55)) + chalk.green("║"),
    chalk.green("  ║  ") + chalk.white("  buildwithnexus stop      - Shutdown".padEnd(55)) + chalk.green("║"),
    chalk.green("  ║  ") + chalk.white("  buildwithnexus start     - Restart".padEnd(55)) + chalk.green("║"),
    chalk.green("  ║  ") + chalk.white("  buildwithnexus update    - Update release".padEnd(55)) + chalk.green("║"),
    chalk.green("  ║  ") + chalk.white("  buildwithnexus brainstorm - Brainstorm ideas".padEnd(55)) + chalk.green("║"),
    chalk.green("  ║  ") + chalk.white("  buildwithnexus destroy   - Remove all".padEnd(55)) + chalk.green("║"),
    chalk.green("  ╚══════════════════════════════════════════════════════════╝"),
    "",
  );
  console.log(lines.join("\n"));
}
