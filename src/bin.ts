#!/usr/bin/env node

import { program } from 'commander';
import { deepAgentsInitCommand } from './cli/init-command.js';
import { runCommand } from './cli/run-command.js';
import { dashboardCommand } from './cli/dashboard-command.js';
import { interactiveMode } from './cli/interactive.js';
import { installCommand } from './commands/install.js';
import { initCommand } from './commands/init.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { statusCommand } from './commands/status.js';
import { doctorCommand } from './commands/doctor.js';
import { logsCommand } from './commands/logs.js';
import { updateCommand } from './commands/update.js';
import { destroyCommand } from './commands/destroy.js';
import { keysCommand } from './commands/keys.js';
import { sshCommand } from './commands/ssh.js';
import { brainstormCommand } from './commands/brainstorm.js';
import { ninetyNineCommand } from './commands/ninety-nine.js';
import { shellCommand } from './commands/shell.js';
import { checkForUpdates } from './core/update-notifier.js';
import { MODELS } from './core/models.js';
import { resolvedVersion } from './core/version.js';
import { loadKeys } from './core/secrets.js';
import dotenv from 'dotenv';
import os from 'os';
import path from 'path';

// Load .env.local from home directory (legacy fallback)
const homeEnvPath = path.join(os.homedir(), '.env.local');
dotenv.config({ path: homeEnvPath });

// Load from ~/.buildwithnexus/.env.keys (written by da-init / init commands)
// Only set env vars that aren't already set (env > .env.local > .env.keys priority)
try {
  const storedKeys = loadKeys();
  if (storedKeys) {
    if (!process.env.ANTHROPIC_API_KEY && storedKeys.ANTHROPIC_API_KEY)
      process.env.ANTHROPIC_API_KEY = storedKeys.ANTHROPIC_API_KEY;
    if (!process.env.OPENAI_API_KEY && storedKeys.OPENAI_API_KEY)
      process.env.OPENAI_API_KEY = storedKeys.OPENAI_API_KEY;
    if (!process.env.GOOGLE_API_KEY && storedKeys.GOOGLE_API_KEY)
      process.env.GOOGLE_API_KEY = storedKeys.GOOGLE_API_KEY;
  }
} catch {
  // Keys file missing or tampered — run-command will surface a clear error
}

export const version = resolvedVersion;

checkForUpdates(version);

program
  .name('buildwithnexus')
  .description('Nexus - AI-Powered Task Execution')
  .version(version);

// Nexus init command (setup API keys)
program
  .command('da-init')
  .description('Initialize Nexus (set up API keys in ~/.buildwithnexus/.env.keys)')
  .action(deepAgentsInitCommand);

// Run command
program
  .command('run <task>')
  .description('Run a task with Nexus')
  .option('-a, --agent <name>', 'Agent role (engineer, researcher, etc)', 'engineer')
  .option('-g, --goal <goal>', 'Agent goal')
  .option('-m, --model <model>', 'LLM model', MODELS.DEFAULT)
  .action(runCommand);

// Dashboard command
program
  .command('dashboard')
  .description('Open the Nexus dashboard (served by the backend at /dashboard)')
  .action(dashboardCommand);

// Server command — runs in the foreground so Ctrl+C kills the Python process
program
  .command('server')
  .description('Start the Nexus backend server')
  .action(async () => {
    const { spawn } = await import('node:child_process');
    const os = await import('node:os');
    const path = await import('node:path');
    const chalk = (await import('chalk')).default;

    const nexusDir = process.env.NEXUS_BACKEND_DIR ?? path.join(os.homedir(), 'Projects', 'nexus');
    console.log(chalk.dim(`  Starting backend from ${nexusDir}...`));
    console.log(chalk.dim('  Press Ctrl+C to stop.\n'));

    const child = spawn('python3', ['-m', 'src.deep_agents_server'], {
      cwd: nexusDir,
      stdio: 'inherit',
      env: { ...process.env },
    });

    await new Promise<void>((resolve, reject) => {
      child.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          reject(new Error(`Backend exited with code ${code}`));
        } else {
          resolve();
        }
      });
      child.on('error', (err) => {
        reject(new Error(
          `Failed to start backend: ${err.message}\n` +
          `  Ensure Python 3 and NEXUS backend are at: ${nexusDir}\n` +
          `  Or set NEXUS_BACKEND_DIR to override the path.`
        ));
      });
    });
  });

// Status command
program
  .command('da-status')
  .description('Check Nexus backend status')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    const { getBackendUrl } = await import('./core/secrets.js');
    const backendUrl = getBackendUrl();
    const check = (ok: boolean) => (ok ? chalk.green('●') : chalk.red('○'));

    try {
      const res = await fetch(`${backendUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        console.log('');
        console.log(`  ${check(true)}  Backend    ${chalk.green('healthy')} ${chalk.dim(backendUrl)}`);
        console.log('');
        console.log(chalk.green('  NEXUS backend is running'));
      } else {
        console.log('');
        console.log(`  ${check(false)}  Backend    ${chalk.red(`not healthy (HTTP ${res.status})`)} ${chalk.dim(backendUrl)}`);
        console.log('');
        console.log(chalk.red('  Backend returned an error. Check logs: buildwithnexus logs'));
      }
    } catch {
      console.log('');
      console.log(`  ${check(false)}  Backend    ${chalk.red('offline')} ${chalk.dim(backendUrl)}`);
      console.log('');
      console.log(chalk.yellow('  Start backend with: buildwithnexus server'));
    }
  });

// Infrastructure commands (merged from legacy cli.ts)
program.addCommand(installCommand);
program.addCommand(initCommand);
program.addCommand(startCommand);
program.addCommand(stopCommand);
program.addCommand(statusCommand);
program.addCommand(doctorCommand);
program.addCommand(logsCommand);
program.addCommand(updateCommand);
program.addCommand(destroyCommand);
program.addCommand(keysCommand);
program.addCommand(sshCommand);
program.addCommand(brainstormCommand);
program.addCommand(ninetyNineCommand);
program.addCommand(shellCommand);

// Default: interactive mode when no command
if (!process.argv.slice(2).length) {
  interactiveMode().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  program.parse();
}
