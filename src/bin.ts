#!/usr/bin/env node

import { program } from 'commander';
import { deepAgentsInitCommand } from './cli/init-command.js';
import { runCommand } from './cli/run-command.js';
import { dashboardCommand } from './cli/dashboard-command.js';
import { interactiveMode } from './cli/interactive.js';
import { cli } from './cli.js';
import { checkForUpdates } from './core/update-notifier.js';
import dotenv from 'dotenv';
import os from 'os';
import path from 'path';

// Load .env.local from home directory (works from any working directory)
const homeEnvPath = path.join(os.homedir(), '.env.local');
dotenv.config({ path: homeEnvPath });

const version = typeof __BUILDWITHNEXUS_VERSION__ !== 'undefined'
  ? __BUILDWITHNEXUS_VERSION__
  : '0.5.17';

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
  .option('-m, --model <model>', 'LLM model', 'claude-sonnet-4-20250514')
  .action(runCommand);

// Dashboard command
program
  .command('dashboard')
  .description('Start the Nexus dashboard server')
  .option('-p, --port <port>', 'Dashboard port', '4201')
  .action(dashboardCommand);

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

// Forward all existing buildwithnexus subcommands (init, install, start, stop, etc.)
for (const cmd of cli.commands) {
  // Avoid collision with our new commands
  const name = cmd.name();
  if (!['da-init', 'run', 'dashboard', 'da-status'].includes(name)) {
    program.addCommand(cmd);
  }
}

// Default: interactive mode when no command
if (!process.argv.slice(2).length) {
  interactiveMode().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  program.parse();
}
