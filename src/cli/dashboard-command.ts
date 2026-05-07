import chalk from 'chalk';
import { checkServerHealth } from '../core/api.js';

export async function dashboardCommand() {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4200';
  const dashboardUrl = `${backendUrl}/dashboard`;

  const healthy = await checkServerHealth(backendUrl);
  if (!healthy) {
    console.log(chalk.yellow('⚠️  Backend not running.'));
    console.log(chalk.gray('   Start it with: buildwithnexus server\n'));
    console.log(chalk.dim(`Dashboard will be available at: ${dashboardUrl}`));
    process.exit(1);
  }

  console.log(chalk.green('✓ Dashboard ready'));
  console.log(chalk.cyan(`  ${dashboardUrl}`));
  console.log(chalk.gray('\n  Open the URL above in your browser.\n'));
}
