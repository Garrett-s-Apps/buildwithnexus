import chalk from 'chalk';

export type Mode = 'PLAN' | 'BUILD' | 'BRAINSTORM';

export class TUI {
  private taskStartTime: number = 0;
  private eventCount: number = 0;

  displayHeader(task: string, agent: string) {
    console.clear();
    console.log(
      chalk.cyan('╔════════════════════════════════════════════════════════════╗')
    );
    console.log(
      chalk.cyan('║') +
        chalk.bold.white('        🚀 Nexus - Autonomous Agent Orchestration             ') +
        chalk.cyan('║')
    );
    console.log(
      chalk.cyan('╚════════════════════════════════════════════════════════════╝')
    );
    console.log('');
    console.log(chalk.bold('📋 Task:'), task);
    console.log(chalk.bold('👤 Agent:'), chalk.blue(agent));
    console.log(chalk.gray('─'.repeat(60)));
    console.log('');
    this.taskStartTime = Date.now();
  }

  displayConnecting() {
    console.log(chalk.yellow('⏳ Connecting to backend...'));
  }

  displayConnected(runId: string) {
    console.log(chalk.green('✓ Connected'), chalk.gray(`(Run ID: ${runId})`));
    console.log(chalk.gray('─'.repeat(60)));
    console.log('');
  }

  displayStreamStart() {
    console.log(chalk.bold.cyan('📡 Streaming Events:'));
    console.log('');
  }

  displayPlan(task: string, steps: string[]) {
    console.log('');
    console.log(chalk.bold.cyan('🔍 Chief of Staff Analysis'));
    console.log(chalk.gray('─'.repeat(60)));
    steps.forEach((step, i) => {
      console.log(`  ${chalk.bold.white(`Step ${i + 1}:`)} ${chalk.white(step)}`);
    });
    console.log('');
  }

  displayEvent(type: string, data: Record<string, unknown>) {
    this.eventCount++;

    const content = (data['content'] as string) || '';

    if (type === 'agent_working') {
      const agent = (data['agent'] as string) || 'Agent';
      const agentTask = (data['task'] as string) || '';
      console.log('');
      console.log(`  ${chalk.bold.blue('👤')} ${chalk.bold.blue(agent)} ${chalk.gray('working on:')} ${chalk.white(agentTask)}`);
      return;
    }

    if (type === 'agent_result') {
      const result = (data['result'] as string) || '';
      let displayResult = result;
      if (displayResult.length > 120) {
        displayResult = displayResult.substring(0, 117) + '...';
      }
      console.log(`     ${chalk.green('✓')} ${chalk.green(displayResult)}`);
      return;
    }

    const emoji: { [key: string]: string } = {
      thought: '💭',
      action: '🔨',
      observation: '✓',
      started: '▶️',
      done: '✨',
      execution_complete: '✨',
      error: '❌',
    };

    const color: { [key: string]: (s: string) => string } = {
      thought: chalk.cyan,
      action: chalk.yellow,
      observation: chalk.green,
      started: chalk.blue,
      done: chalk.magenta,
      execution_complete: chalk.magenta,
      error: chalk.red,
    };

    const icon = emoji[type] || '●';
    const colorFn = color[type] || chalk.white;

    // Truncate long content for display
    let displayContent = content;
    if (displayContent.length > 120) {
      displayContent = displayContent.substring(0, 117) + '...';
    }

    console.log(`  ${icon} ${colorFn(displayContent)}`);
  }

  displayResults(summary: string, todosCompleted: number) {
    console.log('');
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.bold.green('✨ Complete!'));
    const lines = summary.split('\n');
    for (const line of lines) {
      console.log(`  ${chalk.white(line)}`);
    }
    console.log(chalk.gray(`  ${todosCompleted} step(s) completed`));
    console.log('');
  }

  displayError(error: string) {
    console.log('');
    console.log(chalk.red.bold('❌ Error Occurred:'));
    console.log(chalk.red(error));
    console.log('');
  }

  displayComplete(duration: number) {
    console.log('');
    console.log(chalk.gray('─'.repeat(60)));
    console.log(
      chalk.green.bold('✨ Workflow Complete!') +
        chalk.gray(` (${duration}ms, ${this.eventCount} events)`)
    );
    console.log('');
  }

  displayBox(title: string, content: string) {
    const width = 60;
    const borderColor = chalk.blue;

    console.log(borderColor('┌' + '─'.repeat(width - 2) + '┐'));
    console.log(
      borderColor('│') +
        chalk.bold.white(` ${title}`.padEnd(width - 3)) +
        borderColor('│')
    );
    console.log(borderColor('├' + '─'.repeat(width - 2) + '┤'));

    const lines = content.split('\n');
    for (const line of lines) {
      const padded = line.substring(0, width - 4).padEnd(width - 4);
      console.log(borderColor('│') + '  ' + padded + borderColor('│'));
    }

    console.log(borderColor('└' + '─'.repeat(width - 2) + '┘'));
    console.log('');
  }

  getElapsedTime(): number {
    return Date.now() - this.taskStartTime;
  }

  displayModeBar(current: Mode) {
    const modes: Mode[] = ['PLAN', 'BUILD', 'BRAINSTORM'];
    const modeColor: Record<Mode, (s: string) => string> = {
      PLAN: chalk.bold.cyan,
      BUILD: chalk.bold.green,
      BRAINSTORM: chalk.bold.blue,
    };

    const parts = modes.map((m) => {
      if (m === current) {
        return modeColor[m](`[${m}]`);
      }
      return chalk.gray(m);
    });

    console.log(chalk.gray('MODE: ') + parts.join(chalk.gray(' | ')));
    console.log(chalk.gray('Type "switch" or "s" to change modes'));
    console.log(chalk.gray('─'.repeat(60)));
  }

  displayModeHeader(mode: Mode) {
    const modeColor: Record<Mode, (s: string) => string> = {
      PLAN: chalk.bold.cyan,
      BUILD: chalk.bold.green,
      BRAINSTORM: chalk.bold.blue,
    };
    const modeIcon: Record<Mode, string> = {
      PLAN: '📋',
      BUILD: '⚙️ ',
      BRAINSTORM: '💡',
    };
    const modeDesc: Record<Mode, string> = {
      PLAN: 'Plan & review steps before executing',
      BUILD: 'Execute immediately with live streaming',
      BRAINSTORM: 'Free-form Q&A and idea exploration',
    };

    console.log('');
    console.log(modeColor[mode](`${modeIcon[mode]} ${mode} MODE`));
    console.log(chalk.gray(modeDesc[mode]));
    console.log('');
  }

  displaySuggestedMode(mode: Mode, task: string) {
    const modeColor: Record<Mode, (s: string) => string> = {
      PLAN: chalk.cyan,
      BUILD: chalk.green,
      BRAINSTORM: chalk.blue,
    };
    console.log('');
    console.log(
      chalk.bold('Suggested mode: ') +
        modeColor[mode](mode) +
        chalk.gray(` for: "${task.length > 50 ? task.substring(0, 47) + '...' : task}"`)
    );
  }

  displayBrainstormResponse(response: string) {
    console.log('');
    console.log(chalk.bold.blue('💡 Agent:'));
    const lines = response.split('\n');
    for (const line of lines) {
      console.log('  ' + chalk.white(line));
    }
    console.log('');
  }

  displayPermissionPrompt(message: string): string {
    return chalk.bold.white(message) + chalk.gray(' [Y/n] ');
  }
}

export const tui = new TUI();
