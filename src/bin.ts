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
import dotenv from 'dotenv';
import os from 'os';
import path from 'path';
import pkg from '../package.json' assert { type: 'json' };

// Load .env.local from home directory (works from any working directory)
const homeEnvPath = path.join(os.homedir(), '.env.local');
dotenv.config({ path: homeEnvPath });

export const version = typeof __BUILDWITHNEXUS_VERSION__ !== 'undefined'
  ? __BUILDWITHNEXUS_VERSION__
  : pkg.version;

checkForUpdates(version);

program
  .name('buildwithnexus')
  .description('Nexus - AI-Powered Task Execution')
  .version(version);

// Nexus init command (setup API keys)
program
  .command('da-init')
  .description('Initialize Nexus (set up API keys and .env.local)')
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
  .description('Start the Nexus dashboard server')
  .option('-p, --port <port>', 'Dashboard port', '4201')
  .action(dashboardCommand);

// Server command
program
  .command('server')
  .description('Start the Nexus backend server')
  .action(async () => {
    const { startBackend } = await import('./core/docker.js');
    await startBackend();
    const chalk = (await import('chalk')).default;
    console.log(chalk.green('Backend server started. Press Ctrl+C to stop.'));
    await new Promise(() => {}); // Keep process alive
  });

// Status command
program
  .command('da-status')
  .description('Check Nexus backend status')
  .action(async () => {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:4200';
    try {
      const response = await fetch(`${backendUrl}/health`);
      if (response.ok) {
        console.log('Backend: Running');
        console.log(`   URL: ${backendUrl}`);
      } else {
        console.log('Backend: Not responding (status ' + response.status + ')');
      }
    } catch {
      console.log('Backend: Not accessible');
      console.log(`   URL: ${backendUrl}`);
      console.log('\n   Start backend with:');
      console.log('   cd ~/Projects/nexus && python -m src.deep_agents_server');
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
