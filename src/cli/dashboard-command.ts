// src/cli/dashboard-command.ts
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function dashboardCommand(options: { port?: string }) {
  const port = options.port || '4201';

  console.log(`Starting Nexus Dashboard on http://localhost:${port}\n`);

  const dashboardPath = path.join(__dirname, '../deep-agents/dashboard/server.js');

  // Start dashboard server
  const dashboard = spawn('node', [dashboardPath], {
    env: { ...process.env, PORT: port },
    stdio: 'inherit',
  });

  dashboard.on('error', (err) => {
    console.error('Failed to start dashboard:', err);
    process.exit(1);
  });

  console.log(`Dashboard ready! Open: http://localhost:${port}`);
  console.log('Press Ctrl+C to stop\n');
}
