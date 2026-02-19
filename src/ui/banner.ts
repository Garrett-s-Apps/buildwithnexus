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
  console.log(chalk.dim("  v0.2.8 · buildwithnexus.dev\n"));
}

export function showPhase(phase: number, total: number, description: string): void {
  const progress = chalk.cyan(`[${phase}/${total}]`);
  console.log(`\n${progress} ${chalk.bold(description)}`);
}

export function showSecurityPosture(): void {
  const lines = [
    "",
    chalk.bold("  ╔══════════════════════════════════════════════════════════╗"),
    chalk.bold("  ║  ") + chalk.bold.green("Security Posture") + chalk.bold("                                        ║"),
    chalk.bold("  ╠══════════════════════════════════════════════════════════╣"),
    chalk.bold("  ║  ") + chalk.green("✓") + chalk.white(" Triple-nested isolation: Host → VM → Docker → KVM".padEnd(54)) + chalk.bold("║"),
    chalk.bold("  ║  ") + chalk.green("✓") + chalk.white(" Network hardened: UFW deny-all, allow 22/80/443/4200".padEnd(54)) + chalk.bold("║"),
    chalk.bold("  ║  ") + chalk.green("✓") + chalk.white(" All databases encrypted at rest (AES-256-CBC)".padEnd(54)) + chalk.bold("║"),
    chalk.bold("  ║  ") + chalk.green("✓") + chalk.white(" API keys never embedded in VM — delivered via SCP".padEnd(54)) + chalk.bold("║"),
    chalk.bold("  ║  ") + chalk.green("✓") + chalk.white(" SSH-only communication (no exposed network ports)".padEnd(54)) + chalk.bold("║"),
    chalk.bold("  ║  ") + chalk.green("✓") + chalk.white(" DLP: secret detection, shell escaping, output redaction".padEnd(54)) + chalk.bold("║"),
    chalk.bold("  ║  ") + chalk.green("✓") + chalk.white(" HMAC integrity verification on all key files".padEnd(54)) + chalk.bold("║"),
    chalk.bold("  ║  ") + chalk.green("✓") + chalk.white(" Docker: --read-only, no-new-privileges, cap-drop=ALL".padEnd(54)) + chalk.bold("║"),
    chalk.bold("  ╠══════════════════════════════════════════════════════════╣"),
    chalk.bold("  ║  ") + chalk.dim("Full details: https://buildwithnexus.dev/security".padEnd(55)) + chalk.bold("║"),
    chalk.bold("  ╚══════════════════════════════════════════════════════════╝"),
    "",
  ];
  console.log(lines.join("\n"));
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
    chalk.green("  ║  ") + chalk.dim("Quick Start:".padEnd(55)) + chalk.green("║"),
    chalk.green("  ║  ") + chalk.white("  buildwithnexus           - Interactive shell".padEnd(55)) + chalk.green("║"),
    chalk.green("  ║  ") + chalk.white("  buildwithnexus brainstorm - Brainstorm ideas".padEnd(55)) + chalk.green("║"),
    chalk.green("  ║  ") + chalk.white("  buildwithnexus status    - Check health".padEnd(55)) + chalk.green("║"),
    chalk.green("  ╠══════════════════════════════════════════════════════════╣"),
    chalk.green("  ║  ") + chalk.dim("All commands:".padEnd(55)) + chalk.green("║"),
    chalk.green("  ║  ") + chalk.white("  buildwithnexus stop/start/update/logs/ssh/destroy".padEnd(55)) + chalk.green("║"),
    chalk.green("  ╚══════════════════════════════════════════════════════════╝"),
    "",
  );
  console.log(lines.join("\n"));
}
